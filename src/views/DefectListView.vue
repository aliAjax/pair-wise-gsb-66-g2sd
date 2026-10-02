<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMutation, useQuery } from '@vue/apollo-composable'
import { gql } from '@apollo/client/core'
import { useTrackStore } from '../stores/track'
import type { DefectStatus } from '../types'

const store = useTrackStore()
const router = useRouter()
const TrackSegments = gql`query TrackSegments { segments { id line startMileage endMileage speedLimit version } }`
const { result: segmentResult, loading } = useQuery(TrackSegments)
void useMutation(gql`mutation AssignDefects($ids: [ID!]!, $owner: String!) { assignDefects(ids: $ids, owner: $owner) { ok } }`)
const selected = ref<string[]>([])
const owner = ref('工务一工区')
const headers = [
  { title: '缺陷编号', key: 'id' },
  { title: '区段', key: 'segmentId' },
  { title: '里程', key: 'mileage' },
  { title: '依据读数', key: 'basis' },
  { title: '类型', key: 'type' },
  { title: '严重度', key: 'severity' },
  { title: '实测/限值', key: 'value' },
  { title: '状态', key: 'status' },
  { title: '复测结论', key: 'retest' },
  { title: '责任工区', key: 'owner' },
  { title: '版本', key: 'version' },
  { title: '', key: 'actions' }
]
const statuses: Array<DefectStatus | '全部'> = ['全部', '待派工', '整治中', '待复测', '待复核', '复测不合格', '已关闭', '已失效']

const activeCritical = computed(() => store.defects.filter((item) => item.severity === '一级' && !item.invalidated && item.status !== '已关闭'))
const invalidatedCount = computed(() => store.defects.filter((item) => item.invalidated).length)
const pendingRetests = computed(() => store.defects.reduce((sum, item) => sum + item.retests.filter((r) => r.state === '待复核').length, 0))

function assign() {
  store.assign(selected.value, owner.value)
  selected.value = []
}
function retestState(item: { invalidated: boolean; retests: Array<{ state: string }> }) {
  if (item.invalidated) return '读数已修订'
  const pending = item.retests.filter((r) => r.state === '待复核').length
  return pending ? `${pending}条待复核` : item.retests.length ? `${item.retests.length}条有效` : '无复测'
}
</script>

<template>
  <section class="page">
    <div class="metrics">
      <article><span>有效缺陷</span><strong>{{ store.activeDefects.length }}</strong><small>已失效{{ invalidatedCount }}项可在状态筛选追溯</small></article>
      <article><span>一级缺陷</span><strong>{{ activeCritical.length }}</strong><small>需限速联查</small></article>
      <article><span>复测待复核</span><strong>{{ pendingRetests }}</strong><small>读数修订后不得关闭</small></article>
      <article><span>区段版本</span><strong>{{ store.segments.reduce((sum, item) => sum + item.version, 0) }}</strong><small>随修订/限速递增</small></article>
    </div>
    <div class="toolbar">
      <v-text-field v-model="store.keyword" density="compact" variant="outlined" hide-details prepend-inner-icon="mdi-magnify" placeholder="搜索缺陷、区段、类型或工区" />
      <v-select v-model="store.status" :items="statuses" density="compact" variant="outlined" hide-details />
      <v-select v-model="owner" :items="['工务一工区', '工务二工区', '桥隧工区']" density="compact" variant="outlined" hide-details />
      <v-btn color="primary" :disabled="!selected.length" @click="assign">批量派工 {{ selected.length ? `(${selected.length})` : '' }}</v-btn>
    </div>
    <div class="query-band"><span>{{ loading ? 'GraphQL数据读取中' : `GraphQL已返回${segmentResult?.segments?.length ?? 0}个区段` }}</span><span>补测回传后缺陷与复测结论随读数修订，原值留痕</span></div>
    <v-data-table v-model="selected" :headers="headers" :items="store.filtered" item-value="id" show-select density="compact" :items-per-page="12">
      <template #item.value="{ item }">{{ item.measuredValue }} / {{ item.limit }}</template>
      <template #item.basis="{ item }"><span class="mono">{{ item.basisReadingId ?? '—' }}<template v-if="item.lastRevisionId"> → {{ item.lastRevisionId.slice(0, 14) }}</template></span></template>
      <template #item.severity="{ item }"><v-chip size="small" :color="item.severity === '一级' ? 'error' : item.severity === '二级' ? 'warning' : 'default'">{{ item.severity }}</v-chip></template>
      <template #item.status="{ item }"><v-chip size="small" :color="item.invalidated ? 'grey' : item.status === '已关闭' ? 'success' : item.status === '复测不合格' || item.status === '待复核' ? 'error' : 'warning'">{{ item.status }}</v-chip></template>
      <template #item.retest="{ item }">
        <v-chip size="small" :color="item.invalidated || item.retests.some((r: any) => r.state === '待复核') ? 'warning' : 'default'">{{ retestState(item) }}</v-chip>
      </template>
      <template #item.mileage="{ item }">K{{ Math.floor(item.mileage / 1000) }}+{{ String(item.mileage % 1000).padStart(3, '0') }}</template>
      <template #item.version="{ item }">V{{ item.version }}</template>
      <template #item.actions="{ item }"><v-btn size="small" variant="text" @click="router.push(`/work-orders/${item.id}`)">处置</v-btn></template>
    </v-data-table>
  </section>
</template>

<style scoped>
.query-band { display: flex; justify-content: space-between; font-size: 11px; color: #71807f; margin: 0 0 10px; }
.mono { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #315b72; }
</style>
