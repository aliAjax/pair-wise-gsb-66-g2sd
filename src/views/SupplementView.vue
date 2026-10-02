<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTrackStore } from '../stores/track'
import type { BatchOutcome, GeometryMeasurement, SupplementItemInput } from '../types'
import { formatMileage } from '../utils/format'

const store = useTrackStore()
const source = ref('GJ-6型轨检车（补测回传）')
const segmentId = ref(store.segments[0]?.id ?? '')
const kind = ref<'补测' | '撤回'>('补测')
const mileageInput = ref(String(store.presentSegments[0]?.measurements[0]?.mileage ?? ''))
const gauge = ref(1435)
const level = ref(1.5)
const alignment = ref(0.8)
const twist = ref(1.0)
const detector = ref('GJ-6型轨检车')
const measuredAt = ref('2026-10-02T03:00')
const note = ref('')
const draft = ref<SupplementItemInput[]>([])
const simulateFail = ref(true)
const outcomes = ref<BatchOutcome[]>([])
const expandedBatch = ref<string | null>(null)

const currentSegment = computed(() => store.segments.find((item) => item.id === segmentId.value))
const presentSegment = computed(() => store.presentSegments.find((item) => item.id === segmentId.value))
const mileageOptions = computed(() => {
  const items = presentSegment.value?.measurements.map((item) => ({ title: `${formatMileage(item.mileage)}（当前R${item.revision}，轨距${item.gauge}）`, value: String(item.mileage) })) ?? []
  if (!items.some((item) => item.value === mileageInput.value)) items.unshift({ title: `${mileageInput.value || '请输入'}（新增里程点）`, value: mileageInput.value })
  return items
})

function addDraft() {
  const mileage = Number(mileageInput.value)
  if (!currentSegment.value || !mileage) return
  draft.value.push({
    segmentId: segmentId.value,
    mileage,
    kind: kind.value,
    gauge: Number(gauge.value),
    level: Number(level.value),
    alignment: Number(alignment.value),
    twist: Number(twist.value),
    measuredAt: `${measuredAt.value}:00`,
    detector: detector.value,
    note: note.value || undefined
  })
  note.value = ''
}

function removeDraft(index: number) {
  draft.value.splice(index, 1)
}

function loadExample() {
  const k102 = store.segments.find((item) => item.id === 'SEG-K102')
  const k208 = store.segments.find((item) => item.id === 'SEG-K208')
  draft.value = []
  if (k102) {
    // 同一里程点（GD-260929-01 轨距一级缺陷处）补测合格读数，旧值另存
    draft.value.push({ segmentId: 'SEG-K102', mileage: 102800, kind: '补测', gauge: 1440, level: 1.6, alignment: 0.9, twist: 1.2, measuredAt: '2026-10-02T03:00:00', detector: 'GJ-6型轨检车', note: '补测：轨距恢复' })
    // 第二条（GD-260929-02 高低缺陷处）补测，用于演示首段失败后的断点重试
    draft.value.push({ segmentId: 'SEG-K102', mileage: 103400, kind: '补测', gauge: 1434, level: 2.1, alignment: 1.0, twist: 1.1, measuredAt: '2026-10-02T03:00:00', detector: 'GJ-6型轨检车' })
  }
  if (k208) {
    // 撤回已关闭三角坑缺陷所在检测点
    draft.value.push({ segmentId: 'SEG-K208', mileage: 209200, kind: '撤回', gauge: 0, level: 0, alignment: 0, twist: 0, measuredAt: '2026-10-02T03:05:00', detector: 'GJ-6型轨检车', note: '该点GPS漂移，轨检车撤回' })
  }
}

function submit() {
  if (!draft.value.length) return
  // 演示用：模拟第2条首段写入失败；已生效条目落库后只重试未完成部分
  const gateKey = simulateFail.value && draft.value.length > 1 ? store.itemKey(draft.value[1], 1) : undefined
  const batch = store.receiveSupplementBatch(structuredClone(draft.value), source.value, gateKey)
  outcomes.value.unshift(store.processSupplementBatch(batch.id))
  draft.value = []
}

function retry(batchId: string) {
  const outcome = store.processSupplementBatch(batchId)
  const index = outcomes.value.findIndex((item) => item.batchId === batchId)
  if (index >= 0) outcomes.value[index] = outcome
  else outcomes.value.unshift(outcome)
}

function toggle(id: string) {
  expandedBatch.value = expandedBatch.value === id ? null : id
}

function readingLabel(reading: GeometryMeasurement) {
  const segment = store.segments.find((item) => item.id === reading.segmentId)
  return `${segment?.line ?? reading.segmentId} ${formatMileage(reading.mileage)} R${reading.revision}`
}
</script>

