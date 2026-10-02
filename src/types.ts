export type DefectStatus = '待派工' | '整治中' | '待复测' | '复测不合格' | '已关闭' | '已失效'
export type DefectType = '轨距' | '高低' | '方向' | '三角坑'
export type Severity = '一级' | '二级' | '三级'

/** 读数修订状态：当前有效、被补测替换、被撤回 */
export type ReadingStatus = '有效' | '已替换' | '已撤回'

export interface GeometryMeasurement {
  /** 修订版本ID，同一里程点的每次读数（含撤回）各有一条，按revision递增 */
  revisionId: string
  pointId: string
  revision: number
  segmentId: string
  mileage: number
  gauge: number
  level: number
  alignment: number
  twist: number
  measuredAt: string
  detector: string
  status: ReadingStatus
  /** 补传批次条目ID，原始导入为 null */
  sourceItemId: string | null
  /** 被撤回/替换的时间 */
  supersededAt?: string
  reason?: string
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

/** 同一里程点当前唯一有效读数（修订链视图） */
export interface EffectiveMeasurement extends GeometryMeasurement {
  history: GeometryMeasurement[]
}

/** 视图用区段：measurements 已折叠为各里程点当前有效读数 */
export type PresentSegment = TrackSegment

export interface RectificationAction {
  method: '打磨' | '捣固' | '更换' | '垫板调整' | '测量复核'
  note: string
  operator: string
  recordedAt: string
}

/** 复测结论核对状态：有效 / 待复核（其依据的读数已被补测修订且未独立复测） */
export type RetestVerdictStatus = '有效' | '待复核'

export interface RetestResult {
  round: number
  passed: boolean
  measuredValue: number
  limit: number
  note: string
  tester: string
  testedAt: string
  verdictStatus: RetestVerdictStatus
  /** 结论所依据的读数修订版本；独立复测不依附检测读数时为 null */
  sourceRevisionId: string | null
  /** 是否为缺陷失效后的独立复测（重新复核当前几何状态） */
  independent: boolean
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
  /** 缺陷判定所依据的里程点与读数修订版本，构成可追溯修订链 */
  pointId: string
  sourceRevisionId: string
  /** 最近一次导致失效的补传批次 */
  invalidatedBatchId?: string
  invalidatedAt?: string
  /** 独立复测/复核结案时间，结案前区段处于补测复核挂起 */
  revisionResolvedAt?: string
}

export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
}

/** 补传单条条目：补测新读数 或 撤回旧点 */
export interface SupplementItemInput {
  segmentId: string
  mileage: number
  kind: '补测' | '撤回'
  gauge: number
  level: number
  alignment: number
  twist: number
  measuredAt: string
  detector: string
  note?: string
}

export type SupplementBatchStatus = '待处理' | '部分写入' | '已完成'

export interface SupplementBatch {
  id: string
  receivedAt: string
  source: string
  items: SupplementItemInput[]
  status: SupplementBatchStatus
  /** 已生效（含已存在重复而跳过）的条目序号 */
  appliedItemKeys: string[]
  /** 最近一次写入失败 */
  lastError?: string
  failedItemKey?: string
  /** 演示用：本次接收后首次处理时，该条目模拟写入失败 */
  gateFailureItemKey?: string
}

export interface AffectedDefectInfo {
  defectId: string
  mileage: number
  type: DefectType
  /** 失效前状态展示文案（结案后再次被修订会标注“重新打开”） */
  previousStatus: string
  pendingRetests: number
  batchId: string
  /** 原本已独立复测结案，本次修订将其重新打开 */
  reopened: boolean
}

export interface AffectedSegmentInfo {
  segmentId: string
  line: string
  previousVersion: number
  currentVersion: number
  /** 进入补测复核挂起（存在已失效但未独立复测结案的缺陷） */
  revisionHold: boolean
  affectedDefects: AffectedDefectInfo[]
}

export interface BatchOutcome {
  batchId: string
  status: SupplementBatchStatus
  processed: number
  duplicated: number
  failed: number
  pending: number
  error?: string
  affectedReadings: GeometryMeasurement[]
  affectedDefects: AffectedDefectInfo[]
  affectedSegments: AffectedSegmentInfo[]
}
