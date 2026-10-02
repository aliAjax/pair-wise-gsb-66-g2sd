<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useTrackStore } from '../stores/track'
import type { GeometryMeasurement } from '../types'

const route = useRoute()
const store = useTrackStore()
const selectedId = ref(String(route.params.id || store.defects[0]?.id || ''))
const defect = computed(() => store.defects.find((item) => item.id === selectedId.value))
const action = reactive({ method: '捣固', note: '', operator: '李海' })
const retest = reactive({ measuredValue: 0, tester: '王磊', note: '', independent: false })
const message = ref('')

const basisReading = computed<GeometryMeasurement | undefined>(() => store.findReading(defect.value?.basisReadingId))
const currentReading = computed<GeometryMeasurement | undefined>(() => {
  const point = basisReading.value
  return point?.currentId ? store.findReading(point.currentId) : point
})
const valueOf = (point: GeometryMeasurement | undefined, type: string) => {
  if (!point) return '—'
  return type === '轨距' ? point.gauge : type === '高低' ? point.level : type === '方向' ? point.alignment : point.twist
}

function addAction() {
  if (!defect.value || !action.note) return
  const result = store.addAction(defect.value.id, { ...action, method: action.method as any, recordedAt: new Date().toISOString() })
  message.value = result.message
  if (result.ok) action.note = ''
}
function addRetest() {
  if (!defect.value) return
  const round = defect.value.retests.length + 1
  const result = store.addRetest(defect.value.id, {
    round,
    passed: retest.measuredValue <= defect.value.limit,
    measuredValue: retest.measuredValue,
    limit: defect.value.limit,
    note: retest.note || (retest.measuredValue <= defect.value.limit ? '复测合格' : '仍超过限值'),
    tester: retest.tester,
    testedAt: new Date().toISOString(),
    independent: retest.independent,
    state: '有效',
    basisReadingId: currentReading.value?.id
  })
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
        <button v-for="item in store.defects" :key="item.id" :class="{ active: item.id === selectedId, invalid: item.invalidated }" @click="selectedId = item.id">
          <span>{{ item.id }} · V{{ item.version }}</span><strong>{{ item.type }}超限</strong><small>{{ item.owner }} · {{ item.status }}</small>
        </button>
      </div>
      <div v-if="defect" class="work-main">
        <div class="section-head">
          <div><span>{{ defect.segmentId }} · K{{ Math.floor(defect.mileage / 1000) }}+{{ String(defect.mileage % 1000).padStart(3, '0') }}</span><h2>{{ defect.type }}缺陷整治</h2><p>{{ defect.measuredValue }} / 限值 {{ defect.limit }} · {{ defect.severity }} · {{ defect.status }}</p></div>
          <v-chip :color="defect.invalidated ? 'grey' : defect.status === '已关闭' ? 'success' : 'warning'">{{ defect.status }}</v-chip>
        </div>

        <div class="revision-band" :class="{ invalid: defect.invalidated }">
          <strong>读数修订链</strong>
          <span>依据读数 <code>{{ defect.basisReadingId }}</code>（{{ basisReading?.state }}，R{{ basisReading?.revision ?? 0 }}）<template v-if="currentReading && currentReading.id !== defect.basisReadingId"> → 当前有效 <code>{{ currentReading.id }}</code>（R{{ currentReading.revision }}）</template></span>
          <span>发现时值 {{ defect.measuredValue }} ｜ 原值 {{ valueOf(basisReading, defect.type) }} ｜ 当前值 {{ valueOf(currentReading, defect.type) }}</span>
          <span v-if="defect.invalidated">该读数已被补测替换/撤回，缺陷失效<template v-if="defect.previousStatus">（原状态{{ defect.previousStatus }}）</template>；非独立复测结论已回到待复核，不能关闭或恢复临时限速，须独立仪器复测。</span>
        </div>

        <div class="offline-band"><strong>离线补录模式</strong><span>现场无网络时先写入本地队列，恢复后保留原始记录时间、复测轮次与修订批次。</span></div>
        <div class="action-form">
          <v-select v-model="action.method" :items="['打磨', '捣固', '更换', '垫板调整', '测量复核']" label="整治方式" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="action.note" label="现场记录" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="action.operator" label="操作人" density="compact" variant="outlined" hide-details />
          <v-btn color="primary" :disabled="!action.note || defect.invalidated" @click="addAction">提交整治记录</v-btn>
        </div>
        <div class="action-form retest-form">
          <v-text-field v-model.number="retest.measuredValue" type="number" label="复测值" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="retest.tester" label="复测人" density="compact" variant="outlined" hide-details />
          <v-text-field v-model="retest.note" label="复测说明" density="compact" variant="outlined" hide-details />
          <v-checkbox v-model="retest.independent" :label="defect.invalidated ? '独立仪器复测（复核必需）' : '独立仪器复测'" density="compact" hide-details color="secondary" />
          <v-btn color="secondary" @click="addRetest">提交复测</v-btn>
        </div>
        <div v-if="message" class="validation-message">{{ message }}</div>
        <div class="two-column">
          <div>
            <h3>整治记录</h3>
            <div v-for="item in defect.actions" :key="item.recordedAt" class="record-item"><strong>{{ item.method }}</strong><span>{{ item.note }}</span><small>{{ item.operator }} · {{ item.recordedAt.replace('T', ' ').slice(0, 16) }}</small></div>
          </div>
          <div>
            <h3>复测轮次</h3>
            <div v-for="item in defect.retests" :key="item.round" class="record-item" :class="{ reset: item.state === '待复核' }">
              <strong>第{{ item.round }}轮 {{ item.passed ? '通过' : '未通过' }} · {{ item.independent ? '独立复测' : '随车复测' }}</strong>
              <span>{{ item.measuredValue }} / {{ item.limit }} <v-chip size="x-small" :color="item.state === '待复核' ? 'warning' : 'success'">{{ item.state }}</v-chip></span>
              <small>{{ item.tester }} · {{ item.note }}<template v-if="item.state === '待复核'">（读数修订后回到待复核，不得用于关闭或恢复限速）</template></small>
            </div>
          </div>
        </div>
        <v-btn variant="outlined" :disabled="defect.invalidated" @click="closeDefect">申请关闭缺陷</v-btn>
        <small v-if="defect.invalidated" class="blocked-tip">关闭已锁定：请先完成独立仪器复测，复核通过后缺陷方可重新生效</small>
      </div>
    </div>
  </section>
</template>

<style scoped>
.work-layout { display: grid; grid-template-columns: 300px 1fr; gap: 14px; align-items: start; }
.work-list { display: grid; gap: 8px; }
.work-list button { border: 1px solid #dae1e2; background: white; padding: 13px; text-align: left; display: grid; gap: 6px; cursor: pointer; }
.work-list button.active { border-color: #315b72; box-shadow: inset 3px 0 #315b72; }
.work-list button.invalid { opacity: .7; border-style: dashed; }
.work-list span, .work-list small { color: #748180; font-size: 11px; }
.work-main { background: white; border: 1px solid #dae1e2; padding: 18px; }
.section-head { display: flex; justify-content: space-between; margin-bottom: 14px; }.section-head span { color: #73817e; font-size: 11px; }.section-head h2 { margin: 4px 0; }.section-head p { margin: 0; color: #667573; }
.revision-band { display: grid; gap: 4px; padding: 11px; border-left: 3px solid #315b72; background: #f1f5f7; font-size: 12px; margin-bottom: 12px; }
.revision-band.invalid { border-left-color: #b84239; background: #fdf3f2; }
.revision-band code { font-family: ui-monospace, Menlo, monospace; color: #315b72; }
.offline-band { display: flex; justify-content: space-between; padding: 11px; border-left: 3px solid #b08735; background: #fbf6e9; font-size: 12px; }.offline-band span { color: #736d5b; }
.action-form { display: grid; grid-template-columns: 170px 1fr 140px auto; gap: 10px; margin: 13px 0; }
.retest-form { grid-template-columns: 130px 130px 1fr 200px auto; align-items: center; }
.validation-message { color: #a63e38; font-size: 12px; margin-bottom: 10px; }
.blocked-tip { color: #a63e38; margin-left: 10px; }
.two-column { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 18px 0; }.two-column h3 { font-size: 14px; }
.record-item { border-top: 1px solid #e2e7e7; padding: 10px 0; display: grid; gap: 4px; }.record-item span, .record-item small { color: #6d7b79; font-size: 11px; }
.record-item.reset { background: #fbf6e9; padding-left: 8px; border-left: 2px solid #b18b38; }
</style>