<template>
  <section class="page supplement-page">
    <div class="section-head">
      <div><h2>轨检车补测回传与修订入库</h2><p>同一里程点只保留一条当前有效读数，补测另存原值、撤回保留痕迹；读数更新即联动失效缺陷与复测结论，并列出受影响区段限速。</p></div>
      <v-btn variant="outlined" @click="loadExample">填入演示补传</v-btn>
    </div>

    <div class="entry-panel">
      <v-select v-model="segmentId" :items="store.segments.map((item) => ({ title: item.line, value: item.id }))" label="区段" density="compact" variant="outlined" hide-details style="min-width: 230px" />
      <v-select v-model="kind" :items="['补测', '撤回']" label="类型" density="compact" variant="outlined" hide-details style="width: 100px" />
      <v-combobox v-model="mileageInput" :items="mileageOptions" item-value="value" item-title="title" label="里程" density="compact" variant="outlined" hide-details style="min-width: 240px" />
      <template v-if="kind === '补测'">
        <v-text-field v-model.number="gauge" type="number" label="轨距" density="compact" variant="outlined" hide-details width="90px" />
        <v-text-field v-model.number="level" type="number" label="高低" density="compact" variant="outlined" hide-details width="90px" />
        <v-text-field v-model.number="alignment" type="number" label="方向" density="compact" variant="outlined" hide-details width="90px" />
        <v-text-field v-model.number="twist" type="number" label="三角坑" density="compact" variant="outlined" hide-details width="90px" />
      </template>
      <v-text-field v-model="detector" label="检测设备" density="compact" variant="outlined" hide-details style="min-width: 180px" />
      <v-text-field v-model="measuredAt" label="测量时间" density="compact" variant="outlined" hide-details style="min-width: 170px" />
      <v-text-field v-model="note" label="说明" density="compact" variant="outlined" hide-details style="min-width: 180px" />
      <v-btn color="primary" @click="addDraft">加入补传</v-btn>
    </div>

    <div v-if="draft.length" class="draft-panel">
      <table>
        <thead><tr><th>#</th><th>区段</th><th>里程</th><th>类型</th><th>轨距</th><th>高低</th><th>方向</th><th>三角坑</th><th>时间</th><th>说明</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(item, index) in draft" :key="index">
            <td>{{ index + 1 }}</td>
            <td>{{ store.segments.find((s) => s.id === item.segmentId)?.line }}</td>
            <td>{{ formatMileage(item.mileage) }}</td>
            <td><v-chip size="small" :color="item.kind === '撤回' ? 'error' : 'warning'">{{ item.kind }}</v-chip></td>
            <td>{{ item.gauge }}</td><td>{{ item.level }}</td><td>{{ item.alignment }}</td><td>{{ item.twist }}</td>
            <td>{{ item.measuredAt.replace('T', ' ').slice(5, 16) }}</td><td>{{ item.note ?? '—' }}</td>
            <td><v-btn size="small" variant="text" @click="removeDraft(index)">移除</v-btn></td>
          </tr>
        </tbody>
      </table>
      <div class="submit-bar">
        <v-checkbox v-model="simulateFail" density="compact" hide-details label="模拟第2条写入失败（验证断点重试、已生效不重复入库）" />
        <v-text-field v-model="source" label="补传来源" density="compact" variant="outlined" hide-details style="min-width: 240px" />
        <v-btn color="primary" size="large" @click="submit">接收并写入补传（{{ draft.length }}条）</v-btn>
      </div>
    </div>

    <div v-for="outcome in outcomes" :key="outcome.batchId" class="outcome-panel">
      <div class="outcome-head">
        <strong>{{ outcome.batchId }}</strong>
        <v-chip size="small" :color="outcome.status === '已完成' ? 'success' : 'warning'">{{ outcome.status }}</v-chip>
        <span>新生效 {{ outcome.processed }} 条 · 幂等跳过 {{ outcome.duplicated }} 条 · 失败 {{ outcome.failed }} 条 · 待处理 {{ outcome.pending }} 条</span>
        <v-btn v-if="outcome.status !== '已完成'" color="primary" size="small" @click="retry(outcome.batchId)">重试未完成部分（{{ outcome.pending }}条）</v-btn>
      </div>
      <div v-if="outcome.error" class="outcome-error">写入中断：{{ outcome.error }}</div>

      <div class="impact-grid">
        <div class="impact-col">
          <h4>受影响读数（修订链）</h4>
          <div v-for="reading in outcome.affectedReadings" :key="reading.revisionId" class="impact-item">
            <strong>{{ readingLabel(reading) }}</strong>
            <span :class="['reading-state', reading.status]">{{ reading.status }}</span>
            <small v-if="reading.reason">{{ reading.reason }}</small>
          </div>
          <div v-if="!outcome.affectedReadings.length" class="empty">本批无新生效读数</div>
        </div>
        <div class="impact-col">
          <h4>受影响缺陷与复测结论</h4>
          <div v-for="info in outcome.affectedDefects" :key="info.defectId" class="impact-item">
            <strong>{{ info.defectId }} · {{ info.type }} · {{ formatMileage(info.mileage) }}</strong>
            <span class="reading-state 已替换">{{ info.previousStatus }} → 已失效</span>
            <small>{{ info.pendingRetests }} 条未独立复测的结论回到待复核，不得继续关闭</small>
          </div>
          <div v-if="!outcome.affectedDefects.length" class="empty">本批无缺陷受影响</div>
        </div>
        <div class="impact-col">
          <h4>受影响区段限速</h4>
          <div v-for="seg in outcome.affectedSegments" :key="seg.segmentId" class="impact-item">
            <strong>{{ seg.line }} · V{{ seg.previousVersion }} → V{{ seg.currentVersion }}</strong>
            <span :class="['reading-state', seg.revisionHold ? '已撤回' : '有效']">{{ seg.revisionHold ? '复核挂起：临时限速不得恢复' : '无挂起' }}</span>
            <small>关联失效缺陷 {{ seg.affectedDefects.length }} 项</small>
          </div>
          <div v-if="!outcome.affectedSegments.length" class="empty">本批无区段版本变化</div>
        </div>
      </div>
    </div>

    <div class="batch-history">
      <h3>补传批次与断点状态</h3>
      <div v-for="batch in store.batches" :key="batch.id" class="batch-row">
        <div class="batch-main" @click="toggle(batch.id)">
          <strong>{{ batch.id }}</strong>
          <span>{{ batch.receivedAt.replace('T', ' ').slice(5, 16) }}</span>
          <v-chip size="small" :color="batch.status === '已完成' ? 'success' : 'warning'">{{ batch.status }}</v-chip>
          <span>{{ batch.appliedItemKeys.length }}/{{ batch.items.length }} 条已生效</span>
          <small v-if="batch.lastError" class="batch-error">{{ batch.lastError }}</small>
          <v-btn v-if="batch.status !== '已完成'" size="small" color="primary" variant="outlined" @click.stop="retry(batch.id)">重试未完成部分</v-btn>
        </div>
        <div v-if="expandedBatch === batch.id" class="batch-detail">
          <div v-for="(item, index) in batch.items" :key="index" :class="['batch-item', { done: store.itemKey(item, index) && batch.appliedItemKeys.includes(store.itemKey(item, index)), fail: batch.failedItemKey === store.itemKey(item, index) }]">
            <span>{{ index + 1 }}. {{ store.segments.find((s) => s.id === item.segmentId)?.line }} · {{ formatMileage(item.mileage) }} · {{ item.kind }}</span>
            <small v-if="batch.appliedItemKeys.includes(store.itemKey(item, index))">已生效（重试时不重复入库）</small>
            <small v-else-if="batch.failedItemKey === store.itemKey(item, index)">写入失败，待重试</small>
            <small v-else>未写入，待重试</small>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.supplement-page { display: grid; gap: 14px; }
