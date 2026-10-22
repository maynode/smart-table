<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { EChartsType } from 'echarts';

export interface MetricPayload {
  value: number;
  previousValue?: number | null;
  delta?: number | null;
  deltaPercent?: number | null;
  compareLabel?: string;
  displayColor?: string;
  prefix?: string;
  suffix?: string;
  decimalPlaces?: number;
}

const props = defineProps<{
  type: string;
  title: string;
  labels: string[];
  values: number[];
  themeColor?: string;
  showLegend?: boolean;
  showLabel?: boolean;
  legendPosition?: 'top' | 'bottom' | 'left' | 'right' | 'topRight';
  /** bar | barStacked | barPercent | horizontalBar | line | pie | combo | wordcloud | metric | table | text */
  stackMode?: 'none' | 'stack' | 'percent';
  showXAxis?: boolean;
  showYAxis?: boolean;
  showGrid?: boolean;
  xAxisTitle?: string;
  yAxisTitle?: string;
  yMin?: number | null;
  yMax?: number | null;
  logScale?: boolean;
  textContent?: string;
  metric?: MetricPayload | null;
}>();

const host = ref<HTMLDivElement | null>(null);
const sparkHost = ref<HTMLDivElement | null>(null);
let chart: EChartsType | null = null;
let spark: EChartsType | null = null;
let observer: ResizeObserver | null = null;

const metricView = computed(() => {
  const m = props.metric;
  const raw = m?.value ?? props.values[0] ?? 0;
  const places = m?.decimalPlaces ?? 0;
  const formatted = Number(raw).toLocaleString('zh-CN', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
  const delta = m?.delta ?? null;
  const deltaPercent = m?.deltaPercent ?? null;
  const up = delta !== null && delta > 0;
  const down = delta !== null && delta < 0;
  return {
    text: `${m?.prefix ?? ''}${formatted}${m?.suffix ?? ''}`,
    color: m?.displayColor || props.themeColor || '#1f2329',
    delta,
    deltaPercent,
    compareLabel: m?.compareLabel,
    up,
    down,
    flat: delta === 0,
  };
});

const showSpark = computed(
  () =>
    props.type === 'metric' &&
    props.labels.length > 1 &&
    props.values.length > 1,
);

function legendOption(): Record<string, unknown> {
  const pos = props.legendPosition ?? 'top';
  const base: Record<string, unknown> = { show: props.showLegend !== false };
  if (pos === 'bottom') base.bottom = 0;
  else if (pos === 'left') {
    base.left = 0;
    base.orient = 'vertical';
  } else if (pos === 'right') {
    base.right = 0;
    base.orient = 'vertical';
  } else if (pos === 'topRight') {
    base.top = 8;
    base.right = 12;
  } else base.top = 32;
  return base;
}

function optionOf(): Record<string, unknown> {
  const color = props.themeColor || '#2d8cf0';
  const palette = [color, '#36cfc9', '#ffc53d', '#ff7a45', '#9254de', '#73d13d'];
  const type = props.type;
  const isPie = type === 'pie';
  const isHorizontal = type === 'horizontalBar';
  const isWord = type === 'wordcloud';
  const stack =
    props.stackMode === 'stack'
      ? 'total'
      : props.stackMode === 'percent'
        ? 'total'
        : undefined;

  if (isWord) {
    const max = Math.max(1, ...props.values);
    return {
      color: palette,
      title: { text: props.title, left: 12, top: 8, textStyle: { fontSize: 13 } },
      tooltip: { trigger: 'item' },
      xAxis: { show: false, min: 0, max: 100 },
      yAxis: { show: false, min: 0, max: 100 },
      series: [
        {
          type: 'scatter',
          symbolSize: (val: number[]) => 12 + (val[2] / max) * 36,
          label: {
            show: true,
            formatter: (params: { data: number[] }) =>
              props.labels[params.data[3]] ?? '',
            color: '#1f2329',
            fontSize: 12,
          },
          data: props.labels.map((_, index) => [
            10 + ((index * 17) % 80),
            15 + ((index * 29) % 70),
            props.values[index] ?? 1,
            index,
          ]),
        },
      ],
    };
  }

  const categoryAxis = {
    type: 'category' as const,
    data: props.labels,
    show: props.showXAxis !== false,
    name: props.xAxisTitle || undefined,
    axisLabel: { color: '#646a73' },
  };
  const valueAxis = {
    type: props.logScale ? ('log' as const) : ('value' as const),
    show: props.showYAxis !== false,
    name: props.yAxisTitle || undefined,
    min: props.yMin ?? undefined,
    max: props.yMax ?? undefined,
    axisLabel: {
      color: '#646a73',
      formatter:
        props.stackMode === 'percent'
          ? (value: number) => `${value}%`
          : undefined,
    },
    splitLine: { show: props.showGrid !== false },
  };

  let values = [...props.values];
  if (props.stackMode === 'percent') {
    const sum = values.reduce((a, b) => a + b, 0) || 1;
    values = values.map((v) => Math.round((v / sum) * 1000) / 10);
  }

  const barSeries = {
    type: 'bar' as const,
    stack,
    data: values,
    label: { show: props.showLabel === true },
    itemStyle: { color },
  };
  const lineSeries = {
    type: 'line' as const,
    smooth: true,
    data: values,
    label: { show: props.showLabel === true },
    itemStyle: { color },
  };

  let series: unknown[] = [barSeries];
  if (type === 'line') series = [lineSeries];
  else if (type === 'combo') series = [barSeries, { ...lineSeries, yAxisIndex: 0 }];
  else if (isPie) {
    series = [
      {
        type: 'pie',
        radius: ['35%', '65%'],
        center: ['50%', '55%'],
        label: { show: props.showLabel !== false },
        data: props.labels.map((label, index) => ({
          name: label,
          value: props.values[index] ?? 0,
        })),
      },
    ];
  }

  return {
    color: palette,
    title: { text: props.title, left: 12, top: 8, textStyle: { fontSize: 13 } },
    tooltip: { trigger: isPie ? 'item' : 'axis' },
    legend: legendOption(),
    grid: {
      left: isHorizontal ? 72 : 48,
      right: 20,
      top: 64,
      bottom: 44,
      show: props.showGrid === true,
    },
    xAxis: isPie
      ? undefined
      : isHorizontal
        ? valueAxis
        : categoryAxis,
    yAxis: isPie
      ? undefined
      : isHorizontal
        ? categoryAxis
        : valueAxis,
    series,
  };
}

async function renderSpark(): Promise<void> {
  if (!sparkHost.value || !showSpark.value) {
    spark?.dispose();
    spark = null;
    return;
  }
  const echarts = await import('echarts');
  if (!spark) spark = echarts.init(sparkHost.value);
  const color = props.metric?.displayColor || props.themeColor || '#2d8cf0';
  spark.setOption(
    {
      grid: { left: 0, right: 0, top: 4, bottom: 0 },
      xAxis: { type: 'category', show: false, data: props.labels },
      yAxis: { type: 'value', show: false },
      series: [
        {
          type: 'line',
          data: props.values,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color },
          areaStyle: { color: `${color}22` },
        },
      ],
    },
    true,
  );
}

