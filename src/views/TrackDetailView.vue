<script setup lang="ts">
import { computed, ref } from 'vue'
import MileageCanvas from '../components/MileageCanvas.vue'
import { useTrackStore } from '../stores/track'
import type { GeometryMeasurement } from '../types'
import { formatMileage } from '../utils/format'

const store = useTrackStore()
const speed = ref(store.selectedSegment?.speedLimit ?? 160)
const temporary = ref<number | undefined>(store.selectedSegment?.temporarySpeedLimit)
const message = ref('')
const segmentDefects = computed(() => store.defects.filter((item) => item.segmentId === store.selectedSegmentId))
const revisionHold = computed(() => store.selectedSegmentId ? store.segmentRevisionHold(store.selectedSegmentId) : false)
const invalidDefects = computed(() => segmentDefects.value.filter((item) => item.status === '已失效' && !item.revisionResolvedAt))

const revisionRows = computed(() => {
  const segment = store.segments.find((item) => item.id === store.selectedSegmentId)
  if (!segment) return []
  const byPoint = new Map<string, GeometryMeasurement[]>()
  for (const reading of segment.measurements) {
    if (!byPoint.has(reading.pointId)) byPoint.set(reading.pointId, [])
    byPoint.get(reading.pointId)!.push(reading)
  }
  return [...byPoint.values()]
    .filter((chain) => chain.length > 1 || chain.some((item) => item.status !== '有效'))
    .map((chain) => chain.sort((a, b) => b.revision - a.revision))
})

function selectSegment(id: string) {
  store.selectedSegmentId = id
  const segment = store.presentSegments.find((item) => item.id === id)
  speed.value = segment?.speedLimit ?? 160
  temporary.value = segment?.temporarySpeedLimit
  message.value = ''
}

function saveSpeed() {
  const result = store.updateSegmentSpeed(store.selectedSegmentId, speed.value, temporary.value)
  message.value = result.message
}
</script>

