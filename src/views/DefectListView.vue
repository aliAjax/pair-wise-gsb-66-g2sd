<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@vue/apollo-composable'
import { gql } from '@apollo/client/core'
import { useTrackStore } from '../stores/track'
import type { Defect, DefectStatus } from '../types'
import { formatMileage } from '../utils/format'

const store = useTrackStore()
const router = useRouter()
const TrackSegments = gql`query TrackSegments { segments { id line startMileage endMileage speedLimit version } }`
const { result: segmentResult, loading } = useQuery(TrackSegments)
const selected = ref<string[]>([])
const owner = ref('工务一工区')
const assignMessage = ref('')
const headers = [
  { title: '缺陷编号', key: 'id' },
  { title: '区段', key: 'segmentId' },
  { title: '里程', key: 'mileage' },
  { title: '类型', key: 'type' },
  { title: '严重度', key: 'severity' },
  { title: '实测/限值', key: 'value' },
  { title: '状态', key: 'status' },
  { title: '读数修订溯源', key: 'revision' },
  { title: '责任工区', key: 'owner' },
  { title: '版本', key: 'version' },
  { title: '', key: 'actions' }
]
const statuses: Array<DefectStatus | '全部'> = ['全部', '待派工', '整治中', '待复测', '复测不合格', '已关闭', '已失效']

const invalidCount = computed(() => store.defects.filter((item) => item.status === '已失效' && !item.revisionResolvedAt).length)
const pendingVerdictCount = computed(() => store.defects.reduce((sum, item) => sum + item.retests.filter((retest) => retest.verdictStatus === '待复核').length, 0))

function revisionText(item: Defect) {
  const chain = store.readingChain(item.pointId)
  const source = chain.find((reading) => reading.revisionId === item.sourceRevisionId)
  const current = chain.find((reading) => reading.status === '有效')
  if (item.status !== '已失效' || item.revisionResolvedAt) {
    return current ? `依据 ${current.revisionId}（R${current.revision} 有效）` : '检测点已撤回'
  }
  if (!current) return `原依据 ${source?.revisionId ?? item.sourceRevisionId} · 检测点已撤回`
  return `原依据 ${source?.revisionId ?? item.sourceRevisionId} → 当前 R${current.revision}（${current.gauge}）`
}

function assign() {
  assignMessage.value = store.assign(selected.value, owner.value).message
  selected.value = []
}
</script>

<template>
  <section class="page">
    <div class="metrics">
      <article><span>超限缺陷</span><strong>{{ store.defects.length }}</strong><small>含已关闭/失效项</small></article>
      <article><span>一级缺陷</span><strong>{{ store.defects.filter((item) => item.severity === '一级' && item.status !== '已关闭' && item.status !== '已失效').length }}</strong><small>需限速联查</small></article>
      <article><span>补测失效待复核</span><strong>{{ invalidCount }}</strong><small>{{ pendingVerdictCount }} 条复测结论待独立复测</small></article>
      <article><span>区段版本</span><strong>{{ store.segments.reduce((sum, item) => sum + item.version, 0) }}</strong><small>补测修订同样递增</small></article>
    </div>
    <div class="toolbar">
      <v-text-field v-model="store.keyword" density="compact" variant="outlined" hide-details prepend-inner-icon="mdi-magnify" placeholder="搜索缺陷、区段、类型或工区" />
      <v-select v-model="store.status" :items="statuses" density="compact" variant="outlined" hide-details />
      <v-select v-model="owner" :items="['工务一工区', '工务二工区', '桥隧工区']" density="compact" variant="outlined" hide-details />
      <v-btn color="primary" :disabled="!selected.length" @click="assign">批量派工 {{ selected.length ? `(${selected.length})` : '' }}</v-btn>
    </div>
    <div v-if="assignMessage" class="assign-message">{{ assignMessage }}</div>
    <div class="query-band"><span>{{ loading ? 'GraphQL数据读取中' : `GraphQL已返回${segmentResult?.segments?.length ?? 0}个区段` }}</span><span>补测修订后缺陷自动失效，复测结论回到待复核</span></div>
    <v-data-table v-model="selected" :headers="headers" :items="store.filtered" item-value="id" show-select density="compact" :items-per-page="12">
      <template #item.value="{ item }">{{ item.measuredValue }} / {{ item.limit }}</template>
      <template #item.severity="{ item }"><v-chip size="small" :color="item.severity === '一级' ? 'error' : item.severity === '二级' ? 'warning' : 'default'">{{ item.severity }}</v-chip></template>
      <template #item.status="{ item }">
        <v-chip size="small" :color="item.status === '已关闭' ? 'success' : item.status === '已失效' ? 'secondary' : item.status === '复测不合格' ? 'error' : 'warning'">{{ item.status }}</v-chip>
      </template>
      <template #item.revision="{ item }">
        <div :class="['revision-cell', item.status === '已失效' && !item.revisionResolvedAt ? 'invalid' : '']">{{ revisionText(item) }}</div>
      </template>
      <template #item.mileage="{ item }">{{ formatMileage(item.mileage) }}</template>
      <template #item.version="{ item }">V{{ item.version }}</template>
      <template #item.actions="{ item }"><v-btn size="small" variant="text" @click="router.push(`/work-orders/${item.id}`)">处置</v-btn></template>
    </v-data-table>
  </section>
</template>

<style scoped>
.query-band { display: flex; justify-content: space-between; font-size: 11px; color: #718080; margin: 0 0 10px; }
.assign-message { font-size: 12px; color: #a33a35; margin-bottom: 8px; }
.revision-cell { font-size: 11px; color: #4d6160; }
.revision-cell.invalid { color: #8a5a2f; }
</style>
