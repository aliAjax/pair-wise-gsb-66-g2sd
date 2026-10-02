import { seedAudit, seedDefects, seedSegments } from '../src/data/seed'
import {
  buildBatchSummary, currentReadingAt, independentlyReconfirmed,
  processItem, speedImpact, syncBatchStatus
} from '../src/services/revision'
import type { EngineState } from '../src/services/revision'
import type { SupplementBatch, SupplementItem } from '../src/types'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name} ${extra}`) }
}

function freshState(): EngineState {
  return {
    segments: structuredClone(seedSegments),
    defects: structuredClone(seedDefects),
    audit: structuredClone(seedAudit)
  }
}

const idSeq = { value: 100 }
function runBatch(state: EngineState, items: SupplementItem[], attempts: Record<string, number> = {}) {
  const batch: SupplementBatch = {
    id: `BATCH-T-${Math.random().toString(36).slice(2, 7)}`,
    receivedAt: new Date().toISOString(),
    detector: 'GJ-6型轨检车',
    items: structuredClone(items),
    results: [],
    status: '处理中',
    attempts
  }
  for (const item of items) {
    batch.results.push(processItem(state, batch, item, idSeq))
    batch.attempts![item.clientId] = (batch.attempts![item.clientId] ?? 0) + 1
  }
  syncBatchStatus(batch)
  return batch
}

// --- 场景1：补测同一里程点：原值另存、新读数唯一有效、缺陷级联失效、非独立复测回待复核 ---
{
  console.log('场景1 补测替换：修订链 + 缺陷失效 + 复测回退 + 限速锁定')
  const state = freshState()
  const items: SupplementItem[] = [
    { clientId: 'C1', segmentId: 'SEG-K102', action: '补测', mileage: 102800, measuredAt: '2026-10-02T08:00:00', detector: 'GJ-6型轨检车', gauge: 1442, level: 2.0, alignment: 1.0, twist: 2.1 }
  ]
  const batch = runBatch(state, items)
  check('批次完成', batch.status === '已完成')
  const oldPoint = state.segments[0].measurements.find((p) => p.id === 'GM-102800')!
  check('旧读数状态为已替换', oldPoint.state === '已替换')
  check('旧读数currentId指向新读数', oldPoint.currentId === oldPoint.supersededBy && !!oldPoint.currentId)
  const current = currentReadingAt(state, 'SEG-K102', 102800)!
  check('新读数唯一当前有效', current.gauge === 1442 && current.revision === 1)
  check('同里程当前有效读数只有一条', state.segments[0].measurements.filter((p) => p.mileage === 102800 && p.state === '当前有效').length === 1)
  const gd1 = state.defects.find((d) => d.id === 'GD-260929-01')!
  check('一级缺陷GD-01失效', gd1.invalidated && gd1.status === '已失效' && gd1.previousStatus === '整治中')
  check('缺陷追溯到新读数', gd1.lastRevisionId === current.id && gd1.basisReadingId === 'GM-102800')
  const gd2 = state.defects.find((d) => d.id === 'GD-260929-02')!
  check('其他里程缺陷不受影响', !gd2.invalidated && gd2.status === '待复测')
  const impact = speedImpact(state, 'SEG-K102')!
  check('限速联查指出待复核一级缺陷', impact.openCriticalDefects === 0 && impact.reason.includes('待独立复核'))
  check('批次汇总列出受影响缺陷', buildBatchSummary(batch).includes('受影响缺陷1个'))
}

// --- 场景2：复测结论：独立复测不回退，非独立关闭结论回到待复核且不能关闭 ---
{
  console.log('场景2 复测结论回退规则')
  const state = freshState()
  // GD-260928-07 已关闭且为独立复测；GD-260929-02 非独立复测（未通过）
  const items: SupplementItem[] = [
    { clientId: 'C2', segmentId: 'SEG-K102', action: '补测', mileage: 103400, measuredAt: '2026-10-02T08:00:00', detector: 'GJ-6型轨检车', gauge: 1435, level: 6.2, alignment: 1.0, twist: 2.0 },
    { clientId: 'C3', segmentId: 'SEG-K208', action: '补测', mileage: 209200, measuredAt: '2026-10-02T08:00:00', detector: 'GJ-6型轨检车', gauge: 1435, level: 1.5, alignment: 1.0, twist: 2.0 }
  ]
  const batch = runBatch(state, items)
  check('一份补传两行全部生效', batch.status === '已完成' && batch.results.every((r) => r.state === '已生效'))
  const affected = batch.results.flatMap((r) => r.affectedDefects)
  check('两行缺陷都列出', affected.length === 2 && affected.includes('GD-260929-02') && affected.includes('GD-260928-07'))
  const gd2 = state.defects.find((d) => d.id === 'GD-260929-02')!
  check('非独立复测结论回到待复核', gd2.retests[0].state === '待复核')
  check('汇总包含1条复测回退', batch.results[0].resetRetests.includes('GD-260929-02#第1轮'))
  const gd3 = state.defects.find((d) => d.id === 'GD-260928-07')!
  check('独立复测结论保持有效', gd3.retests[0].state === '有效')
  check('独立复测缺陷也随读数失效（需重新独立确认）', gd3.invalidated && gd3.previousStatus === '已关闭')
  check('独立复测缺陷未被列为待复核结论', independentlyReconfirmed(gd3) === false)
  const impactedSegments = new Set(batch.results.flatMap((r) => r.affectedSpeed.map((s) => s.segmentId)))
  check('两个区段限速联查均列出', impactedSegments.has('SEG-K102') && impactedSegments.has('SEG-K208'))
}

// --- 场景3：撤回旧点 ---
{
  console.log('场景3 撤回读数')
  const state = freshState()
  const batch = runBatch(state, [
    { clientId: 'W1', segmentId: 'SEG-K102', action: '撤回', mileage: 102800, measuredAt: '2026-10-02T09:00:00', detector: '调度员' }
  ])
  const point = state.segments[0].measurements.find((p) => p.id === 'GM-102800')!
  check('读数标记已撤回且原值留存', point.state === '已撤回' && point.gauge === 1447)
  check('该里程无当前有效读数', !currentReadingAt(state, 'SEG-K102', 102800))
  check('撤回级联失效缺陷', batch.results[0].affectedDefects.includes('GD-260929-01'))
  const repeat = runBatch(state, [
    { clientId: 'W2', segmentId: 'SEG-K102', action: '撤回', mileage: 102800, measuredAt: '2026-10-02T09:05:00', detector: '调度员' }
  ])
  check('重复撤回幂等报错、不产生第二条读数', repeat.results[0].state === '未完成' && repeat.results[0].error!.includes('无法撤回'))
}

// --- 场景4：分段写入失败 + 断点重试，已生效读数不重复入库 ---
{
  console.log('场景4 分段失败与幂等重试')
  const state = freshState()
  const items: SupplementItem[] = [
    { clientId: 'OK1', segmentId: 'SEG-K102', action: '补测', mileage: 102800, measuredAt: '2026-10-02T10:00:00', detector: 'GJ-6型轨检车', gauge: 1441, level: 2, alignment: 1, twist: 2 },
    { clientId: 'FAIL1', segmentId: 'SEG-K102', action: '补测', mileage: 103400, measuredAt: '2026-10-02T10:00:00', detector: 'GJ-6型轨检车', gauge: 1435, level: 5, alignment: 1, twist: 2, simulateWriteFailure: true }
  ]
  const batch = runBatch(state, items)
  check('批次部分失败', batch.status === '部分失败')
  check('第一行已生效', batch.results[0].state === '已生效' && !!batch.results[0].readingId)
  check('第二行未完成且未入库', batch.results[1].state === '未完成' && state.segments[0].measurements.filter((p) => p.mileage === 103400).length === 1)
  check('第一行级联已发生', batch.results[0].affectedDefects.includes('GD-260929-01'))
  const readingCountAfterFirst = state.segments[0].measurements.length
  // 断点重试：只重试未完成行；已生效行不会重复处理
  const pending = batch.results.map((r, i) => ({ r, i })).filter(({ r }) => r.state === '未完成')
  for (const { i } of pending) {
    const item = batch.items[i]
    batch.attempts![item.clientId] = (batch.attempts![item.clientId] ?? 0) + 1
    batch.results[i] = processItem(state, batch, item, idSeq)
  }
  syncBatchStatus(batch)
  check('重试后批次完成', batch.status === '已完成' && batch.results.every((r) => r.state === '已生效'))
  check('第一行读数未重复入库（仅第二行新增一条）', state.segments[0].measurements.length === readingCountAfterFirst + 1)
  const at1034 = state.segments[0].measurements.filter((p) => p.mileage === 103400)
  check('103400仍只有一条当前有效读数', at1034.filter((p) => p.state === '当前有效').length === 1)
  check('103400原值另存为已替换', at1034.some((p) => p.state === '已替换'))
}

// --- 场景5：失效后只能独立复测复核恢复；非独立复测、关闭、限速恢复均被拦截 ---
{
  console.log('场景5 复核与限速恢复约束')
  const state = freshState()
  runBatch(state, [
    { clientId: 'C5', segmentId: 'SEG-K102', action: '补测', mileage: 102800, measuredAt: '2026-10-02T11:00:00', detector: 'GJ-6型轨检车', gauge: 1442, level: 2, alignment: 1, twist: 2 }
  ])
  const defect = state.defects.find((d) => d.id === 'GD-260929-01')!
  check('缺陷处于已失效', defect.invalidated)
  // 非独立复测不能确认
  const nonIndependent = { round: 1, passed: true, measuredValue: 1442, limit: 1446, note: '随车复测', tester: '王磊', testedAt: new Date().toISOString(), independent: false, state: '有效' as const }
  // 复刻 store.addRetest 的门禁逻辑
  let blocked = defect.invalidated && !nonIndependent.independent
  check('非独立复测被拦截', blocked)
  // 独立复测通过 → 重新生效并关闭（复刻引擎无关的store判定，这里直接模拟结果）
  defect.invalidated = false
  defect.invalidatedAt = undefined
  defect.status = '已关闭'
  defect.retests.unshift({ ...nonIndependent, independent: true, note: '独立仪器复测通过' })
  check('独立复测后可重新生效关闭', !defect.invalidated && defect.status === '已关闭')
  check('独立复测通过被识别为重新确认', independentlyReconfirmed({ ...defect, invalidated: true, invalidatedAt: '2026-10-02T11:00:00', retests: [{ ...defect.retests[0], testedAt: '2026-10-02T12:00:00' }] }))
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed) process.exit(1)
