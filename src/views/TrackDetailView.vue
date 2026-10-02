<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import MileageCanvas from '../components/MileageCanvas.vue'
import { useTrackStore } from '../stores/track'
import type { SupplementAction, SupplementItem } from '../types'

const store = useTrackStore()
const speed = ref(store.selectedSegment?.speedLimit ?? 160)
const temporary = ref<number | undefined>(store.selectedSegment?.temporarySpeedLimit)
const message = ref('')
const segmentDefects = computed(() => store.defects.filter((item) => item.segmentId === store.selectedSegmentId))
const speedImpact = computed(() => store.selectedSegment ? store.speedImpact(store.selectedSegment.id) : undefined)

const segmentBatches = computed(() => store.batches.filter((batch) => batch.items.some((item) => item.segmentId === store.selectedSegmentId)))

const form = reactive({
  action: '补测' as SupplementAction,
  mileage: 0,
  gauge: 1447,
  level: 2.1,
  alignment: 1.2,
  twist: 3.4,
  measuredAt: '',
  detector: 'GJ-6型轨检车',
  simulateWriteFailure: false
})
const secondRow = reactive<{ enabled: boolean; action: SupplementAction; mileage: number; gauge: number; level: number; alignment: number; twist: number; simulateWriteFailure: boolean }>({
  enabled: false, action: '撤回', mileage: 0, gauge: 1438, level: 1.8, alignment: 1.0, twist: 2.6, simulateWriteFailure: false
})

const mileageOptions = computed(() => store.currentReadings(store.selectedSegmentId).map((item) => ({ title: fmtMileage(item.mileage), value: item.mileage })))
watch(() => store.selectedSegmentId, () => {
  speed.value = store.selectedSegment?.speedLimit ?? 160
  temporary.value = store.selectedSegment?.temporarySpeedLimit
  form.mileage = mileageOptions.value[0]?.value ?? 0
  secondRow.mileage = mileageOptions.value[1]?.value ?? mileageOptions.value[0]?.value ?? 0
}, { immediate: true })

function nowLocal() {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}
form.measuredAt = nowLocal()

function currentAt(mileage: number) {
  return store.selectedSegment ? store.currentReadingAt(store.selectedSegment.id, mileage) : undefined
}

function submitSupplement() {
  message.value = ''
  if (!store.selectedSegment) return
  const base: SupplementItem = {
    clientId: `C-${Date.now()}-1`,
    segmentId: store.selectedSegment.id,
    action: form.action,
    mileage: form.mileage,
    measuredAt: new Date(form.measuredAt || Date.now()).toISOString(),
    detector: form.detector,
    simulateWriteFailure: form.simulateWriteFailure
  }
  if (form.action === '补测') Object.assign(base, { gauge: Number(form.gauge), level: +Number(form.level).toFixed(2), alignment: +Number(form.alignment).toFixed(2), twist: +Number(form.twist).toFixed(2) })
  const items = [base]
  if (secondRow.enabled) {
    const extra: SupplementItem = {
      clientId: `C-${Date.now()}-2`,
      segmentId: store.selectedSegment.id,
      action: secondRow.action,
      mileage: secondRow.mileage,
      measuredAt: new Date().toISOString(),
      detector: form.detector,
      simulateWriteFailure: secondRow.simulateWriteFailure
    }
    if (secondRow.action === '补测') Object.assign(extra, { gauge: Number(secondRow.gauge), level: +Number(secondRow.level).toFixed(2), alignment: +Number(secondRow.alignment).toFixed(2), twist: +Number(secondRow.twist).toFixed(2) })
    items.push(extra)
  }
  const id = store.ingestSupplement(form.detector, items)
  const batch = store.batches.find((item) => item.id === id)
  message.value = batch?.status === '已完成'
    ? `补传批次${id}全部生效`
    : `补传批次${id}部分写入失败，可对未完成行重试（已生效读数不重复入库）`
}

function retry(id: string) {
  store.retryBatch(id)
  message.value = '未完成行已重试'
}

function saveSpeed() {
  const result = store.updateSegmentSpeed(store.selectedSegmentId, speed.value, temporary.value)
  message.value = result.message
}

function fmtMileage(mileage: number) {
  return `K${Math.floor(mileage / 1000)}+${String(mileage % 1000).padStart(3, '0')}`
}

const readingHistory = computed(() => {
  if (!store.selectedSegment) return []
  return [...store.selectedSegment.measurements]
    .sort((a, b) => b.mileage - a.mileage || b.revision - a.revision)
    .slice(0, 18)
})
</script>

