<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Defect, GeometryMeasurement, TrackSegment } from '../types'

const props = defineProps<{ segment?: TrackSegment; defects: Defect[] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const zoom = ref(1)
const selectedMileage = ref<number | null>(null)

const currentPoints = computed<GeometryMeasurement[]>(() =>
  props.segment ? props.segment.measurements.filter((item) => item.state === '当前有效').sort((a, b) => a.mileage - b.mileage) : []
)
const revisedPoints = computed<GeometryMeasurement[]>(() =>
  props.segment ? props.segment.measurements.filter((item) => item.state !== '当前有效') : []
)

function xOf(mileage: number, width: number, padding: number) {
  return padding + ((mileage - props.segment!.startMileage) / (props.segment!.endMileage - props.segment!.startMileage)) * (width - padding * 2)
}

function triangle(ctx: CanvasRenderingContext2D, x: number, baseY: number) {
  ctx.beginPath()
  ctx.moveTo(x, baseY - 18)
  ctx.lineTo(x - 7, baseY - 31)
  ctx.lineTo(x + 7, baseY - 31)
  ctx.closePath()
}

function draw() {
  const element = canvas.value
  if (!element || !props.segment) return
  const ctx = element.getContext('2d')
  if (!ctx) return
  const ratio = window.devicePixelRatio || 1
  const width = element.clientWidth
  const height = 230
  element.width = width * ratio
  element.height = height * ratio
  ctx.scale(ratio, ratio)
  ctx.clearRect(0, 0, width, height)
  const padding = 38
  const trackY = 138
  ctx.fillStyle = '#f8faf9'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = '#9aa8a7'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(padding, trackY)
  ctx.lineTo(width - padding, trackY)
  ctx.stroke()
  for (let index = 0; index <= 10; index += 1) {
    const x = padding + (index / 10) * (width - padding * 2)
    ctx.beginPath(); ctx.moveTo(x, trackY - 8); ctx.lineTo(x, trackY + 8); ctx.stroke()
    ctx.fillStyle = '#657473'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'
    const mileage = props.segment.startMileage + index * (props.segment.endMileage - props.segment.startMileage) / 10
    ctx.fillText(`K${Math.floor(mileage / 1000)}+${String(mileage % 1000).padStart(3, '0')}`, x, trackY + 28)
  }
  const points = currentPoints.value
  const span = Math.max(points.length - 1, 1)
  const maxGauge = Math.max(...points.map((item) => item.gauge), 1446)
  const yOf = (point: GeometryMeasurement) => 60 + (maxGauge - point.gauge) * 18

  // 被补测替换 / 撤回的旧读数：灰色空心留存，不参与当前折线
  revisedPoints.value.forEach((point) => {
    const x = xOf(point.mileage, width, padding)
    const y = 60 + (maxGauge - point.gauge) * 18
    ctx.strokeStyle = point.state === '已撤回' ? '#a9483f' : '#9aa8a7'
    ctx.setLineDash([3, 2])
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke()
    ctx.setLineDash([])
    ctx.font = '9px sans-serif'; ctx.fillStyle = '#8a9695'; ctx.textAlign = 'center'
    ctx.fillText(point.state === '已撤回' ? '撤' : '旧', x, y - 7)
  })

  points.forEach((point, index) => {
    const x = padding + (index / span) * (width - padding * 2)
    const y = yOf(point)
    ctx.strokeStyle = '#2e6678'; ctx.lineWidth = 2
    if (index) {
      const previous = points[index - 1]
      const px = padding + ((index - 1) / span) * (width - padding * 2)
      const py = yOf(previous)
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke()
    }
    ctx.fillStyle = point.gauge > 1446 ? '#b84239' : '#2e6678'
    ctx.beginPath(); ctx.arc(x, y, point.gauge > 1446 ? 4.5 : 3, 0, Math.PI * 2); ctx.fill()
    if (point.revision > 0) {
      ctx.fillStyle = '#b18b38'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(`R${point.revision}`, x, y - 8)
    }
  })

  // 缺陷三角：读数失效后不再作为有效缺陷标记，仅保留灰色“已失效”存根
  props.defects.filter((item) => item.segmentId === props.segment!.id).forEach((defect) => {
    const x = xOf(defect.mileage, width, padding)
    if (defect.invalidated) {
      ctx.globalAlpha = 0.55
      ctx.strokeStyle = '#8a9695'; ctx.fillStyle = '#e7ecec'; ctx.lineWidth = 1
      triangle(ctx, x, trackY); ctx.fill(); ctx.stroke()
      ctx.strokeStyle = '#a9483f'; ctx.setLineDash([3, 2])
      ctx.beginPath(); ctx.moveTo(x - 8, trackY - 33); ctx.lineTo(x + 8, trackY - 16); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#8a9695'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(`${defect.type}·已失效`, x, trackY - 40)
      ctx.globalAlpha = 1
      return
    }
    ctx.fillStyle = defect.status === '已关闭' ? '#43876b' : '#b84239'
    triangle(ctx, x, trackY); ctx.fill()
    ctx.fillStyle = '#334241'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(defect.type, x, trackY - 36)
  })
  if (selectedMileage.value !== null) {
    const x = xOf(selectedMileage.value, width, padding)
    ctx.strokeStyle = '#b18b38'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x, 18); ctx.lineTo(x, trackY + 8); ctx.stroke(); ctx.setLineDash([])
  }
}

function locate(event: MouseEvent) {
  if (!props.segment || !canvas.value) return
  const rect = canvas.value.getBoundingClientRect()
  const x = event.clientX - rect.left
  const ratio = Math.min(1, Math.max(0, (x - 38) / (rect.width - 76)))
  selectedMileage.value = Math.round(props.segment.startMileage + ratio * (props.segment.endMileage - props.segment.startMileage))
}

onMounted(() => { draw(); window.addEventListener('resize', draw) })
watch([() => props.segment, () => props.defects, zoom, selectedMileage], draw, { deep: true })
</script>

<template>
  <div class="canvas-panel">
    <div class="canvas-head">
      <div><strong>里程—轨距分布</strong><span v-if="selectedMileage">定位 K{{ Math.floor(selectedMileage / 1000) }}+{{ String(selectedMileage % 1000).padStart(3, '0') }}</span></div>
      <div><v-btn size="x-small" variant="outlined" @click="zoom = Math.max(.7, zoom - .1)">缩小</v-btn><v-btn size="x-small" variant="outlined" @click="zoom = Math.min(1.3, zoom + .1)">放大</v-btn></div>
    </div>
    <canvas ref="canvas" :style="{ transform: `scale(${zoom})`, transformOrigin: 'left center' }" @click="locate" />
    <div class="canvas-note">折线与红点仅取当前有效读数（R标记为补测修订版）；“旧/撤”为另存原值，灰色划掉三角为随读数失效的缺陷，不再按有效缺陷显示。</div>
  </div>
</template>
