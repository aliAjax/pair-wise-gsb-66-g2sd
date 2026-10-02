import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedDefects, seedSegments } from '../data/seed'
import { applySupplementReading, applyWithdraw, effectiveReading, invalidateDefectsForPoint } from '../services/revision'
import type {
  AffectedDefectInfo,
  AffectedSegmentInfo,
  AuditEntry,
  BatchOutcome,
  Defect,
  DefectStatus,
  GeometryMeasurement,
  PresentSegment,
  RectificationAction,
  RetestResult,
  SupplementBatch,
  SupplementItemInput,
  TrackSegment
} from '../types'

const STORAGE_KEY = 'gsb66:track-geometry:v2'
let idSeed = 10
let revisionSeq = 0
let batchSeq = 0

function nextId(prefix: string) {
  idSeed += 1
  return `${prefix}-${Date.now().toString(36)}-${idSeed}`
}

function nextRevisionId(pointId: string, revision: number) {
  revisionSeq += 1
  return `${pointId}-R${revision}-${revisionSeq}`
}

function nextBatchId() {
  batchSeq += 1
  return `SPL-20261002-${String(batchSeq).padStart(3, '0')}`
}

interface PersistedState {
  segments: TrackSegment[]
  defects: Defect[]
  audit: AuditEntry[]
  batches: SupplementBatch[]
}

/** 旧版本（扁平读数挂在segment上、无修订链字段）本地数据迁移 */
function migrate(raw: any): PersistedState {
  const readings: GeometryMeasurement[] = []
  const segments: TrackSegment[] = (raw?.segments ?? seedSegments).map((segment: TrackSegment) => {
    const migrated = (segment.measurements ?? []).map((point: any) => {
      if (point.revisionId) return point as GeometryMeasurement
      const revisionId = `GM-${point.mileage}-R1`
      const reading: GeometryMeasurement = {
        revisionId,
        pointId: `GM-${point.mileage}`,
        revision: 1,
        segmentId: segment.id,
        mileage: point.mileage,
        gauge: point.gauge,
        level: point.level,
        alignment: point.alignment,
        twist: point.twist,
        measuredAt: point.measuredAt,
        detector: point.detector,
        status: '有效',
        sourceItemId: null
      }
      readings.push(reading)
      return reading
    })
    return { ...segment, measurements: migrated }
  })
  if (readings.length) segments.forEach((segment) => { segment.measurements = readings.filter((item) => item.segmentId === segment.id) })

  const defects: Defect[] = (raw?.defects ?? seedDefects).map((defect: any) => ({
    ...defect,
    pointId: defect.pointId ?? `GM-${defect.mileage}`,
    sourceRevisionId: defect.sourceRevisionId ?? `GM-${defect.mileage}-R1`,
    status: defect.status === '已失效' ? '已失效' : defect.status,
    retests: (defect.retests ?? []).map((retest: any) => ({
      ...retest,
      verdictStatus: retest.verdictStatus ?? '有效',
      sourceRevisionId: retest.sourceRevisionId ?? `GM-${defect.mileage}-R1`,
      independent: retest.independent ?? false
    }))
  }))

  return { segments, defects, audit: raw?.audit ?? seedAudit, batches: raw?.batches ?? [] }
}

function load(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return migrate(JSON.parse(raw))
  } catch {
    /* 数据损坏时回退到种子数据 */
  }
  return { segments: structuredClone(seedSegments), defects: structuredClone(seedDefects), audit: structuredClone(seedAudit), batches: [] }
}