<template>
  <section class="page">
    <div class="split">
      <div class="segment-list">
        <button v-for="segment in store.segments" :key="segment.id" :class="{ active: segment.id === store.selectedSegmentId }" @click="store.selectedSegmentId = segment.id; speed = segment.speedLimit; temporary = segment.temporarySpeedLimit">
          <span>{{ segment.id }} · V{{ segment.version }}</span><strong>{{ segment.line }}</strong><small>K{{ Math.floor(segment.startMileage / 1000) }}+{{ String(segment.startMileage % 1000).padStart(3, '0') }} - K{{ Math.floor(segment.endMileage / 1000) }}+{{ String(segment.endMileage % 1000).padStart(3, '0') }}</small>
        </button>
      </div>
      <div v-if="store.selectedSegment" class="track-main">
        <div class="section-head"><div><span>{{ store.selectedSegment.id }}</span><h2>{{ store.selectedSegment.line }}</h2><p>正式限速 {{ store.selectedSegment.speedLimit }} km/h<template v-if="store.selectedSegment.temporarySpeedLimit"> · 临时限速 {{ store.selectedSegment.temporarySpeedLimit }} km/h</template></p></div><v-chip color="warning">区段版本 V{{ store.selectedSegment.version }}</v-chip></div>
        <MileageCanvas :segment="store.selectedSegment" :defects="segmentDefects" />

        <div class="supplement-panel">
          <div class="supplement-head"><strong>轨检车补传回传</strong><span>同一里程仅一条当前有效读数；补测另存原值，撤回标记失效；受影响缺陷与区段限速一并列出</span></div>
          <div class="supplement-form">
            <v-select v-model="form.action" :items="['补测', '撤回']" label="操作" density="compact" variant="outlined" hide-details style="max-width: 100px" />
            <v-select v-model="form.mileage" :items="mileageOptions" item-title="title" item-value="value" label="里程" density="compact" variant="outlined" hide-details />
            <template v-if="form.action === '补测'">
              <v-text-field v-model.number="form.gauge" type="number" label="轨距" density="compact" variant="outlined" hide-details />
              <v-text-field v-model.number="form.level" type="number" label="高低" density="compact" variant="outlined" hide-details />
              <v-text-field v-model.number="form.alignment" type="number" label="方向" density="compact" variant="outlined" hide-details />
              <v-text-field v-model.number="form.twist" type="number" label="三角坑" density="compact" variant="outlined" hide-details />
            </template>
            <v-text-field v-model="form.detector" label="检测来源" density="compact" variant="outlined" hide-details />
            <v-text-field v-model="form.measuredAt" type="datetime-local" label="测量时间" density="compact" variant="outlined" hide-details />
            <v-checkbox v-model="form.simulateWriteFailure" label="模拟该行写入失败" density="compact" hide-details color="warning" />
            <v-btn color="primary" @click="submitSupplement">提交补传</v-btn>
          </div>
          <div class="second-row">
            <v-checkbox v-model="secondRow.enabled" label="同一补传追加第二行（演示分段失败/跨行级联）" density="compact" hide-details />
            <template v-if="secondRow.enabled">
              <v-select v-model="secondRow.action" :items="['补测', '撤回']" label="操作" density="compact" variant="outlined" hide-details style="max-width: 100px" />
              <v-select v-model="secondRow.mileage" :items="mileageOptions" item-title="title" item-value="value" label="里程" density="compact" variant="outlined" hide-details />
              <template v-if="secondRow.action === '补测'">
                <v-text-field v-model.number="secondRow.gauge" type="number" label="轨距" density="compact" variant="outlined" hide-details />
                <v-text-field v-model.number="secondRow.level" type="number" label="高低" density="compact" variant="outlined" hide-details />
                <v-text-field v-model.number="secondRow.alignment" type="number" label="方向" density="compact" variant="outlined" hide-details />
                <v-text-field v-model.number="secondRow.twist" type="number" label="三角坑" density="compact" variant="outlined" hide-details />
              </template>
              <v-checkbox v-model="secondRow.simulateWriteFailure" label="模拟该行写入失败" density="compact" hide-details color="warning" />
            </template>
          </div>
          <div v-if="form.mileage && currentAt(form.mileage)" class="current-reading">
            将影响当前读数 <code>{{ currentAt(form.mileage)?.id }}</code>（R{{ currentAt(form.mileage)?.revision }}）：
            轨距 {{ currentAt(form.mileage)?.gauge }} / 高低 {{ currentAt(form.mileage)?.level }} / 方向 {{ currentAt(form.mileage)?.alignment }} / 三角坑 {{ currentAt(form.mileage)?.twist }}
            —— {{ form.action === '补测' ? '原值另存为“已替换”，新读数成为唯一当前有效读数' : '原值留存并标记“已撤回”' }}
          </div>
        </div>

        <div v-if="segmentBatches.length" class="batch-panel">
          <div class="supplement-head"><strong>补传批次与修订结果</strong><span>一份补传内受影响缺陷、回到待复核的复测结论、区段限速统一列出</span></div>
          <div v-for="batch in segmentBatches" :key="batch.id" class="batch-card">
            <div class="batch-title">
              <v-chip size="small" :color="batch.status === '已完成' ? 'success' : batch.status === '部分失败' ? 'warning' : 'error'">{{ batch.status }}</v-chip>
              <strong>{{ batch.id }}</strong><span>{{ batch.detector }} · {{ batch.receivedAt.replace('T', ' ').slice(0, 16) }}</span>
              <v-btn v-if="batch.results.some((r) => r.state === '未完成')" size="small" color="warning" variant="outlined" @click="retry(batch.id)">重试未完成行（{{ batch.results.filter((r) => r.state === '未完成').length }}）</v-btn>
            </div>
            <v-table density="compact">
              <thead><tr><th>行</th><th>里程</th><th>操作</th><th>入库结果</th><th>失效缺陷</th><th>复测结论</th><th>区段限速联查</th></tr></thead>
              <tbody>
                <tr v-for="row in batch.results" :key="row.clientId" :class="{ failed: row.state === '未完成' }">
                  <td>{{ row.clientId }}</td>
                  <td>{{ fmtMileage(row.mileage) }}</td>
                  <td>{{ row.action }}</td>
                  <td>
                    <v-chip size="small" :color="row.state === '已生效' ? 'success' : 'error'">{{ row.state }}</v-chip>
                    <span v-if="row.readingId" class="mono">{{ row.readingId }}</span>
                    <div v-if="row.error" class="row-error">{{ row.error }}</div>
                  </td>
                  <td>
                    <span v-if="!row.affectedDefects.length" class="muted">无</span>
                    <v-chip v-for="id in row.affectedDefects" :key="id" size="small" color="error">{{ id }}</v-chip>
                  </td>
                  <td>
                    <span v-if="!row.resetRetests.length" class="muted">无</span>
                    <v-chip v-for="label in row.resetRetests" :key="label" size="small" color="warning">{{ label }}→待复核</v-chip>
                  </td>
                  <td>
                    <div v-for="impact in row.affectedSpeed" :key="impact.segmentId" class="impact">
                      <v-chip size="small" :color="impact.openCriticalDefects ? 'error' : 'warning'">{{ impact.line }}</v-chip>
                      <span>{{ impact.reason }}</span>
                    </div>
                    <span v-if="!row.affectedSpeed.length" class="muted">无需调整</span>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>
        </div>

        <div class="speed-panel">
          <div><strong>速度与限速联查</strong><p>依据当前修订结果：一级缺陷失效后未独立复核，或仍未关闭时，不能恢复/提高临时限速；保存后区段版本递增。</p></div>
          <v-text-field v-model.number="speed" label="正式限速" suffix="km/h" density="compact" variant="outlined" hide-details />
          <v-text-field v-model.number="temporary" label="临时限速" suffix="km/h" density="compact" variant="outlined" hide-details clearable />
          <v-btn color="primary" @click="saveSpeed">保存速度版本</v-btn>
        </div>
        <div v-if="speedImpact" class="impact-band" :class="{ blocked: speedImpact.openCriticalDefects > 0 }">{{ speedImpact.reason }}</div>
        <div v-if="message" class="validation-message">{{ message }}</div>

        <v-table density="compact">
          <thead><tr><th>关联缺陷</th><th>依据读数</th><th>里程</th><th>类型</th><th>严重度</th><th>状态</th></tr></thead>
          <tbody>
            <tr v-for="item in segmentDefects" :key="item.id" :class="{ invalid: item.invalidated }">
              <td>{{ item.id }}</td>
              <td class="mono">{{ item.basisReadingId }}<template v-if="item.lastRevisionId"> → {{ item.lastRevisionId }}</template></td>
              <td>{{ fmtMileage(item.mileage) }}</td>
              <td>{{ item.type }}</td>
              <td>{{ item.severity }}</td>
              <td><v-chip size="small" :color="item.invalidated ? 'grey' : item.status === '已关闭' ? 'success' : 'warning'">{{ item.status }}</v-chip><span v-if="item.previousStatus && item.invalidated" class="muted">（原{{ item.previousStatus }}）</span></td>
            </tr>
          </tbody>
        </v-table>

        <div class="history-panel">
          <strong>读数修订历史（原值留痕，可追溯）</strong>
          <v-table density="compact">
            <thead><tr><th>读数ID</th><th>里程</th><th>轨距/高低/方向/三角坑</th><th>状态</th><th>版本</th><th>来源批次</th><th>替换/撤回于</th></tr></thead>
            <tbody>
              <tr v-for="point in readingHistory" :key="point.id" :class="{ stale: point.state !== '当前有效' }">
                <td class="mono">{{ point.id }}</td>
                <td>{{ fmtMileage(point.mileage) }}</td>
                <td>{{ point.gauge }} / {{ point.level }} / {{ point.alignment }} / {{ point.twist }}</td>
                <td><v-chip size="small" :color="point.state === '当前有效' ? 'success' : point.state === '已撤回' ? 'error' : 'grey'">{{ point.state }}</v-chip></td>
                <td>R{{ point.revision }}</td>
                <td class="mono">{{ point.sourceBatchId }}</td>
                <td class="mono">{{ point.supersededBy ?? '—' }}</td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.split { display: grid; grid-template-columns: 300px 1fr; gap: 14px; align-items: start; }
