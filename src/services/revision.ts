import type {
  AffectedDefectInfo,
  Defect,
  GeometryMeasurement,
  SupplementItemInput
} from '../types'

/** 同一里程点当前唯一有效读数 */
export function effectiveReading(readings: GeometryMeasurement[], segmentId: string, mileage: number): GeometryMeasurement | undefined {
  return readings.find((item) => item.segmentId === segmentId && item.mileage === mileage && item.status === '有效')
}

function maxRevision(readings: GeometryMeasurement[], pointId: string): number {
  return readings.reduce((max, item) => (item.pointId === pointId ? Math.max(max, item.revision) : max), 0)
}

function sameReading(a: GeometryMeasurement, item: SupplementItemInput): boolean {
  return a.gauge === item.gauge && a.level === item.level && a.alignment === item.alignment
    && a.twist === item.twist && a.measuredAt === item.measuredAt && a.detector === item.detector
}

export interface ApplyReadingResult {
  outcome: 'created' | 'duplicated' | 'not-found'
  reading?: GeometryMeasurement
  replaced?: GeometryMeasurement
}

/**
 * 补测入库：同一里程点只保留一条当前有效读数。
 * 若该点已有内容完全一致的有效读数，按幂等处理直接跳过，不重复入库。
 * 否则旧读数另存为“已替换”，新读数成为当前有效读数。
 */
export function applySupplementReading(
  readings: GeometryMeasurement[],
  item: SupplementItemInput,
  sourceItemId: string,
  now: string,
  genId: (pointId: string, revision: number) => string
): ApplyReadingResult {
  const pointId = `GM-${item.mileage}`
  const current = effectiveReading(readings, item.segmentId, item.mileage)
  if (current && sameReading(current, item)) {
    return { outcome: 'duplicated', reading: current }
  }
  const revision = maxRevision(readings, pointId) + 1
  if (current) {
    current.status = '已替换'
    current.supersededAt = now
    current.reason = item.note || `补测批次${sourceItemId}替换原值`
  }
  const reading: GeometryMeasurement = {
    revisionId: genId(pointId, revision),
    pointId,
    revision,
    segmentId: item.segmentId,
    mileage: item.mileage,
    gauge: item.gauge,
    level: item.level,
    alignment: item.alignment,
    twist: item.twist,
    measuredAt: item.measuredAt,
    detector: item.detector,
    status: '有效',
    sourceItemId
  }
  readings.push(reading)
  return { outcome: 'created', reading, replaced: current }
}

export interface ApplyWithdrawResult {
  outcome: 'withdrawn' | 'not-found'
  reading?: GeometryMeasurement
}

/** 撤回旧点：该里程点不再有当前有效读数，原读数保留为“已撤回”审计痕迹 */
export function applyWithdraw(
  readings: GeometryMeasurement[],
  item: SupplementItemInput,
  sourceItemId: string,
  now: string
): ApplyWithdrawResult {
  const current = effectiveReading(readings, item.segmentId, item.mileage)
  if (!current) return { outcome: 'not-found' }
  current.status = '已撤回'
  current.supersededAt = now
  current.reason = item.note || `补传批次${sourceItemId}撤回该点`
  return { outcome: 'withdrawn', reading: current }
}

/**
 * 读数修订后，使该里程点上所有相关缺陷进入失效待复核：
 * - 尚未独立复测结案的缺陷标记“已失效”；
 * - 已独立复测结案（含已关闭）的缺陷，其依据点被再次修订/撤回时重新打开复核；
 * - 未独立复测且不依据当前读数的复测结论回到“待复核”。
 */
export function invalidateDefectsForPoint(
  defects: Defect[],
  segmentId: string,
  mileage: number,
  batchId: string,
  now: string
): AffectedDefectInfo[] {
  const affected: AffectedDefectInfo[] = []
  for (const defect of defects) {
    if (defect.segmentId !== segmentId || defect.mileage !== mileage) continue
    if (defect.status === '已失效' && !defect.revisionResolvedAt) continue
    const previousStatus = defect.status
    const wasResolved = !!defect.revisionResolvedAt
    let pendingRetests = 0
    for (const retest of defect.retests) {
      // 独立复测始终有效；依附检测读数的结论，依据被修订即回到待复核
      if (!retest.independent && retest.verdictStatus === '有效') {
        retest.verdictStatus = '待复核'
        pendingRetests += 1
      }
    }
    defect.status = '已失效'
    defect.invalidatedBatchId = batchId
    defect.invalidatedAt = now
    defect.revisionResolvedAt = undefined
    defect.version += 1
    affected.push({
      defectId: defect.id,
      mileage: defect.mileage,
      type: defect.type,
      previousStatus: wasResolved && previousStatus === '已关闭' ? '已关闭(重新打开)' : previousStatus,
      pendingRetests,
      reopened: wasResolved,
      batchId
    })
  }
  return affected
}