export const useTrackStore = defineStore('track', () => {
  const initial = load()
  const segments = ref<TrackSegment[]>(initial.segments)
  const defects = ref<Defect[]>(initial.defects)
  const audit = ref<AuditEntry[]>(initial.audit)
  const batches = ref<SupplementBatch[]>(initial.batches)
  const keyword = ref('')
  const status = ref<DefectStatus | '全部'>('全部')
  const selectedSegmentId = ref(segments.value[0]?.id ?? '')

  const allReadings = computed<GeometryMeasurement[]>(() => segments.value.flatMap((segment) => segment.measurements))

  /** 视图用区段：measurements 仅保留当前有效读数（撤回点不再画线/标点） */
  const presentSegments = computed<PresentSegment[]>(() => segments.value.map((segment) => ({
    ...segment,
    measurements: segment.measurements
      .filter((item) => item.status === '有效')
      .sort((a, b) => a.mileage - b.mileage)
  })))

  const selectedSegment = computed(() => presentSegments.value.find((item) => item.id === selectedSegmentId.value))

  const filtered = computed(() => defects.value.filter((item) => {
    const segment = segments.value.find((value) => value.id === item.segmentId)
    const text = `${item.id} ${segment?.line ?? ''} ${item.type} ${item.owner}`.toLowerCase()
    return (!keyword.value || text.includes(keyword.value.toLowerCase())) && (status.value === '全部' || item.status === status.value)
  }))

  function addAudit(entityId: string, action: string, operator: string, detail: string) {
    audit.value.unshift({ id: nextId('A'), entityId, action, operator, detail, createdAt: new Date().toISOString() })
  }

  function getReading(revisionId: string) {
    return allReadings.value.find((item) => item.revisionId === revisionId)
  }

  function readingChain(pointId: string) {
    return allReadings.value
      .filter((item) => item.pointId === pointId)
      .sort((a, b) => b.revision - a.revision)
  }

  /** 区段是否处于补测复核挂起：存在已失效但未独立复测结案的缺陷，此时不能恢复临时限速 */
  function segmentRevisionHold(segmentId: string) {
    return defects.value.some((item) => item.segmentId === segmentId && item.status === '已失效' && !item.revisionResolvedAt)
  }

  function assign(defectIds: string[], owner: string) {
    let skipped = 0
    for (const id of defectIds) {
      const defect = defects.value.find((item) => item.id === id)
      if (!defect) continue
      if (defect.status === '已失效' && !defect.revisionResolvedAt) { skipped += 1; continue }
      defect.owner = owner
      defect.status = '整治中'
      defect.version += 1
      addAudit(id, '批量派工', '当前用户', `任务分配至${owner}`)
    }
    return skipped ? { ok: false, message: `${skipped}项缺陷依据读数已补测失效，须独立复测后才能派工` } : { ok: true, message: `已派工${defectIds.length}项` }
  }

  function addAction(id: string, action: RectificationAction) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (defect.status === '已失效' && !defect.revisionResolvedAt) return { ok: false, message: '缺陷依据读数已补测失效，整治记录不能继续登记' }
    defect.actions.unshift(action)
    defect.status = '待复测'
    defect.version += 1
    addAudit(id, '提交整治记录', action.operator, `${action.method}：${action.note}`)
    return { ok: true, message: '整治记录已提交' }
  }

  function addRetest(id: string, retest: RetestResult) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    defect.retests.unshift(retest)
    defect.status = retest.passed ? '已关闭' : '复测不合格'
    defect.version += 1
    addAudit(id, '提交复测', retest.tester, retest.passed ? '复测通过' : `第${retest.round}轮未通过`)
    return { ok: true, message: retest.passed ? '复测通过，缺陷已关闭' : '复测不合格，任务重新进入整治' }
  }

  /**
   * 独立复测：缺陷因读数补测失效后，由复测人员重新测量当前几何状态。
   * 独立复测结论不依附检测读数，始终保持“有效”，可作为关闭/恢复限速的唯一依据。
   */
  function submitIndependentRetest(id: string, retest: Omit<RetestResult, 'verdictStatus' | 'sourceRevisionId' | 'independent'>) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (defect.status !== '已失效' || defect.revisionResolvedAt) return { ok: false, message: '仅补测失效且待复核的缺陷需要独立复测' }
    const current = effectiveReading(allReadings.value, defect.segmentId, defect.mileage)
    const verdict: RetestResult = { ...retest, verdictStatus: '有效', sourceRevisionId: current?.revisionId ?? null, independent: true }
    defect.retests.unshift(verdict)
    defect.revisionResolvedAt = retest.testedAt
    defect.invalidatedBatchId = undefined
    defect.invalidatedAt = undefined
    defect.version += 1
    if (retest.passed) {
      defect.status = '已关闭'
      addAudit(id, '独立复测结案', retest.tester, `补测后独立复测合格（${retest.measuredValue} / ${retest.limit}），缺陷关闭，区段解除复核挂起`)
    } else {
      defect.status = '复测不合格'
      addAudit(id, '独立复测立案', retest.tester, `补测后独立复测仍超限（${retest.measuredValue} / ${retest.limit}），依据当前读数重新立案整治`)
    }
    return { ok: true, message: retest.passed ? '独立复测合格，缺陷关闭，限速可恢复' : '独立复测仍超限，缺陷重新立案' }
  }

  function transition(id: string, next: DefectStatus) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (defect.status === '已失效' && !defect.revisionResolvedAt) return { ok: false, message: '缺陷依据读数已补测失效，须先独立复测，不能继续关闭' }
    const hasValidPass = defect.retests.some((item) => item.passed && item.verdictStatus === '有效')
    if (next === '已关闭' && !hasValidPass) {
      const hasPending = defect.retests.some((item) => item.verdictStatus === '待复核')
      return { ok: false, message: hasPending ? '原复测结论已回到待复核，须独立复测合格后才能关闭' : '没有合格复测记录，不能关闭' }
    }
    if (next === '待复测' && !defect.actions.length) return { ok: false, message: '缺少整治记录，不能申请复测' }
    const previous = defect.status
    defect.status = next
    defect.version += 1
    addAudit(id, `状态流转：${next}`, '当前用户', `由${previous}流转至${next}`)
    return { ok: true, message: `已流转至${next}` }
  }

  function updateSegmentSpeed(id: string, speed: number, temporary: number | undefined) {
    const segment = segments.value.find((item) => item.id === id)
    if (!segment) return { ok: false, message: '区段不存在' }
    if (segmentRevisionHold(id)) return { ok: false, message: '该区段有补测失效缺陷待独立复测，临时限速不能恢复或调整' }
    const conflict = defects.value.some((item) => item.segmentId === id && item.status !== '已关闭' && item.status !== '已失效' && item.severity === '一级')
    if (conflict && (!temporary || temporary >= speed)) return { ok: false, message: '一级缺陷未关闭时必须设置更低临时限速' }
    segment.speedLimit = speed
    segment.temporarySpeedLimit = temporary
    segment.version += 1
    addAudit(id, '更新区段速度版本', '工务调度', `正式限速${speed} km/h，临时限速${temporary ?? '无'}`)
    return { ok: true, message: '区段速度版本已更新' }
  }

  function itemKey(item: SupplementItemInput, index: number) {
    return `${item.segmentId}:${item.mileage}:${item.kind}:${index}`
  }

  /**
   * 接收一份补传（补测/撤回混合）。
   * gateFailureItemKey：演示首段写入失败；该状态仅存在于批次首次处理，重试时解除。
   */
  function receiveSupplementBatch(items: SupplementItemInput[], source: string, gateFailureItemKey?: string): SupplementBatch {
    const batch: SupplementBatch = {
      id: nextBatchId(),
      receivedAt: new Date().toISOString(),
      source,
      items,
      status: '待处理',
      appliedItemKeys: [],
      gateFailureItemKey
    }
    batches.value.unshift(batch)
    addAudit(batch.id, '接收轨检车补传', source, `补传${items.length}条（${items.filter((i) => i.kind === '补测').length}条补测/${items.filter((i) => i.kind === '撤回').length}条撤回），写入前校验`)
    return batch
  }

  /**
   * 处理（或断点重试）补传批次：逐条写入，遇到写入失败立即停止。
   * 已生效条目不重复入库（幂等），只重试未完成部分；一份补传受影响的缺陷与区段限速一起列出。
   */
  function processSupplementBatch(batchId: string): BatchOutcome {
    const batch = batches.value.find((item) => item.id === batchId)
    if (!batch) throw new Error('补传批次不存在')
    const now = new Date().toISOString()
    const affectedReadings: GeometryMeasurement[] = []
    const affectedDefectMap = new Map<string, AffectedDefectInfo>()
    const touchedSegments = new Set<string>()
    const duplicatedKeys: string[] = []
    let processed = 0
    let failed = 0
    let error: string | undefined

    for (let index = 0; index < batch.items.length; index += 1) {
      const item = batch.items[index]
      const key = itemKey(item, index)
      const segment = segments.value.find((value) => value.id === item.segmentId)
      if (!segment) { failed += 1; error = `第${index + 1}条：区段${item.segmentId}不存在`; batch.failedItemKey = key; break }
      if (item.kind === '补测' && (item.mileage < segment.startMileage || item.mileage > segment.endMileage)) {
        failed += 1; error = `第${index + 1}条：里程${item.mileage}不在${segment.line}范围内`; batch.failedItemKey = key; break
      }
      if (batch.gateFailureItemKey === key) {
        failed += 1
        error = `第${index + 1}条：写入失败（演示：存储通道超时），该条及之后条目待重试`
        batch.gateFailureItemKey = undefined
        batch.failedItemKey = key
        break
      }

      const sourceItemId = `${batch.id}#${index + 1}`
      if (item.kind === '补测') {
        const result = applySupplementReading(segment.measurements, item, sourceItemId, now, nextRevisionId)
        if (result.outcome === 'duplicated') {
          // 断点重试：已生效读数不重复入库；与当前有效读数一致按幂等跳过
          if (!batch.appliedItemKeys.includes(key)) batch.appliedItemKeys.push(key)
          duplicatedKeys.push(key)
          addAudit(result.reading!.revisionId, '补测幂等跳过', batch.source, `${batch.id}第${index + 1}条与当前有效读数一致，不重复入库`)
          processed += 1
          continue
        }
        batch.appliedItemKeys.push(key)
        affectedReadings.push(result.reading!)
        touchedSegments.add(item.segmentId)
        addAudit(result.reading!.revisionId, '补测读数生效', batch.source, `${segment.line} ${item.mileage} R${result.reading!.revision} 成为当前有效读数${result.replaced ? `，原读数${result.replaced.revisionId}另存为已替换` : ''}`)
        processed += 1
        for (const info of invalidateDefectsForPoint(defects.value, item.segmentId, item.mileage, batch.id, now)) {
          affectedDefectMap.set(info.defectId, info)
          const reopenText = info.reopened ? '（结案后依据点被再次修订，重新打开复核）' : ''
          addAudit(info.defectId, '读数补测致缺陷失效', batch.source, `${info.previousStatus} → 已失效${reopenText}，依据读数已被${result.reading!.revisionId}修订；${info.pendingRetests}条未独立复测的复测结论回到待复核`)
        }
      } else {
        // 断点重试：撤回条目首段已生效时，仅当该点仍为撤回状态才算完成
        if (batch.appliedItemKeys.includes(key)) {
          processed += 1
          continue
        }
        const result = applyWithdraw(segment.measurements, item, sourceItemId, now)
        if (result.outcome === 'not-found') {
          failed += 1
          error = `第${index + 1}条：里程${item.mileage}无当前有效读数，无法撤回`
          batch.failedItemKey = key
          break
        }
        batch.appliedItemKeys.push(key)
        affectedReadings.push(result.reading!)
        touchedSegments.add(item.segmentId)
        addAudit(result.reading!.revisionId, '撤回检测点', batch.source, `${segment.line} ${item.mileage} 当前有效读数撤回（已撤回留痕），该点不再参与里程图与超限判定`)
        processed += 1
        for (const info of invalidateDefectsForPoint(defects.value, item.segmentId, item.mileage, batch.id, now)) {
          affectedDefectMap.set(info.defectId, info)
          const reopenText = info.reopened ? '（结案后检测点被撤回，重新打开复核）' : ''
          addAudit(info.defectId, '读数撤回致缺陷失效', batch.source, `${info.previousStatus} → 已失效${reopenText}，检测点已撤回；${info.pendingRetests}条未独立复测的复测结论回到待复核`)
        }
      }
    }

    // 受影响区段限速联查：有写入的区段版本统一递增
    const affectedDefects = [...affectedDefectMap.values()]
    const affectedSegments: AffectedSegmentInfo[] = []
    for (const segmentId of touchedSegments) {
      const segment = segments.value.find((value) => value.id === segmentId)!
      const previousVersion = segment.version
      segment.version += 1
      const hold = segmentRevisionHold(segmentId)
      const info: AffectedSegmentInfo = {
        segmentId,
        line: segment.line,
        previousVersion,
        currentVersion: segment.version,
        revisionHold: hold,
        affectedDefects: affectedDefects.filter((item) => defects.value.find((d) => d.id === item.defectId)?.segmentId === segmentId)
      }
      affectedSegments.push(info)
      addAudit(segmentId, '补测影响区段版本', batch.source, `区段版本 V${previousVersion} → V${segment.version}；${hold ? '存在失效缺陷待独立复测，临时限速保持不得恢复' : '无需限速调整'}`)
    }

    const appliedCount = batch.appliedItemKeys.length
    batch.status = appliedCount >= batch.items.length ? '已完成' : '部分写入'
    batch.lastError = error
    if (!error) batch.failedItemKey = undefined
    const pending = batch.items.length - appliedCount
    const created = processed - duplicatedKeys.length

    return {
      batchId: batch.id,
      status: batch.status,
      processed: created,
      duplicated: duplicatedKeys.length,
      failed,
      pending,
      error,
      affectedReadings,
      affectedDefects,
      affectedSegments
    }
  }

  function batchImpact(batch: SupplementBatch) {
    const itemKeys = new Set(batch.appliedItemKeys)
    const readings = allReadings.value.filter((item) => item.sourceItemId && item.sourceItemId.startsWith(`${batch.id}#`))
    const affectedDefectIds = new Set(defects.value.filter((item) => item.invalidatedBatchId === batch.id).map((item) => item.id))
    const segments = [...new Set(readings.map((item) => item.segmentId))]
    return { itemKeys, readings, affectedDefectIds, segments }
  }

  function reset() {
    segments.value = structuredClone(seedSegments)
    defects.value = structuredClone(seedDefects)
    audit.value = structuredClone(seedAudit)
    batches.value = []
  }

  watch(
    [segments, defects, audit, batches],
    () => localStorage.setItem(STORAGE_KEY, JSON.stringify({ segments: segments.value, defects: defects.value, audit: audit.value, batches: batches.value })),
    { deep: true }
  )

  return {
    segments, defects, audit, batches, keyword, status, selectedSegmentId,
    allReadings, presentSegments, selectedSegment, filtered,
    getReading, readingChain, segmentRevisionHold,
    assign, addAction, addRetest, submitIndependentRetest, transition,
    updateSegmentSpeed, receiveSupplementBatch, processSupplementBatch, batchImpact,
    itemKey, reset
  }
})