.segment-list { display: grid; gap: 8px; }
.segment-list button { background: white; border: 1px solid #dae1e2; padding: 13px; text-align: left; display: grid; gap: 6px; cursor: pointer; border-radius: 4px; }
.segment-list button.active { border-color: #315b72; box-shadow: inset 3px 0 #315b72; }
.segment-list span, .segment-list small { color: #748180; font-size: 11px; }
.track-main { background: white; border: 1px solid #dae1e2; padding: 18px; }
.section-head { display: flex; justify-content: space-between; margin-bottom: 14px; }
.section-head span { color: #738180; font-size: 11px; }.section-head h2 { margin: 4px 0; font-size: 20px; }.section-head p { margin: 0; color: #60706f; }
.supplement-panel, .batch-panel, .history-panel { border: 1px solid #d7dfdf; border-radius: 4px; padding: 12px; margin: 14px 0; background: #fbfdfc; }
.supplement-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; gap: 12px; }
.supplement-head span { color: #71807f; font-size: 11px; }
.supplement-form { display: grid; grid-template-columns: 100px 190px repeat(4, 1fr) 170px 170px 150px auto; gap: 8px; align-items: center; }
.second-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 1px dashed #d7dfdf; }
.second-row .v-select, .second-row .v-text-field { max-width: 150px; }
.current-reading { margin-top: 10px; font-size: 11px; color: #5e6d6c; background: #f1f5f4; padding: 8px 10px; }
.current-reading code, .mono { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #315b72; }
.batch-card { border: 1px solid #e1e6e6; border-radius: 4px; padding: 8px 10px; margin-top: 10px; }
.batch-title { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.batch-title span { color: #71807f; font-size: 11px; margin-right: auto; }
.batch-card tr.failed { background: #fdf3f2; }
.row-error { color: #a33a35; font-size: 11px; margin-top: 3px; }
.impact { display: flex; gap: 6px; align-items: center; margin: 2px 0; font-size: 11px; color: #5e6d6c; }
.muted { color: #93a09f; font-size: 11px; }
tr.invalid td { color: #8a9695; }
tr.stale td { color: #8a9695; }
.speed-panel { display: grid; grid-template-columns: 1fr 130px 130px auto; gap: 10px; align-items: center; margin: 14px 0; padding: 12px; background: #f4f7f7; }
.speed-panel p { margin: 4px 0 0; color: #71807f; font-size: 11px; }
.impact-band { font-size: 12px; color: #6d5f3e; background: #fbf6e9; border-left: 3px solid #b18b38; padding: 8px 10px; margin-bottom: 10px; }
.impact-band.blocked { color: #a33a35; background: #fdf3f2; border-left-color: #b84239; }
.validation-message { color: #a33a35; font-size: 12px; margin-bottom: 10px; }
.history-panel table { margin-top: 8px; }
</style>
