<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTrackStore } from '../stores/track'

const store = useTrackStore()
const keyword = ref('')
const batchId = ref('全部')
const batchOptions = computed(() => ['全部', ...store.batches.map((item) => item.id)])
const rows = computed(() => store.audit.filter((item) => {
  const text = `${item.entityId} ${item.action} ${item.operator} ${item.detail} ${item.batchId ?? ''}`
  return text.includes(keyword.value) && (batchId.value === '全部' || item.batchId === batchId.value)
}))

/** 导出与里程图/缺陷页一致的修订结果快照，原值与失效结论一并留痕 */
function exportReport() {
  const segments = store.segments.map((segment) => ({
    ...segment,
    measurements: segment.measurements,
    currentReadings: store.currentReadings(segment.id).map((point) => point.id)
  }))
  const defects = store.defects.map((defect) => ({
    ...defect,
    basisReadingState: store.findReading(defect.basisReadingId)?.state,
    retests: defect.retests
  }))
  const speedReview = store.segments.map((segment) => store.speedImpact(segment.id))
  const payload = {
    generatedAt: new Date().toISOString(),
    revisionModel: '同一里程仅一条当前有效读数；补测另存原值，撤回标记失效；读数更新级联失效缺陷并使非独立复测结论回到待复核',
    segments,
    defects,
    activeDefectIds: store.activeDefects.map((item) => item.id),
    invalidatedDefectIds: store.defects.filter((item) => item.invalidated).map((item) => item.id),
    speedReview,
    supplementBatches: store.batches,
    audit: store.audit
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `轨道几何整治报告-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="page audit-page">
    <div class="section-head">
      <div><h2>整治审计与版本追溯</h2><p>检测读数修订、缺陷级联失效、复测复核、限速联查和补传批次全部留痕；报告导出的即当前统一修订结果。</p></div>
      <v-btn color="primary" @click="exportReport">导出整治报告</v-btn>
    </div>
    <div class="toolbar single">
      <v-text-field v-model="keyword" density="compact" variant="outlined" hide-details prepend-inner-icon="mdi-magnify" placeholder="搜索实体、动作、操作人、批次或说明" />
      <v-select v-model="batchId" :items="batchOptions" label="补传批次" density="compact" variant="outlined" hide-details style="min-width: 220px" />
      <span>共{{ rows.length }}条</span>
    </div>
    <v-table density="compact">
      <thead><tr><th>时间</th><th>补传批次</th><th>实体</th><th>动作</th><th>操作人</th><th>说明</th></tr></thead>
      <tbody>
        <tr v-for="item in rows" :key="item.id" :class="{ revision: item.batchId && item.batchId !== 'BATCH-INIT-0929' }">
          <td>{{ item.createdAt.replace('T', ' ').slice(0, 16) }}</td>
          <td class="mono">{{ item.batchId ?? '—' }}</td>
          <td>{{ item.entityId }}</td>
          <td>{{ item.action }}</td>
          <td>{{ item.operator }}</td>
          <td>{{ item.detail }}</td>
        </tr>
      </tbody>
    </v-table>
  </section>
</template>

<style scoped>
.audit-page :deep(.v-table) { background: white; border: 1px solid #dae1e2; }
.audit-page tr.revision { background: #fbfdfc; }
.section-head { display: flex; justify-content: space-between; margin-bottom: 14px; }.section-head h2 { margin: 0 0 5px; font-size: 19px; }.section-head p { margin: 0; color: #71807e; font-size: 12px; }
.toolbar.single { display: grid; grid-template-columns: 1fr 240px auto; gap: 12px; margin-bottom: 10px; }.toolbar.single span { align-self: center; color: #71807f; font-size: 11px; }
.mono { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #315b72; }
</style>
