export type DefectStatus = '待派工' | '整治中' | '待复测' | '复测不合格' | '已关闭' | '待复核' | '已失效'

/** 读数生命周期：当前有效、被补测替换（原值另存）、被撤回 */
export type ReadingState = '当前有效' | '已替换' | '已撤回'
/** 补传行操作：补测（新读数）或撤回旧点 */
export type SupplementAction = '补测' | '撤回'

export type DefectType = '轨距' | '高低' | '方向' | '三角坑'
export type Severity = '一级' | '二级' | '三级'

export interface GeometryMeasurement {
  id: string
  segmentId: string
  mileage: number
  gauge: number
  level: number
  alignment: number
  twist: number
  measuredAt: string
  detector: string
  /** 修订状态，同一里程点只保留一条“当前有效”读数 */
  state: ReadingState
  /** 首次入库的补传批次，可追溯来源 */
  sourceBatchId: string
  /** 被哪次补测替换 / 被哪次撤回 */
  supersededBy?: string
  revisedAt?: string
  /** 当前读数指向自己；被替换的原值 currentId 指向生效读数 */
  currentId?: string
  revision: number
}

export interface TrackSegment {
  id: string
  line: string
  startMileage: number
  endMileage: number
  speedLimit: number
  temporarySpeedLimit?: number
  version: number
  measurements: GeometryMeasurement[]
}

export interface RectificationAction {
  method: '打磨' | '捣固' | '更换' | '垫板调整' | '测量复核'
  note: string
  operator: string
  recordedAt: string
}

export interface RetestResult {
  round: number
  passed: boolean
  measuredValue: number
  limit: number
  note: string
  tester: string
  testedAt: string
  /** 是否独立复测（独立仪器/独立轮次），独立复测不随读补测回退 */
  independent: boolean
  /** 结论状态：有效 / 随读数修订回到待复核 */
  state: '有效' | '待复核'
  /** 结论所依据的读数（复测值独立采集时为复测自身读数） */
  basisReadingId?: string
  reviewedAt?: string
}

export interface Defect {
  id: string
  segmentId: string
  mileage: number
  type: DefectType
  severity: Severity
  measuredValue: number
  limit: number
  status: DefectStatus
  owner: string
  discoveredAt: string
  dueDate: string
  actions: RectificationAction[]
  retests: RetestResult[]
  version: number
  /** 缺陷所依据的读数 */
  basisReadingId?: string
  /** 读数修订后失效；原值替换后可由独立复测恢复 */
  invalidated: boolean
  invalidatedAt?: string
  invalidatedByBatch?: string
  /** 失效前状态，便于追溯（不自动恢复） */
  previousStatus?: DefectStatus
  lastRevisionId?: string
}

export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
  /** 同一次补传内所有记录共享批次号，串起读数→缺陷→复测→限速的修订关系 */
  batchId?: string
}

/** 一份补传中的单行 */
export interface SupplementItem {
  clientId: string
  segmentId: string
  action: SupplementAction
  mileage: number
  measuredAt: string
  detector: string
  gauge?: number
  level?: number
  alignment?: number
  twist?: number
  /** 演示分段写入失败：首次处理时该行不入库，重试可成功 */
  simulateWriteFailure?: boolean
}

/** 补传行处理结果 */
export interface SupplementItemResult {
  clientId: string
  segmentId: string
  mileage: number
  action: SupplementAction
  state: '已生效' | '未完成'
  readingId?: string
  /** 受影响而失效的缺陷 */
  affectedDefects: string[]
  /** 回到待复核的复测结论 */
  resetRetests: string[]
  /** 受影响、需重新联查的区段限速 */
  affectedSpeed: AffectedSpeed[]
  error?: string
}

export interface AffectedSpeed {
  segmentId: string
  line: string
  formal: number
  temporary?: number
  openCriticalDefects: number
  reason: string
}

/** 补传批次（支持分段失败、断点重试） */
export interface SupplementBatch {
  id: string
  receivedAt: string
  detector: string
  items: SupplementItem[]
  results: SupplementItemResult[]
  status: '处理中' | '部分失败' | '已完成'
  /** 每行的写入尝试次数，用于瞬时失败重试 */
  attempts?: Record<string, number>
}
