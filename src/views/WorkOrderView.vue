<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useTrackStore } from '../stores/track'
import type { Defect } from '../types'
import { formatMileage } from '../utils/format'

const route = useRoute()
const store = useTrackStore()
const selectedId = ref(String(route.params.id || store.defects[0]?.id || ''))
const defect = computed(() => store.defects.find((item) => item.id === selectedId.value))
const action = reactive({ method: '捣固', note: '', operator: '李海' })
const retest = reactive({ measuredValue: 0, tester: '王磊', note: '' })
const message = ref('')

const isInvalidPending = computed(() => !!defect.value && defect.value.status === '已失效' && !defect.value.revisionResolvedAt)
const readingChain = computed(() => defect.value ? store.readingChain(defect.value.pointId) : [])
const currentReading = computed(() => readingChain.value.find((item) => item.status === '有效'))
const sourceReading = computed(() => defect.value ? store.getReading(defect.value.sourceRevisionId) : undefined)

function addAction() {
  if (!defect.value || !action.note) return
  const result = store.addAction(defect.value.id, { ...action, method: action.method as Defect['actions'][number]['method'], recordedAt: new Date().toISOString() })
  message.value = result.message
  if (result.ok) action.note = ''
}
function addRetest() {
  if (!defect.value) return
  const round = defect.value.retests.length + 1
  const passed = retest.measuredValue <= defect.value.limit
  const result = store.addRetest(defect.value.id, { round, passed, measuredValue: retest.measuredValue, limit: defect.value.limit, note: retest.note || (passed ? '复测合格' : '仍超过限值'), tester: retest.tester, testedAt: new Date().toISOString(), verdictStatus: '有效', sourceRevisionId: defect.value.sourceRevisionId, independent: false })
  message.value = result.message
}
function addIndependentRetest() {
  if (!defect.value) return
  const passed = retest.measuredValue <= defect.value.limit
  const round = defect.value.retests.length + 1
  const result = store.submitIndependentRetest(defect.value.id, { round, passed, measuredValue: retest.measuredValue, limit: defect.value.limit, note: retest.note || (passed ? '补测后独立复测合格' : '补测后独立复测仍超限'), tester: retest.tester, testedAt: new Date().toISOString() })
  message.value = result.message
}
function closeDefect() {
  if (!defect.value) return
  const result = store.transition(defect.value.id, '已关闭')
  message.value = result.message
}
</script>

<template>
  <section class="page">
    <div class="work-layout">
      <div class="work-list">
        <button v-for="item in store.defects" :key="item.id" :class="{ active: item.id === selectedId, invalid: item.status === '已失效' && !item.revisionResolvedAt }" @click="selectedId = item.id">
          <span>{{ item.id }} · V{{ item.version }}</span><strong>{{ item.type }}超限</strong><small>{{ item.owner }} · {{ item.status }}</small>
        </button>
      </div>
      <div v-if="defect" class="work-main">
        <div class="section-head">
          <div><span>{{ defect.segmentId }} · {{ formatMileage(defect.mileage) }}</span><h2>{{ defect.type }}缺陷整治</h2><p>{{ defect.measuredValue }} / 限值 {{ defect.limit }} · {{ defect.severity }} · {{ defect.status }}</p></div>
          <v-chip :color="defect.status === '已关闭' ? 'success' : defect.status === '已失效' ? 'secondary' : 'warning'">{{ defect.status }}</v-chip>
        </div>

        <div class="revision-trace">
          <h4>读数修订溯源</h4>
          <div class="trace-line"><small>缺陷依据</small><strong>{{ sourceReading?.revisionId ?? defect.sourceRevisionId }}（R{{ sourceReading?.revision ?? '?' }}，{{ sourceReading?.status ?? '未知' }}，{{ defect.discoveredAt.replace('T', ' ').slice(0, 16) }}）</strong></div>
          <div class="trace-line"><small>当前有效读数</small><strong v-if="currentReading">{{ currentReading.revisionId }}（R{{ currentReading.revision }}，轨距 {{ currentReading.gauge }}，{{ currentReading.measuredAt.replace('T', ' ').slice(5, 16) }}）</strong><strong v-else class="withdrawn">该里程点检测点已撤回，无当前有效读数</strong></div>
          <div v-for="reading in readingChain" :key="reading.revisionId" :class="['trace-item', reading.status]">
            <v-chip size="x-small" :color="reading.status === '有效' ? 'success' : reading.status === '已替换' ? 'warning' : 'error'">{{ reading.status }}</v-chip>
            <span>{{ reading.revisionId }} · 轨距{{ reading.gauge }} / 高低{{ reading.level }} / 方向{{ reading.alignment }} / 三角坑{{ reading.twist }}</span>
            <small v-if="reading.reason">{{ reading.reason }}</small>
          </div>
        </div>

        <div v-if="isInvalidPending" class="invalid-banner">
          <strong>读数已补测修订/撤回，缺陷已失效</strong>
          <span>原整治流程挂起：整治记录不能继续登记、缺陷不能关闭、临时限速不能恢复。请复测人员对当前几何状态进行独立复测。</span>
        </div>

        <div class="offline-band"><strong>离线补录模式</strong><span>现场无网络时先写入本地队列，恢复后保留原始记录时间和复测轮次；读数修订以补传批次为准。</span></div>

        <div v-if="!isInvalidPending" class="action-form">
          <v-select v-model="action.method" :items="['打磨', '捣固', '更换', '垫板调整', '测量复核']" label="整治方式" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="action.note" label="现场记录" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="action.operator" label="操作人" density="compact" variant="outlined" hide-details />
          <v-btn color="primary" :disabled="!action.note" @click="addAction">提交整治记录</v-btn>
        </div>
        <div class="action-form" :class="{ independent: isInvalidPending }">
          <v-text-field v-model.number="retest.measuredValue" type="number" label="复测值" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="retest.tester" label="复测人" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="retest.note" :label="isInvalidPending ? '独立复测说明' : '复测说明'" density="compact" variant="outlined" hide-details />
          <v-btn color="secondary" @click="isInvalidPending ? addIndependentRetest() : addRetest()">{{ isInvalidPending ? '提交独立复测（唯一结案依据）' : '提交复测' }}</v-btn>
        </div>
        <div v-if="message" class="validation-message">{{ message }}</div>
        <div class="two-column">
          <div><h3>整治记录</h3><div v-for="item in defect.actions" :key="item.recordedAt" class="record-item"><strong>{{ item.method }}</strong><span>{{ item.note }}</span><small>{{ item.operator }} · {{ item.recordedAt.replace('T', ' ').slice(0, 16) }}</small></div></div>
          <div>
            <h3>复测轮次</h3>
            <div v-for="item in defect.retests" :key="item.round" class="record-item" :class="{ pendingVerdict: item.verdictStatus === '待复核' }">
              <strong>第{{ item.round }}轮 {{ item.passed ? '通过' : '未通过' }} <v-chip size="x-small" :color="item.verdictStatus === '有效' ? 'success' : 'warning'">{{ item.verdictStatus }}</v-chip> <small v-if="item.independent" class="ind-tag">独立复测</small></strong>
              <span>{{ item.measuredValue }} / {{ item.limit }}</span>
              <small>{{ item.tester }} · {{ item.note }}</small>
              <small v-if="item.verdictStatus === '待复核'" class="pending-note">依据读数{{ item.sourceRevisionId }}已被补测修订，结论回到待复核，不能用于关闭或恢复限速</small>
            </div>
          </div>
        </div>
        <v-btn variant="outlined" :disabled="isInvalidPending" @click="closeDefect">申请关闭缺陷</v-btn>
        <small v-if="isInvalidPending" class="close-hint">已禁用：须先提交合格的独立复测</small>
      </div>
    </div>
  </section>