<template>
  <section class="page">
    <div class="split">
      <div class="segment-list">
        <button v-for="segment in store.segments" :key="segment.id" :class="{ active: segment.id === store.selectedSegmentId }" @click="selectSegment(segment.id)">
          <span>{{ segment.id }} · V{{ segment.version }}</span><strong>{{ segment.line }}</strong><small>{{ formatMileage(segment.startMileage) }} - {{ formatMileage(segment.endMileage) }}</small>
          <small v-if="store.segmentRevisionHold(segment.id)" class="hold-flag">补测复核挂起中</small>
        </button>
      </div>
      <div v-if="store.selectedSegment" class="track-main">
        <div class="section-head"><div><span>{{ store.selectedSegment.id }}</span><h2>{{ store.selectedSegment.line }}</h2><p>正式限速 {{ store.selectedSegment.speedLimit }} km/h<template v-if="store.selectedSegment.temporarySpeedLimit"> · 临时限速 {{ store.selectedSegment.temporarySpeedLimit }} km/h</template></p></div><v-chip color="warning">区段版本 V{{ store.selectedSegment.version }}</v-chip></div>
        <div v-if="revisionHold" class="hold-banner">
          <strong>补测复核挂起</strong>
          <span>该区段 {{ invalidDefects.length }} 项缺陷依据读数已被补测修订/撤回，须独立复测结案；结案前临时限速不能恢复，相关缺陷不能关闭。</span>
        </div>
        <MileageCanvas :segment="store.selectedSegment" :defects="segmentDefects" />
        <div class="speed-panel">
          <div><strong>速度与限速联查</strong><p>一级缺陷未关闭时，临时限速必须低于正式限速；补测失效缺陷未独立复测前临时限速不得恢复。保存后区段版本递增。</p></div>
          <v-text-field v-model.number="speed" label="正式限速" suffix="km/h" density="compact" variant="outlined" hide-details />
          <v-text-field v-model.number="temporary" label="临时限速" suffix="km/h" density="compact" variant="outlined" hide-details clearable />
          <v-btn color="primary" @click="saveSpeed">保存速度版本</v-btn>
        </div>
        <div v-if="message" class="validation-message">{{ message }}</div>
        <v-table density="compact">
          <thead><tr><th>关联缺陷</th><th>里程</th><th>类型</th><th>严重度</th><th>状态</th><th>读数依据</th></tr></thead>
          <tbody><tr v-for="item in segmentDefects" :key="item.id" :class="{ rowInvalid: item.status === '已失效' && !item.revisionResolvedAt }"><td>{{ item.id }}</td><td>{{ formatMileage(item.mileage) }}</td><td>{{ item.type }}</td><td>{{ item.severity }}</td><td>{{ item.status }}</td><td class="rev-cell">{{ item.sourceRevisionId }}</td></tr></tbody>
        </v-table>

        <div class="revision-panel">
          <h3>检测点读数修订链（同里程点仅一条当前有效，补测另存原值）</h3>
          <div v-if="!revisionRows.length" class="empty">暂未发生补测或撤回，全部里程点仅保留R1原始读数。</div>
          <div v-for="chain in revisionRows" :key="chain[0].pointId" class="chain-block">
            <div class="chain-title">{{ formatMileage(chain[0].mileage) }} · {{ chain[0].pointId }}</div>
            <div v-for="reading in chain" :key="reading.revisionId" :class="['chain-item', reading.status]">
              <span class="rev-id">{{ reading.revisionId }}</span>
              <v-chip size="x-small" :color="reading.status === '有效' ? 'success' : reading.status === '已替换' ? 'warning' : 'error'">{{ reading.status }}</v-chip>
              <span>轨距 {{ reading.gauge }} · 高低 {{ reading.level }} · 方向 {{ reading.alignment }} · 三角坑 {{ reading.twist }}</span>
              <span class="muted">{{ reading.detector }} · {{ reading.measuredAt.replace('T', ' ').slice(5, 16) }}</span>
              <small v-if="reading.reason" class="reason">{{ reading.reason }}</small>
            </div>
          </div>
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
.hold-flag { color: #a33a35 !important; font-weight: 600; }
.track-main { background: white; border: 1px solid #dae1e2; padding: 18px; }
.section-head { display: flex; justify-content: space-between; margin-bottom: 14px; }
.section-head span { color: #738180; font-size: 11px; }.section-head h2 { margin: 4px 0; font-size: 20px; }.section-head p { margin: 0; color: #60706f; }
.hold-banner { display: grid; gap: 4px; padding: 11px 13px; background: #fbf6e9; border-left: 3px solid #b08735; margin-bottom: 12px; font-size: 12px; }
.hold-banner span { color: #736d5b; }
.speed-panel { display: grid; grid-template-columns: 1fr 130px 130px auto; gap: 10px; align-items: center; margin: 14px 0; padding: 12px; background: #f4f7f7; }
.speed-panel p { margin: 4px 0 0; color: #71807f; font-size: 11px; }
.validation-message { color: #a33a35; font-size: 12px; margin-bottom: 10px; }
.rowInvalid td { color: #8d9796; }
.rev-cell { font-size: 11px; color: #60706f; }
.revision-panel { margin-top: 18px; border-top: 1px solid #e3e8e9; padding-top: 14px; }
.revision-panel h3 { margin: 0 0 10px; font-size: 14px; }
.empty { color: #9aa5a5; font-size: 12px; }
.chain-block { margin-bottom: 12px; border: 1px solid #e4e9e9; }
.chain-title { padding: 7px 10px; background: #f4f7f7; font-size: 12px; font-weight: 600; color: #315b72; }
.chain-item { display: flex; gap: 10px; align-items: center; padding: 7px 10px; border-top: 1px solid #edf1f1; font-size: 12px; flex-wrap: wrap; }
.chain-item.已替换, .chain-item.已撤回 { background: #faf8f4; color: #8a8272; }
.rev-id { font-family: monospace; font-size: 11px; min-width: 170px; }
.muted { color: #8a9897; font-size: 11px; }
.reason { color: #a33a35; font-size: 11px; }
</style>
