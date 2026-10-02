/**
 * 轨检车补传修订引擎（纯函数，便于重试与测试）。
 * 同一里程仅一条当前有效读数；读数更新级联失效缺陷、回退非独立复测结论，
 * 并汇总受影响区段的限速联查。
 */
import type {
  AuditEntry, Defect, GeometryMeasurement, SupplementBatch, SupplementItem,
  SupplementItemResult, TrackSegment
} from '../types'

export function typeValue(point: GeometryMeasurement, type: Defect['type']) {
  return type === '轨距' ? point.gauge : type === '高低' ? point.level : type === '方向' ? point.alignment : point.twist
}

export function independentlyReconfirmed(defect: Defect) {
  if (!defect.invalidatedAt) return false
  return defect.retests.some((retest) => retest.independent && retest.passed && retest.state === '有效' && retest.testedAt >= defect.invalidatedAt!)
}

export interface EngineState {
  segments: TrackSegment[]
  defects: Defect[]
  audit: AuditEntry[]
}

export function mileageLabel(mileage: number) {
  return `K${Math.floor(mileage / 1000)}+${String(mileage % 1000).padStart(3, '0')}`
}

export function currentReadingAt(state: EngineState, segmentId: string, mileage: number) {
  return state.segments
    .find((item) => item.id === segmentId)
    ?.measurements.find((item) => item.mileage === mileage && item.state === '当前有效')
}

export function findReading(state: EngineState, id?: string) {
  if (!id) return undefined
  return state.segments.flatMap((segment) => segment.measurements).find((item) => item.id === id)
}

export function speedImpact(state: EngineState, segmentId: string) {
  const segment = state.segments.find((item) => item.id === segmentId)
  if (!segment) return undefined
  const openCritical = state.defects.filter((item) => item.segmentId === segmentId && item.severity === '一级' && !item.invalidated && item.status !== '已关闭')
  const pendingCritical = state.defects.filter((item) => item.segmentId === segmentId && item.severity === '一级' && item.invalidated && !independentlyReconfirmed(item))
  let reason: string
  if (openCritical.length) {
    reason = `仍有${openCritical.length}处未关闭一级缺陷，临时限速${segment.temporarySpeedLimit ?? '无'} km/h不得恢复至正式限速${segment.speedLimit} km/h`
  } else if (pendingCritical.length) {
    reason = `${pendingCritical.length}处一级缺陷随读数失效待独立复核，复核完成前不得恢复或提高临时限速（当前${segment.temporarySpeedLimit ?? '无'} km/h）`
  } else {
    reason = `无未关闭一级缺陷，限速联查维持：正式${segment.speedLimit} km/h，临时${segment.temporarySpeedLimit ?? '无'} km/h`
  }
  return { segmentId, line: segment.line, formal: segment.speedLimit, temporary: segment.temporarySpeedLimit, openCriticalDefects: openCritical.length, reason }
}

export function addAudit(state: EngineState, entry: Omit<AuditEntry, 'id' | 'createdAt'> & { createdAt?: string }, idSeq: { value: number }) {
  state.audit.unshift({
    id: `A-${Date.now()}-${idSeq.value++}`,
    createdAt: entry.createdAt ?? new Date().toISOString(),
    entityId: entry.entityId,
    action: entry.action,
    operator: entry.operator,
    detail: entry.detail,
    batchId: entry.batchId
  })
}

function cascadeInvalidate(state: EngineState, segmentId: string, mileage: number, newReadingId: string, batchId: string, now: string, affected: SupplementItemResult, idSeq: { value: number }) {
  const related = state.defects.filter((item) => !item.invalidated && item.segmentId === segmentId && (item.mileage === mileage || (item.basisReadingId ? findReading(state, item.basisReadingId)?.mileage === mileage : false)))
  for (const defect of related) {
    defect.previousStatus = defect.status
    defect.status = '已失效'
    defect.invalidated = true
    defect.invalidatedAt = now
    defect.invalidatedByBatch = batchId
    defect.lastRevisionId = newReadingId
    defect.version += 1
    affected.affectedDefects.push(defect.id)
    addAudit(state, {
      entityId: defect.id,
      action: '缺陷随读数修订失效',
      operator: '轨检车补传',
      detail: `里程${mileageLabel(mileage)}读数被${newReadingId.startsWith('WD-') ? '撤回' : '补测'}，原状态${defect.previousStatus}；须独立复测后方可重新确认`,
      batchId
    }, idSeq)
    for (const retest of defect.retests) {
      if (!retest.independent && retest.state === '有效') {
        retest.state = '待复核'
        retest.reviewedAt = now
        affected.resetRetests.push(`${defect.id}#第${retest.round}轮`)
        addAudit(state, { entityId: defect.id, action: '复测结论回到待复核', operator: '轨检车补传', detail: `第${retest.round}轮非独立复测结论依据读数已修订，不得继续用于关闭或恢复限速`, batchId }, idSeq)
      }
    }
  }
  if (related.length) {
    const impact = speedImpact(state, segmentId)
    if (impact && !affected.affectedSpeed.some((item) => item.segmentId === segmentId)) affected.affectedSpeed.push(impact)
  }
}