</template>

<style scoped>
.work-layout { display: grid; grid-template-columns: 300px 1fr; gap: 14px; align-items: start; }
.work-list { display: grid; gap: 8px; }
.work-list button { border: 1px solid #dae1e2; background: white; padding: 13px; text-align: left; display: grid; gap: 6px; cursor: pointer; }
.work-list button.active { border-color: #315b72; box-shadow: inset 3px 0 #315b72; }
.work-list button.invalid small { color: #a33a35; }
.work-list span, .work-list small { color: #748180; font-size: 11px; }
.work-main { background: white; border: 1px solid #dae1e2; padding: 18px; }
.section-head { display: flex; justify-content: space-between; margin-bottom: 14px; }.section-head span { color: #73817e; font-size: 11px; }.section-head h2 { margin: 4px 0; }.section-head p { margin: 0; color: #667573; }
.revision-trace { border: 1px solid #e0e7e7; padding: 10px 12px; margin-bottom: 12px; display: grid; gap: 5px; background: #f8faf9; }
.revision-trace h4 { margin: 0 0 3px; font-size: 13px; color: #315b72; }
.trace-line { display: flex; gap: 10px; align-items: baseline; font-size: 12px; }
.trace-line small { color: #8a9897; min-width: 86px; }
.trace-line .withdrawn { color: #a33a35; }
.trace-item { display: flex; gap: 8px; align-items: center; font-size: 11px; color: #5d6d6c; flex-wrap: wrap; }
.trace-item.已替换, .trace-item.已撤回 { color: #98a09d; }
.trace-item small { color: #a33a35; }
.invalid-banner { display: grid; gap: 4px; padding: 11px; border-left: 3px solid #a33a35; background: #fbecea; font-size: 12px; margin-bottom: 12px; }.invalid-banner span { color: #7f5853; }
.offline-band { display: flex; justify-content: space-between; padding: 11px; border-left: 3px solid #b08735; background: #fbf6e9; font-size: 12px; }.offline-band span { color: #736d5b; }
.action-form { display: grid; grid-template-columns: 170px 1fr 140px auto; gap: 10px; margin: 13px 0; }
.action-form.independent { grid-template-columns: 170px 140px 1fr auto; border-top: 2px dashed #c9b18a; padding-top: 14px; }
.validation-message { color: #a63e38; font-size: 12px; margin-bottom: 10px; }
.two-column { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 18px 0; }.two-column h3 { font-size: 14px; }
.record-item { border-top: 1px solid #e2e7e7; padding: 10px 0; display: grid; gap: 4px; }.record-item span, .record-item small { color: #6d7b79; font-size: 11px; }
.record-item.pendingVerdict { background: #fbf6e9; padding-left: 8px; }
.ind-tag { color: #315b72 !important; }
.pending-note { color: #8c6a2f !important; }
.close-hint { margin-left: 10px; color: #a33a35; font-size: 11px; }
</style>
