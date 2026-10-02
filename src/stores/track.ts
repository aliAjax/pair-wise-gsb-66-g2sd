import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedDefects, seedSegments } from '../data/seed'
import {
  addAudit as engineAddAudit, buildBatchSummary, currentReadingAt, findReading,
  independentlyReconfirmed, processItem, speedImpact, syncBatchStatus
} from '../services/revision'
import type {
  AuditEntry, Defect, DefectStatus, RectificationAction, RetestResult,
  SupplementBatch, SupplementItem, TrackSegment
} from '../types'

const STORAGE_KEY = 'gsb66:track-geometry'
let idSeed = 10

/** 旧版本本地数据补齐修订字段，保证升级后修订链可追溯 */
function migrate(raw: any) {
  const sourceSegments: TrackSegment[] = raw?.segments ?? seedSegments
  const sourceDefects: Defect[] = raw?.defects ?? seedDefects
  const sourceAudit: AuditEntry[] = raw?.audit ?? seedAudit
  const segments = sourceSegments.map((segment) => ({
    ...segment,
    measurements: (segment.measurements ?? []).map((point: any) => ({
      ...point,
      segmentId: point.segmentId ?? segment.id,
      state: point.state ?? '当前有效',
      sourceBatchId: point.sourceBatchId ?? 'BATCH-INIT-0929',
      currentId: point.currentId ?? point.id,
      revision: point.revision ?? 0
    }))
  }))
  const defects = sourceDefects.map((defect) => ({
    ...defect,
    invalidated: defect.invalidated ?? false,
    retests: (defect.retests ?? []).map((retest: any) => ({
      ...retest,
      independent: retest.independent ?? false,
      state: retest.state ?? '有效'
    }))
  }))
  return { segments, defects, audit: sourceAudit, batches: (raw?.batches ?? []) as SupplementBatch[] }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? migrate(JSON.parse(raw)) : migrate(null)
  } catch {
    return migrate(null)
  }
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

  const activeDefects = computed(() => defects.value.filter((item) => !item.invalidated))

  const filtered = computed(() => defects.value.filter((item) => {
    // 默认只展示当前有效缺陷；选择“已失效”时单独追溯因读数修订失效的缺陷
    if (status.value === '已失效') {
      if (!item.invalidated) return false
    } else if (item.invalidated) {
      return false
    } else if (status.value !== '全部' && item.status !== status.value) {
      return false
    }
    const segment = segments.value.find((value) => value.id === item.segmentId)
    const text = `${item.id} ${segment?.line ?? ''} ${item.type} ${item.owner}`.toLowerCase()
    return !keyword.value || text.includes(keyword.value.toLowerCase())
  }))

  const selectedSegment = computed(() => segments.value.find((item) => item.id === selectedSegmentId.value))

  const engineState = () => ({ segments: segments.value, defects: defects.value, audit: audit.value })
  const idSeq = { get value() { return idSeed }, set value(v: number) { idSeed = v } }

  function currentReadings(segmentId: string) {
    const segment = segments.value.find((item) => item.id === segmentId)
    return (segment?.measurements ?? [])
      .filter((item) => item.state === '当前有效')
      .sort((a, b) => a.mileage - b.mileage)
  }

  function addAudit(entityId: string, action: string, operator: string, detail: string, batchId?: string) {
    engineAddAudit(engineState(), { entityId, action, operator, detail, batchId }, idSeq)
  }

  function assign(defectIds: string[], owner: string) {
    for (const id of defectIds) {
      const defect = defects.value.find((item) => item.id === id)
      if (!defect) continue
      if (defect.invalidated) {
        addAudit(id, '派工被拦截', '当前用户', '缺陷依据读数已修订失效，需先独立复测复核')
        continue
      }
      defect.owner = owner
      defect.status = '整治中'
      defect.version += 1
      addAudit(id, '批量派工', '当前用户', `任务分配至${owner}`)
    }
  }

  function addAction(id: string, action: RectificationAction) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (defect.invalidated) return { ok: false, message: '缺陷依据读数已失效，不能继续登记整治，请先独立复测复核' }
    defect.actions.unshift(action)
    defect.status = '待复测'
    defect.version += 1
    addAudit(id, '提交整治记录', action.operator, `${action.method}：${action.note}`)
    return { ok: true, message: '整治记录已提交' }
  }

  function addRetest(id: string, retest: RetestResult) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (defect.invalidated && !retest.independent) {
      return { ok: false, message: '原复测结论已随读数修订回到待复核，须使用独立仪器复测后才能重新确认' }
    }
    defect.retests.unshift({ ...retest, state: '有效' })
    defect.version += 1
    if (defect.invalidated && retest.independent) {
      if (retest.passed) {
        defect.invalidated = false
        defect.invalidatedAt = undefined
        defect.invalidatedByBatch = undefined
        defect.status = '已关闭'
        addAudit(id, '独立复测复核', retest.tester, `第${retest.round}轮独立复测${retest.measuredValue}/${retest.limit}通过，缺陷依据修订后读数重新生效并关闭`, retest.basisReadingId)
        return { ok: true, message: '独立复测通过，缺陷已重新生效并关闭' }
      }
      addAudit(id, '独立复测复核', retest.tester, `第${retest.round}轮独立复测${retest.measuredValue}/${retest.limit}未通过，缺陷维持失效`)
      return { ok: false, message: '独立复测未通过，缺陷维持失效，需继续整治' }
    }
    defect.status = retest.passed ? '已关闭' : '复测不合格'
    addAudit(id, '提交复测', retest.tester, retest.passed ? '复测通过' : `第${retest.round}轮未通过`)
    return { ok: true, message: retest.passed ? '复测通过，缺陷已关闭' : '复测不合格，任务重新进入整治' }
  }

  function transition(id: string, next: DefectStatus) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (defect.invalidated) return { ok: false, message: '缺陷依据读数已修订失效，须独立复测复核，不能流转' }
    if (next === '已关闭') {
      if (!defect.retests.some((item) => item.passed && item.state === '有效')) {
        const reset = defect.retests.some((item) => item.passed && item.state === '待复核')
        return { ok: false, message: reset ? '原复测合格结论已随读数修订回到待复核，不能关闭，请安排独立复测' : '没有合格复测记录，不能关闭' }
      }
    }
    if (next === '待复测' && !defect.actions.length) return { ok: false, message: '缺少整治记录，不能申请复测' }
    const from = defect.status
    defect.status = next
    defect.version += 1
    addAudit(id, `状态流转：${next}`, '当前用户', `由${from}流转至${next}`)
    return { ok: true, message: `已流转至${next}` }
  }

  function segmentSpeedImpact(segmentId: string) {
    return speedImpact(engineState(), segmentId)
  }

  function updateSegmentSpeed(id: string, speed: number, temporary: number | undefined) {
    const segment = segments.value.find((item) => item.id === id)
    if (!segment) return { ok: false, message: '区段不存在' }
    const state = engineState()
    const openCritical = defects.value.some((item) => item.segmentId === id && item.severity === '一级' && !item.invalidated && item.status !== '已关闭')
    const pendingCritical = defects.value.some((item) => item.segmentId === id && item.severity === '一级' && item.invalidated && !independentlyReconfirmed(item))
    if (openCritical && (!temporary || temporary >= speed)) return { ok: false, message: '一级缺陷未关闭时必须设置更低临时限速' }
    const looseningTemp = segment.temporarySpeedLimit != null && (temporary == null || temporary > segment.temporarySpeedLimit)
    if ((openCritical || pendingCritical) && looseningTemp) {
      return { ok: false, message: '存在未关闭或读数修订后待复核的一级缺陷，不能恢复/提高临时限速' }
    }
    segment.speedLimit = speed
    segment.temporarySpeedLimit = temporary
    segment.version += 1
    engineAddAudit(state, { entityId: id, action: '更新区段速度版本', operator: '工务调度', detail: `正式限速${speed} km/h，临时限速${temporary ?? '无'} km/h（依据当前修订结果联查）` }, idSeq)
    return { ok: true, message: '区段速度版本已更新' }
  }

  // ============ 轨检车补传：读数修订链（纯引擎驱动，支持分段重试） ============

  /** 接收一份补传：逐行处理，失败行不影响其他行，已生效行不会重复入库 */
  function ingestSupplement(detector: string, items: SupplementItem[]) {
    const batch: SupplementBatch = {
      id: `BATCH-${Date.now()}-${idSeed++}`,
      receivedAt: new Date().toISOString(),
      detector,
      items: structuredClone(items),
      results: [],
      status: '处理中',
      attempts: {}
    }
    batches.value.unshift(batch)
    addAudit('补传', '接收轨检车补传', detector, `批次${batch.id}共${items.length}行（补测${items.filter((i) => i.action === '补测').length}行/撤回${items.filter((i) => i.action === '撤回').length}行）`, batch.id)
    for (const item of batch.items) {
      batch.results.push(processItem(engineState(), batch, item, idSeq))
      batch.attempts![item.clientId] = (batch.attempts![item.clientId] ?? 0) + 1
    }
    syncBatchStatus(batch)
    addAudit('补传', batch.status === '已完成' ? '补传处理完成' : '补传部分失败', detector, buildBatchSummary(batch), batch.id)
    return batch.id
  }

  /** 断点重试：只处理未完成行，已生效读数不重复入库 */
  function retryBatch(batchId: string) {
    const batch = batches.value.find((item) => item.id === batchId)
    if (!batch) return
    const pending = batch.results.map((result, index) => ({ result, index })).filter(({ result }) => result.state === '未完成')
    if (!pending.length) return
    addAudit('补传', '重试未完成行', batch.detector, `批次${batch.id}重试${pending.length}行，已生效读数不重复入库`, batch.id)
    for (const { result, index } of pending) {
      const item = batch.items.find((value) => value.clientId === result.clientId)
      if (!item) continue
      batch.results[index] = processItem(engineState(), batch, item, idSeq)
      batch.attempts![item.clientId] = (batch.attempts![item.clientId] ?? 0) + 1
    }
    syncBatchStatus(batch)
    addAudit('补传', batch.status === '已完成' ? '补传重试完成' : '补传仍有失败行', batch.detector, buildBatchSummary(batch), batch.id)
  }

  function batchAffectedDefects(batch: SupplementBatch) {
    return [...new Set(batch.results.flatMap((item) => item.affectedDefects))]
  }

  function reset() {
    segments.value = structuredClone(seedSegments)
    defects.value = structuredClone(seedDefects)
    audit.value = structuredClone(seedAudit)
    batches.value = []
  }

  watch([segments, defects, audit, batches], () => localStorage.setItem(STORAGE_KEY, JSON.stringify({ segments: segments.value, defects: defects.value, audit: audit.value, batches: batches.value })), { deep: true })

  return {
    segments, defects, audit, batches, keyword, status, selectedSegmentId,
    activeDefects, filtered, selectedSegment,
    currentReadings, findReading: (id?: string) => findReading(engineState(), id),
    currentReadingAt: (segmentId: string, mileage: number) => currentReadingAt(engineState(), segmentId, mileage),
    independentlyReconfirmed, speedImpact: segmentSpeedImpact,
    assign, addAction, addRetest, transition, updateSegmentSpeed,
    ingestSupplement, retryBatch, batchAffectedDefects, reset
  }
})
