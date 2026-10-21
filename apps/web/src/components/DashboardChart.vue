<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { EChartsType } from 'echarts';

const props = defineProps<{
  type: string;
  title: string;
  labels: string[];
  values: number[];
  themeColor?: string;
  showLegend?: boolean;
  showLabel?: boolean;
  legendPosition?: 'top' | 'bottom';
}>();

const host = ref<HTMLDivElement | null>(null);
let chart: EChartsType | null = null;
let observer: ResizeObserver | null = null;

function optionOf(): Record<string, unknown> {
  const isPie = props.type === 'pie';
  const color = props.themeColor || '#2d8cf0';
  return {
    color: [color, '#36cfc9', '#ffc53d', '#ff7a45', '#9254de'],
    title: { text: props.title, left: 12, top: 8, textStyle: { fontSize: 13 } },
    tooltip: { trigger: isPie ? 'item' : 'axis' },
    legend: {
      show: props.showLegend !== false,
      top: props.legendPosition === 'bottom' ? undefined : 32,
      bottom: props.legendPosition === 'bottom' ? 0 : undefined,
    },
    grid: { left: 48, right: 20, top: 64, bottom: 44 },
    xAxis: isPie
      ? undefined
      : {
          type: 'category',
          data: props.labels,
          axisLabel: { color: '#646a73' },
        },
    yAxis: isPie ? undefined : { type: 'value', axisLabel: { color: '#646a73' } },
    series: [
      isPie
        ? {
            type: 'pie',
            radius: ['35%', '65%'],
            center: ['50%', '55%'],
            label: { show: props.showLabel !== false },
            data: props.labels.map((label, index) => ({
              name: label,
              value: props.values[index] ?? 0,
            })),
          }
        : {
            type: props.type === 'line' ? 'line' : 'bar',
            smooth: true,
            data: props.values,
            label: { show: props.showLabel === true },
            itemStyle: { color },
          },
    ],
  };
}

async function render(): Promise<void> {
  if (!host.value) return;
  if (props.type === 'metric' || props.type === 'table') return;
  const echarts = await import('echarts');
  if (!chart) {
    chart = echarts.init(host.value);
  }
  chart.setOption(optionOf(), true);
}

onMounted(async () => {
  await nextTick();
  await render();
  if (host.value) {
    observer = new ResizeObserver(() => chart?.resize());
    observer.observe(host.value);
  }
});

watch(
  () => [
    props.type,
    props.labels,
    props.values,
    props.themeColor,
    props.showLegend,
    props.showLabel,
    props.legendPosition,
  ],
  () => {
    void render();
  },
  { deep: true },
);

onBeforeUnmount(() => {
  observer?.disconnect();
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div class="dashboard-chart-wrap" data-testid="dashboard-chart">
    <div v-if="type === 'metric'" class="metric-value">
      {{ values[0] ?? 0 }}
    </div>
    <ul v-else-if="type === 'table'" class="chart-table">
      <li v-for="(label, index) in labels" :key="label">
        <span>{{ label }}</span>
        <strong>{{ values[index] }}</strong>
      </li>
    </ul>
    <div v-else ref="host" class="chart-canvas"></div>
  </div>
</template>

<style scoped>
.dashboard-chart-wrap {
  min-height: 240px;
}
.chart-canvas {
  width: 100%;
  height: 240px;
}
.metric-value {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  font-size: 42px;
  font-weight: 700;
  color: #1d6fdc;
}
.chart-table {
  margin: 0;
  padding: 12px 16px;
  list-style: none;
}
.chart-table li {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #f0f1f3;
  font-size: 13px;
}
</style>