async function render(): Promise<void> {
  if (!host.value) return;
  if (
    props.type === 'metric' ||
    props.type === 'table' ||
    props.type === 'text'
  ) {
    if (props.type === 'metric') await renderSpark();
    return;
  }
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
    observer = new ResizeObserver(() => {
      chart?.resize();
      spark?.resize();
    });
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
    props.stackMode,
    props.showXAxis,
    props.showYAxis,
    props.showGrid,
    props.xAxisTitle,
    props.yAxisTitle,
    props.yMin,
    props.yMax,
    props.logScale,
    props.metric,
  ],
  () => {
    void render();
  },
  { deep: true },
);

onBeforeUnmount(() => {
  observer?.disconnect();
  chart?.dispose();
  spark?.dispose();
  chart = null;
  spark = null;
});
</script>

<template>
  <div class="dashboard-chart-wrap" data-testid="dashboard-chart">
    <div v-if="type === 'metric'" class="metric-card" data-testid="dashboard-metric-card">
      <div class="metric-title">{{ title }}</div>
      <div
        class="metric-value"
        data-testid="dashboard-metric-value"
        :style="{ color: metricView.color }"
      >
        {{ metricView.text }}
      </div>
      <div
        v-if="metricView.delta !== null && metricView.delta !== undefined"
        class="metric-delta"
        data-testid="dashboard-metric-delta"
        :class="{ up: metricView.up, down: metricView.down }"
      >
        <span>{{ metricView.up ? '↑' : metricView.down ? '↓' : '→' }}</span>
        <span>
          {{ metricView.delta > 0 ? '+' : '' }}{{ metricView.delta
          }}<template v-if="metricView.deltaPercent !== null">
            （{{ metricView.deltaPercent > 0 ? '+' : '' }}{{ metricView.deltaPercent }}%）
          </template>
        </span>
        <em v-if="metricView.compareLabel">{{ metricView.compareLabel }}</em>
      </div>
      <div
        v-if="showSpark"
        ref="sparkHost"
        class="metric-spark"
        data-testid="dashboard-metric-spark"
      />
    </div>
    <div v-else-if="type === 'text'" class="text-widget" data-testid="dashboard-text-widget">
      {{ textContent || title || '文本组件' }}
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
  width: 100%;
  height: 100%;
  min-height: 160px;
}
.chart-canvas {
  width: 100%;
  height: 100%;
  min-height: 180px;
}
.metric-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  height: 100%;
  min-height: 140px;
  padding: 16px 18px;
}
.metric-title {
  font-size: 13px;
  color: var(--text-secondary, #646a73);
}
.metric-value {
  font-size: 40px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.02em;
}
.metric-delta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-tertiary, #8f959e);
}
.metric-delta.up {
  color: #0f9d58;
}
.metric-delta.down {
  color: #d4380d;
}
.metric-delta em {
  font-style: normal;
  color: var(--text-tertiary, #8f959e);
}
.metric-spark {
  width: 100%;
  height: 48px;
  margin-top: 4px;
}
.text-widget {
  padding: 20px 16px;
  font-size: 14px;
  line-height: 1.6;
  color: #4e5969;
  white-space: pre-wrap;
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
  border-bottom: 1px solid #f2f4f7;
  font-size: 13px;
}
</style>