export function processItem(state: EngineState, batch: SupplementBatch, item: SupplementItem, idSeq: { value: number }): SupplementItemResult {
  const now = new Date().toISOString()
  const result: SupplementItemResult = {
    clientId: item.clientId, segmentId: item.segmentId, mileage: item.mileage,
    action: item.action, state: '已生效', affectedDefects: [], resetRetests: [], affectedSpeed: []
  }
  try {
    const attempt = batch.attempts?.[item.clientId] ?? 0
    if (item.simulateWriteFailure && attempt === 0) {
      throw new Error('该里程段写入失败（存储通道超时），读数未入库')
    }
    const segment = state.segments.find((value) => value.id === item.segmentId)
    if (!segment) throw new Error('区段不存在')
    if (item.mileage < segment.startMileage || item.mileage > segment.endMileage) throw new Error('里程不在区段范围内')
    const previous = currentReadingAt(state, item.segmentId, item.mileage)

    if (item.action === '撤回') {
      if (!previous) throw new Error('该里程无当前有效读数，无法撤回')
      previous.state = '已撤回'
      previous.supersededBy = batch.id
      previous.revisedAt = now
      previous.currentId = undefined
      addAudit(state, { entityId: previous.id, action: '撤回检测读数', operator: item.detector, detail: `撤回${mileageLabel(item.mileage)}读数（原值留存可追溯）`, batchId: batch.id }, idSeq)
      cascadeInvalidate(state, item.segmentId, item.mileage, `WD-${item.mileage}`, batch.id, now, result, idSeq)
      result.readingId = previous.id
      return result
    }

    const newId = `GM-${item.mileage}-R${previous ? previous.revision + 1 : 0}-${idSeq.value++}`
    if (previous) {
      previous.state = '已替换'
      previous.supersededBy = newId
      previous.revisedAt = now
      previous.currentId = newId
      addAudit(state, { entityId: previous.id, action: '读数被补测替换', operator: item.detector, detail: `原值${previous.gauge}/${previous.level}/${previous.alignment}/${previous.twist}另存，当前有效读数转为${newId}`, batchId: batch.id }, idSeq)
    }
    const reading: GeometryMeasurement = {
      id: newId,
      segmentId: item.segmentId,
      mileage: item.mileage,
      gauge: item.gauge ?? previous?.gauge ?? 0,
      level: item.level ?? previous?.level ?? 0,
      alignment: item.alignment ?? previous?.alignment ?? 0,
      twist: item.twist ?? previous?.twist ?? 0,
      measuredAt: item.measuredAt,
      detector: item.detector,
      state: '当前有效',
      sourceBatchId: batch.id,
      currentId: newId,
      revision: previous ? previous.revision + 1 : 0
    }
    segment.measurements.push(reading)
    addAudit(state, { entityId: newId, action: previous ? '补测读数生效' : '新增检测读数', operator: item.detector, detail: `${mileageLabel(item.mileage)} 轨距${reading.gauge} 高低${reading.level} 方向${reading.alignment} 三角坑${reading.twist}${previous ? `，修订第${reading.revision}版` : ''}`, batchId: batch.id }, idSeq)
    cascadeInvalidate(state, item.segmentId, item.mileage, newId, batch.id, now, result, idSeq)
    result.readingId = newId
    return result
  } catch (error) {
    result.state = '未完成'
    result.error = error instanceof Error ? error.message : String(error)
    addAudit(state, { entityId: item.segmentId, action: '补传写入失败', operator: item.detector, detail: `客户单行${item.clientId}（K${item.mileage}，${item.action}）：${result.error}`, batchId: batch.id }, idSeq)
    return result
  }
}

export function syncBatchStatus(batch: SupplementBatch) {
  batch.status = batch.results.some((item) => item.state === '未完成')
    ? (batch.results.some((item) => item.state === '已生效') ? '部分失败' : '处理中')
    : '已完成'
}

export function buildBatchSummary(batch: SupplementBatch) {
  const defects = new Set(batch.results.flatMap((item) => item.affectedDefects))
  const retests = batch.results.flatMap((item) => item.resetRetests)
  const speeds = new Set(batch.results.flatMap((item) => item.affectedSpeed.map((speed) => speed.segmentId)))
  const failed = batch.results.filter((item) => item.state === '未完成').length
  return `生效${batch.results.length - failed}行/未完成${failed}行；受影响缺陷${defects.size}个、复测结论${retests.length}条回到待复核、限速联查区段${speeds.size}个`
}