.section-head { display: flex; justify-content: space-between; align-items: flex-start; }
.section-head h2 { margin: 0 0 5px; font-size: 19px; }.section-head p { margin: 0; color: #71807e; font-size: 12px; max-width: 760px; }
.entry-panel { background: white; border: 1px solid #dae2e3; padding: 14px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.draft-panel { background: white; border: 1px solid #dae2e3; padding: 12px; }
.draft-panel table { width: 100%; border-collapse: collapse; font-size: 12px; }
.draft-panel th, .draft-panel td { border-bottom: 1px solid #e6ebeb; padding: 7px 8px; text-align: left; }
.draft-panel th { color: #718080; font-weight: 500; }
.submit-bar { display: flex; gap: 12px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
.outcome-panel { background: white; border: 1px solid #dae2e3; padding: 14px; border-left: 4px solid #315b72; }
.outcome-head { display: flex; gap: 12px; align-items: center; font-size: 13px; flex-wrap: wrap; }
.outcome-head span { color: #60706f; font-size: 12px; }
.outcome-error { margin-top: 8px; padding: 8px 10px; background: #fbecea; color: #a33a35; font-size: 12px; border-left: 3px solid #b84239; }
.impact-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 12px; }
.impact-col h4 { margin: 0 0 8px; font-size: 13px; color: #315b72; }
.impact-item { border-top: 1px solid #e5eaea; padding: 8px 2px; display: grid; gap: 3px; }
.impact-item strong { font-size: 12px; }
.impact-item small { color: #738180; font-size: 11px; }
.reading-state { justify-self: start; font-size: 10px; padding: 1px 7px; border-radius: 9px; }
.reading-state.有效 { background: #e5f1ea; color: #2f6b4f; }
.reading-state.已替换 { background: #fbf0da; color: #8c6a2f; }
.reading-state.已撤回 { background: #f6e2e0; color: #a33a35; }
.empty { color: #9aa5a5; font-size: 11px; }
.batch-history { background: white; border: 1px solid #dae2e3; padding: 14px; }
.batch-history h3 { margin: 0 0 10px; font-size: 15px; }
.batch-row { border-top: 1px solid #e5eaea; }
.batch-main { display: flex; gap: 12px; align-items: center; padding: 10px 2px; cursor: pointer; font-size: 12px; }
.batch-main > span, .batch-main small { color: #718080; }
.batch-error { color: #a33a35 !important; }
.batch-detail { padding: 0 0 10px 18px; display: grid; gap: 4px; }
.batch-item { display: flex; gap: 10px; font-size: 12px; color: #536362; }
.batch-item small { color: #8b9897; }
.batch-item.done small { color: #2f6b4f; }
.batch-item.fail span, .batch-item.fail small { color: #a33a35; font-weight: 600; }
</style>
