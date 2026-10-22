<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import DashboardChart from './DashboardChart.vue';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import type {
  DashboardDataDto,
  DashboardDto,
  DashboardScheduleDto,
  DashboardWidgetData,
  FieldDto,
  MetricConditionalRule,
  SheetDto,
} from '../api/types';

const props = defineProps<{
  baseId: string;
  kind: 'dashboard' | 'report';
  sheets: SheetDto[];
}>();

const emit = defineEmits<{ close: [] }>();

const dashboards = ref<DashboardDto[]>([]);
const active = ref<DashboardDto | null>(null);
const data = ref<DashboardDataDto | null>(null);
const schedules = ref<DashboardScheduleDto[]>([]);
const loading = ref(false);

type WidgetType =
  | 'bar'
  | 'horizontalBar'
  | 'line'
  | 'pie'
  | 'combo'
  | 'wordcloud'
  | 'metric'
  | 'table'
  | 'text';

const configTab = ref<'basic' | 'more'>('basic');
const widgetType = ref<WidgetType>('bar');
const stackMode = ref<'none' | 'stack' | 'percent'>('none');
const widgetTitle = ref('按区域统计');
const widgetText = ref('');
const widgetSheetId = ref('');
const dimensionField = ref('');
const metricField = ref('');
const aggregation = ref<'sum' | 'count' | 'avg' | 'min' | 'max'>('count');
const sortBy = ref<'value' | 'label'>('value');
const sortOrder = ref<'asc' | 'desc'>('desc');
const themeColor = ref('#2d8cf0');

const chartTypeOptions: Array<{ value: WidgetType; label: string; icon: string }> = [
  { value: 'bar', label: '柱状图', icon: '▮▮' },
  { value: 'line', label: '折线图', icon: '╱╲' },
  { value: 'pie', label: '饼图', icon: '◐' },
  { value: 'horizontalBar', label: '条形图', icon: '☰' },
  { value: 'combo', label: '组合图', icon: '▮╱' },
  { value: 'table', label: '表格', icon: '▦' },
  { value: 'wordcloud', label: '词云', icon: '云' },
  { value: 'metric', label: '指标卡', icon: '12' },
  { value: 'text', label: '文本', icon: 'T' },
];

const themeSwatches = [
  '#2d8cf0',
  '#36cfc9',
  '#73d13d',
  '#ffc53d',
  '#ff7a45',
  '#9254de',
  '#eb2f96',
  '#13c2c2',
];

const previewLabels = computed(() => ['未领', '已领', '其他']);
const previewValues = computed(() => [3, 2, 1]);
const showLegend = ref(true);
const showLabel = ref(false);
const legendPosition = ref<'top' | 'bottom' | 'left' | 'right' | 'topRight'>(
  'top',
);
const showXAxis = ref(true);
const showYAxis = ref(true);
const showGrid = ref(true);
const xAxisTitle = ref('');
const yAxisTitle = ref('');
const yMin = ref<number | null>(null);
const yMax = ref<number | null>(null);
const logScale = ref(false);
const compareMode = ref<'none' | 'mom' | 'yoy'>('none');
const compareWindowDays = ref(30);
const trendEnabled = ref(false);
const trendDays = ref(7);
const valuePrefix = ref('');
const valueSuffix = ref('');
const decimalPlaces = ref(0);
const conditionalRules = ref<MetricConditionalRule[]>([]);
const sheetFields = ref<FieldDto[]>([]);
const cron = ref('0 9 * * *');
const channel = ref('notification');
const dragWidgetId = ref('');
const dropWidgetId = ref('');
const busyWidgetId = ref('');

const previewMetric = computed(() => {
  if (widgetType.value !== 'metric') return null;
  const value = previewValues.value[0] ?? 0;
  const previous = compareMode.value === 'none' ? null : Math.max(0, value - 1);
  const delta = previous === null ? null : value - previous;
  const deltaPercent =
    previous && previous !== 0
      ? Math.round(((delta ?? 0) / Math.abs(previous)) * 1000) / 10
      : null;
  const ruleColor = conditionalRules.value.find((rule) => {
    if (rule.op === 'gt') return value > rule.value;
    if (rule.op === 'gte') return value >= rule.value;
    if (rule.op === 'lt') return value < rule.value;
    if (rule.op === 'lte') return value <= rule.value;
    if (rule.op === 'eq') return value === rule.value;
    if (rule.op === 'between') {
      const lo = Math.min(rule.value, rule.value2 ?? rule.value);
      const hi = Math.max(rule.value, rule.value2 ?? rule.value);
      return value >= lo && value <= hi;
    }
    return false;
  })?.color;
  return {
    value,
    previousValue: previous,
    delta,
    deltaPercent,
    compareLabel:
      compareMode.value === 'mom'
        ? `环比近${compareWindowDays.value}天`
        : compareMode.value === 'yoy'
          ? '同比去年同期'
          : undefined,
    displayColor: ruleColor ?? themeColor.value,
    prefix: valuePrefix.value,
    suffix: valueSuffix.value,
    decimalPlaces: decimalPlaces.value,
  };
});

function addConditionalRule(): void {
  conditionalRules.value.push({
    op: 'gte',
    value: 0,
    color: '#0f9d58',
  });
}

function removeConditionalRule(index: number): void {
  conditionalRules.value.splice(index, 1);
}

function layoutOf(widget: DashboardWidgetData): {
  w: number;
  h: number;
} {
  const raw = widget.layout ?? {};
  return {
    w: Math.min(12, Math.max(3, Number(raw.w ?? 6))),
    h: Math.min(6, Math.max(2, Number(raw.h ?? 3))),
  };
}

async function resizeWidget(
  widget: DashboardWidgetData,
  deltaWidth: number,
  deltaHeight: number,
): Promise<void> {
  if (!active.value || busyWidgetId.value) return;
  const layout = layoutOf(widget);
  busyWidgetId.value = widget.id;
  try {
    await endpoints.updateDashboardWidget(active.value.id, widget.id, {
      layout: {
        ...(widget.layout ?? {}),
        w: Math.min(12, Math.max(3, layout.w + deltaWidth)),
        h: Math.min(6, Math.max(2, layout.h + deltaHeight)),
      },
    });
    data.value = await endpoints.getDashboardData(active.value.id);
  } catch (error) {
    toast(messageOf(error));
  } finally {
    busyWidgetId.value = '';
  }
}

async function deleteWidget(widget: DashboardWidgetData): Promise<void> {
  if (!active.value) return;
  const ok = await confirmDialog(`删除图表「${widget.title}」？`, {
    title: '删除图表',
    confirmLabel: '删除',
  });
  if (!ok) return;
  try {
    await endpoints.deleteDashboardWidget(active.value.id, widget.id);
    data.value = await endpoints.getDashboardData(active.value.id);
    toast('图表已删除');
  } catch (error) {
    toast(messageOf(error));
  }
}

function onDragStart(widget: DashboardWidgetData): void {
  dragWidgetId.value = widget.id;
}

function onDragOver(widget: DashboardWidgetData): void {
  if (dragWidgetId.value && dragWidgetId.value !== widget.id) {
    dropWidgetId.value = widget.id;
  }
}

async function onDrop(widget: DashboardWidgetData): Promise<void> {
  if (!active.value || !dragWidgetId.value) return;
  const list = [...(data.value?.widgets ?? [])];
  const from = list.findIndex((item) => item.id === dragWidgetId.value);
  const to = list.findIndex((item) => item.id === widget.id);
  dragWidgetId.value = '';
  dropWidgetId.value = '';
  if (from < 0 || to < 0 || from === to) return;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  try {
    await Promise.all(
      list.map((item, index) =>
        endpoints.updateDashboardWidget(active.value!.id, item.id, {
          order: index,
        }),
      ),
    );
    data.value = await endpoints.getDashboardData(active.value.id);
    toast('图表顺序已保存');
  } catch (error) {
    toast(messageOf(error));
  }
}

const title = computed(() =>
  props.kind === 'report' ? '分析报告' : '仪表盘',
);

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

async function loadDashboards(): Promise<void> {
  loading.value = true;
  try {
    dashboards.value = await endpoints.listDashboards(props.baseId, props.kind);
    if (dashboards.value[0]) {
      await selectDashboard(dashboards.value[0]);
    } else {
      active.value = null;
      data.value = null;
      schedules.value = [];
    }
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

async function createDashboard(): Promise<void> {
  try {
    const created = await endpoints.createDashboard(props.baseId, {
      name: `${title.value} ${dashboards.value.length + 1}`,
      kind: props.kind,
    });
    dashboards.value = [...dashboards.value, created];
    await selectDashboard(created);
  } catch (error) {
    toast(messageOf(error));
  }
}

async function selectDashboard(dashboard: DashboardDto): Promise<void> {
  active.value = dashboard;
  loading.value = true;
  try {
    const [detail, dashboardData, scheduleList] = await Promise.all([
      endpoints.getDashboard(dashboard.id),
      endpoints.getDashboardData(dashboard.id),
      endpoints.listDashboardSchedules(dashboard.id),
    ]);
    data.value = dashboardData;
    schedules.value = scheduleList;
    const firstWidget = (detail as unknown as { widgets?: Array<{ sheetId?: string }> })
      .widgets?.[0];
    if (firstWidget?.sheetId) {
      widgetSheetId.value = firstWidget.sheetId;
      await loadFields(firstWidget.sheetId);
    } else if (props.sheets[0]) {
      widgetSheetId.value = props.sheets[0].id;
      await loadFields(props.sheets[0].id);
    }
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

let fieldsLoadSeq = 0;

async function loadFields(sheetId: string): Promise<void> {
  if (!sheetId) {
    sheetFields.value = [];
    return;
  }
  const seq = ++fieldsLoadSeq;
  sheetFields.value = [];
  dimensionField.value = '';
  metricField.value = '';
  try {
    const sheet = await endpoints.getSheet(sheetId);
    if (seq !== fieldsLoadSeq || widgetSheetId.value !== sheetId) return;
    sheetFields.value = sheet.fields ?? [];
    dimensionField.value = sheetFields.value[0]?.id ?? '';
    const metricCandidate = sheetFields.value.find(
      (field) => field.type === 'number' || field.type === 'currency',
    );
    metricField.value = metricCandidate?.id ?? '';
  } catch (error) {
    if (seq !== fieldsLoadSeq) return;
    sheetFields.value = [];
    toast(messageOf(error));
  }
}

watch(widgetSheetId, (sheetId, previous) => {
  if (!sheetId || sheetId === previous) return;
  void loadFields(sheetId);
});

async function addWidget(): Promise<void> {
  if (!active.value) return;
  if (widgetType.value !== 'text' && !widgetSheetId.value) {
    toast('请选择工作表');
    return;
  }
  if (
    widgetType.value !== 'text' &&
    widgetType.value !== 'metric' &&
    !dimensionField.value
  ) {
    toast('请选择工作表和维度字段');
    return;
  }
  try {
    await endpoints.addDashboardWidget(active.value.id, {
      type: widgetType.value,
      title: widgetTitle.value,
      ...(widgetType.value === 'text'
        ? {}
        : { sheetId: widgetSheetId.value }),
      config: {
        dimensionFieldId:
          widgetType.value === 'metric'
            ? undefined
            : dimensionField.value || undefined,
        metricFieldId: metricField.value || undefined,
        aggregation: aggregation.value,
        sortBy: sortBy.value,
        sortOrder: sortOrder.value,
        themeColor: themeColor.value,
        showLegend: showLegend.value,
        showLabel: showLabel.value,
        legendPosition: legendPosition.value,
        stackMode: stackMode.value,
        showXAxis: showXAxis.value,
        showYAxis: showYAxis.value,
        showGrid: showGrid.value,
        xAxisTitle: xAxisTitle.value || undefined,
        yAxisTitle: yAxisTitle.value || undefined,
        yMin: yMin.value,
        yMax: yMax.value,
        logScale: logScale.value,
        textContent: widgetText.value || undefined,
        ...(widgetType.value === 'metric'
          ? {
              compareMode: compareMode.value,
              compareWindowDays: compareWindowDays.value,
              trendEnabled: trendEnabled.value,
              trendDays: trendDays.value,
              conditionalRules: conditionalRules.value,
              valuePrefix: valuePrefix.value || undefined,
              valueSuffix: valueSuffix.value || undefined,
              decimalPlaces: decimalPlaces.value,
            }
          : {}),
      },
      layout: { w: widgetType.value === 'metric' ? 4 : 6, h: 3 },
    });
    await selectDashboard(active.value);
    toast('图表已添加');
  } catch (error) {
    toast(messageOf(error));
  }
}

async function addSchedule(): Promise<void> {
  if (!active.value) return;
  try {
    await endpoints.createDashboardSchedule(active.value.id, {
      cron: cron.value,
      channel: channel.value,
    });
    schedules.value = await endpoints.listDashboardSchedules(active.value.id);
    toast('定时推送已创建');
  } catch (error) {
    toast(messageOf(error));
  }
}

async function runSchedule(schedule: DashboardScheduleDto): Promise<void> {
  if (!active.value) return;
  try {
    await endpoints.runDashboardSchedule(active.value.id, schedule.id);
    schedules.value = await endpoints.listDashboardSchedules(active.value.id);
    toast('已执行定时推送');
  } catch (error) {
    toast(messageOf(error));
  }
}

onMounted(loadDashboards);
</script>

<template>
  <section class="dashboard-panel" data-testid="dashboard-panel">
    <header class="panel-header">
      <div>
        <strong>{{ title }}</strong>
        <p class="panel-subtitle">多图布局 · 定时推送</p>
      </div>
      <button class="icon-btn" data-testid="dashboard-close" @click="emit('close')">
        ×
      </button>
    </header>

    <div class="dashboard-body">
      <aside class="dashboard-list">
        <button class="btn btn-primary" data-testid="dashboard-create" @click="createDashboard">
          + 新建{{ title }}
        </button>
        <button
          v-for="dashboard in dashboards"
          :key="dashboard.id"
          class="dashboard-row"
          :class="{ active: active?.id === dashboard.id }"
          data-testid="dashboard-row"
          @click="selectDashboard(dashboard)"
        >
          {{ dashboard.name }}
        </button>
        <p v-if="!dashboards.length && !loading" class="empty-hint">
          还没有{{ title }}，点击上方新建。
        </p>
      </aside>

      <div v-if="active" class="dashboard-main">
        <section class="widget-builder chart-config">
          <div class="chart-config-main">
          <h4>添加图表</h4>
          <div class="config-tabs">
            <button
              type="button"
              class="tab"
              :class="{ active: configTab === 'basic' }"
              data-testid="dashboard-config-basic"
              @click="configTab = 'basic'"
            >
              基础配置
            </button>
            <button
              type="button"
              class="tab"
              :class="{ active: configTab === 'more' }"
              data-testid="dashboard-config-more"
              @click="configTab = 'more'"
            >
              更多配置
            </button>
          </div>
          <div v-if="configTab === 'basic'" class="builder-grid">
            <div class="type-block">
              <span class="field-label">图表类型</span>
              <div class="type-grid" data-testid="dashboard-widget-type-grid">
                <button
                  v-for="item in chartTypeOptions"
                  :key="item.value"
                  type="button"
                  class="type-card"
                  :class="{ active: widgetType === item.value }"
                  :data-testid="`dashboard-type-${item.value}`"
                  @click="widgetType = item.value"
                >
                  <span class="type-icon">{{ item.icon }}</span>
                  <span>{{ item.label }}</span>
                </button>
              </div>
              <select
                v-model="widgetType"
                class="sr-only-select"
                data-testid="dashboard-widget-type"
              >
                <option
                  v-for="item in chartTypeOptions"
                  :key="item.value"
                  :value="item.value"
                >
                  {{ item.label }}
                </option>
              </select>
            </div>
            <label v-if="widgetType === 'bar' || widgetType === 'horizontalBar'">
              柱状子类
              <select v-model="stackMode" data-testid="dashboard-stack-mode">
                <option value="none">普通</option>
                <option value="stack">堆积</option>
                <option value="percent">百分比堆积</option>
              </select>
            </label>
            <div class="type-block">
              <span class="field-label">主题色</span>
              <div class="swatch-row">
                <button
                  v-for="color in themeSwatches"
                  :key="color"
                  type="button"
                  class="swatch"
                  :class="{ active: themeColor === color }"
                  :style="{ background: color }"
                  :data-testid="`dashboard-theme-${color}`"
                  @click="themeColor = color"
                />
                <input
                  v-model="themeColor"
                  type="color"
                  class="swatch-custom"
                  data-testid="dashboard-theme-color"
                />
              </div>
            </div>
            <label>
              标题
              <input v-model="widgetTitle" data-testid="dashboard-widget-title" />
            </label>
            <label v-if="widgetType === 'text'">
              文本内容
              <input v-model="widgetText" data-testid="dashboard-widget-text" />
            </label>
            <template v-if="widgetType !== 'text'">
              <label>
                工作表
                <select v-model="widgetSheetId" data-testid="dashboard-widget-sheet">
                  <option v-for="sheet in sheets" :key="sheet.id" :value="sheet.id">
                    {{ sheet.name }}
                  </option>
                </select>
              </label>
              <label v-if="widgetType !== 'metric'">
                横轴（类别）字段
                <select v-model="dimensionField" data-testid="dashboard-widget-dimension">
                  <option v-for="field in sheetFields" :key="field.id" :value="field.id">
                    {{ field.name }}
                  </option>
                </select>
              </label>
              <label>
                {{ widgetType === 'metric' ? '数值字段' : '纵轴数值字段' }}
                <select v-model="metricField" data-testid="dashboard-widget-metric">
                  <option value="">无（记录行数）</option>
                  <option v-for="field in sheetFields" :key="field.id" :value="field.id">
                    {{ field.name }}
                  </option>
                </select>
              </label>
              <label>
                聚合
                <select v-model="aggregation" data-testid="dashboard-widget-aggregation">
                  <option value="count">记录行数</option>
                  <option value="sum">求和</option>
                  <option value="avg">平均</option>
                  <option value="min">最小</option>
                  <option value="max">最大</option>
                </select>
              </label>
              <template v-if="widgetType === 'metric'">
                <label>
                  对比期
                  <select v-model="compareMode" data-testid="dashboard-metric-compare">
                    <option value="none">无</option>
                    <option value="mom">环比</option>
                    <option value="yoy">同比</option>
                  </select>
                </label>
                <label v-if="compareMode === 'mom'">
                  环比天数
                  <input
                    v-model.number="compareWindowDays"
                    type="number"
                    min="1"
                    max="366"
                    data-testid="dashboard-metric-window"
                  />
                </label>
                <label class="inline-check">
                  <span>趋势折线</span>
                  <span>
                    <input
                      v-model="trendEnabled"
                      type="checkbox"
                      data-testid="dashboard-metric-trend"
                    />
                    显示
                  </span>
                </label>
                <label v-if="trendEnabled">
                  趋势天数
                  <input
                    v-model.number="trendDays"
                    type="number"
                    min="3"
                    max="90"
                    data-testid="dashboard-metric-trend-days"
                  />
                </label>
                <label>
                  前缀
                  <input v-model="valuePrefix" data-testid="dashboard-metric-prefix" placeholder="如 ¥" />
                </label>
                <label>
                  后缀
                  <input v-model="valueSuffix" data-testid="dashboard-metric-suffix" placeholder="如 元" />
                </label>
                <label>
                  小数位
                  <input
                    v-model.number="decimalPlaces"
                    type="number"
                    min="0"
                    max="6"
                    data-testid="dashboard-metric-decimals"
                  />
                </label>
                <div class="metric-rules" data-testid="dashboard-metric-rules">
                  <div class="field-label">条件格式</div>
                  <div
                    v-for="(rule, index) in conditionalRules"
                    :key="index"
                    class="metric-rule-row"
                  >
                    <select v-model="rule.op">
                      <option value="gt">大于</option>
                      <option value="gte">大于等于</option>
                      <option value="lt">小于</option>
                      <option value="lte">小于等于</option>
                      <option value="eq">等于</option>
                      <option value="between">介于</option>
                    </select>
                    <input v-model.number="rule.value" type="number" />
                    <input
                      v-if="rule.op === 'between'"
                      v-model.number="rule.value2"
                      type="number"
                    />
                    <input v-model="rule.color" type="color" title="颜色" />
                    <button
                      type="button"
                      class="icon-btn"
                      @click="removeConditionalRule(index)"
                    >
                      ×
                    </button>
                  </div>
                  <button
                    type="button"
                    class="btn btn-ghost"
                    data-testid="dashboard-metric-rule-add"
                    @click="addConditionalRule"
                  >
                    + 添加规则
                  </button>
                </div>
              </template>
              <template v-else>
                <label>
                  排序依据
                  <select v-model="sortBy" data-testid="dashboard-widget-sort-by">
                    <option value="value">聚合值</option>
                    <option value="label">横轴值</option>
                  </select>
                </label>
                <label>
                  排序方向
                  <select v-model="sortOrder" data-testid="dashboard-widget-sort-order">
                    <option value="desc">降序</option>
                    <option value="asc">选项正序</option>
                  </select>
                </label>
              </template>
            </template>
          </div>
          <div v-else class="builder-grid">
            <label class="inline-check">
              <span>图例</span>
              <span>
                <input v-model="showLegend" type="checkbox" /> 显示
              </span>
            </label>
            <label>
              图例位置
              <select v-model="legendPosition" data-testid="dashboard-legend-position">
                <option value="top">靠上</option>
                <option value="bottom">靠下</option>
                <option value="left">靠左</option>
                <option value="right">靠右</option>
                <option value="topRight">右上</option>
              </select>
            </label>
            <label class="inline-check">
              <span>数据标签</span>
              <span>
                <input v-model="showLabel" type="checkbox" /> 显示
              </span>
            </label>
            <label class="inline-check">
              <span>横坐标轴</span>
              <span>
                <input v-model="showXAxis" type="checkbox" /> 显示
              </span>
            </label>
            <label>
              横轴标题
              <input v-model="xAxisTitle" data-testid="dashboard-xaxis-title" />
            </label>
            <label class="inline-check">
              <span>纵坐标轴</span>
              <span>
                <input v-model="showYAxis" type="checkbox" /> 显示
              </span>
            </label>
            <label>
              纵轴标题
              <input v-model="yAxisTitle" data-testid="dashboard-yaxis-title" />
            </label>
            <label>
              纵轴最小
              <input v-model.number="yMin" type="number" data-testid="dashboard-ymin" />
            </label>
            <label>
              纵轴最大
              <input v-model.number="yMax" type="number" data-testid="dashboard-ymax" />
            </label>
            <label class="inline-check">
              <span>对数刻度</span>
              <span>
                <input v-model="logScale" type="checkbox" data-testid="dashboard-log-scale" /> 开启
              </span>
            </label>
            <label class="inline-check">
              <span>网格线</span>
              <span>
                <input v-model="showGrid" type="checkbox" data-testid="dashboard-grid" /> 显示
              </span>
            </label>
          </div>
          </div>

          <aside class="chart-preview" data-testid="dashboard-chart-preview">
            <header class="preview-head">
              <strong>图表</strong>
            </header>
            <DashboardChart
              :type="widgetType"
              :title="widgetTitle || '预览'"
              :labels="
                widgetType === 'metric' && trendEnabled
                  ? ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']
                  : previewLabels
              "
              :values="
                widgetType === 'metric' && trendEnabled
                  ? [1, 2, 2, 3, 2, 4, 3]
                  : previewValues
              "
              :theme-color="themeColor"
              :show-legend="showLegend"
              :show-label="showLabel"
              :legend-position="legendPosition"
              :stack-mode="stackMode"
              :show-x-axis="showXAxis"
              :show-y-axis="showYAxis"
              :show-grid="showGrid"
              :x-axis-title="xAxisTitle"
              :y-axis-title="yAxisTitle"
              :y-min="yMin"
              :y-max="yMax"
              :log-scale="logScale"
              :text-content="widgetText || '文本预览'"
              :metric="previewMetric"
            />
            <div class="preview-actions">
              <button type="button" class="btn" @click="configTab = 'basic'">
                取消
              </button>
              <button
                class="btn btn-primary"
                data-testid="dashboard-widget-add"
                @click="addWidget"
              >
                添加
              </button>
            </div>
          </aside>
        </section>

        <section class="chart-grid" data-testid="dashboard-canvas">
          <article
            v-for="widget in data?.widgets ?? []"
            :key="widget.id"
            class="chart-card"
            :class="{ dragging: dragWidgetId === widget.id, 'drop-target': dropWidgetId === widget.id }"
            :style="{
              gridColumn: `span ${layoutOf(widget).w}`,
              minHeight: `${layoutOf(widget).h * 76}px`,
            }"
            draggable="true"
            data-testid="dashboard-widget-card"
            @dragstart="onDragStart(widget)"
            @dragover.prevent="onDragOver(widget)"
            @drop.prevent="onDrop(widget)"
            @dragend="dragWidgetId = ''; dropWidgetId = ''"
          >
            <div class="chart-card-tools">
              <span class="drag-grip" title="拖动排序">⠿</span>
              <button
                class="icon-btn"
                title="加宽"
                :disabled="busyWidgetId === widget.id"
                @click="resizeWidget(widget, 2, 0)"
              >
                ↔
              </button>
              <button
                class="icon-btn"
                title="变窄"
                :disabled="busyWidgetId === widget.id"
                @click="resizeWidget(widget, -2, 0)"
              >
                ⇤
              </button>
              <button
                class="icon-btn"
                title="增高"
                :disabled="busyWidgetId === widget.id"
                @click="resizeWidget(widget, 0, 1)"
              >
                ↕
              </button>
              <button
                class="icon-btn"
                title="降低"
                :disabled="busyWidgetId === widget.id"
                @click="resizeWidget(widget, 0, -1)"
              >
                ⇥
              </button>
              <button class="icon-btn danger" title="删除图表" @click="deleteWidget(widget)">
                ×
              </button>
            </div>
            <DashboardChart
              :type="widget.type"
              :title="widget.title"
              :labels="widget.labels"
              :values="widget.values"
              :theme-color="widget.config?.themeColor"
              :show-legend="widget.config?.showLegend"
              :show-label="widget.config?.showLabel"
              :legend-position="widget.config?.legendPosition"
              :stack-mode="widget.config?.stackMode"
              :show-x-axis="widget.config?.showXAxis"
              :show-y-axis="widget.config?.showYAxis"
              :show-grid="widget.config?.showGrid"
              :x-axis-title="widget.config?.xAxisTitle"
              :y-axis-title="widget.config?.yAxisTitle"
              :y-min="widget.config?.yMin"
              :y-max="widget.config?.yMax"
              :log-scale="widget.config?.logScale"
              :text-content="widget.config?.textContent"
              :metric="widget.metric"
            />
          </article>
          <p v-if="!data?.widgets?.length" class="empty-hint">
            暂无图表，添加一个后即可在画布上查看；拖动卡片可排序，↔/↕ 调整大小。
          </p>
        </section>

        <section class="schedule-block">
          <h4>定时推送</h4>
          <div class="schedule-form">
            <label>
              Cron
              <input v-model="cron" data-testid="dashboard-schedule-cron" />
            </label>
            <label>
              渠道
              <select v-model="channel">
                <option value="notification">站内通知</option>
                <option value="group-chat">群聊</option>
                <option value="wecom">企微应用消息</option>
              </select>
            </label>
            <button
              class="btn"
              data-testid="dashboard-schedule-add"
              @click="addSchedule"
            >
              创建定时推送
            </button>
          </div>
          <div
            v-for="schedule in schedules"
            :key="schedule.id"
            class="schedule-row"
            data-testid="dashboard-schedule-row"
          >
            <span>
              {{ schedule.cron }} · {{ schedule.channel }}
              <small v-if="schedule.lastRunAt">
                上次 {{ new Date(schedule.lastRunAt).toLocaleString() }}
              </small>
            </span>
            <span class="schedule-actions">
              <em>{{ schedule.runs[0]?.status ?? '未运行' }}</em>
              <button
                class="btn btn-ghost"
                data-testid="dashboard-schedule-run"
                @click="runSchedule(schedule)"
              >
                立即执行
              </button>
            </span>
          </div>
        </section>
      </div>
      <div v-else class="dashboard-main empty-hint">
        选择或新建{{ title }}。
      </div>
    </div>
  </section>
</template>

<style scoped>
.dashboard-panel {
  display: flex;
  flex-direction: column;
  width: min(1120px, 95vw);
  height: min(840px, 90vh);
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.24);
}
.panel-header {
  display: flex;
  justify-content: space-between;
  padding: 18px 22px;
  border-bottom: 1px solid #e5e6eb;
}
.panel-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: #8a9099;
}
.dashboard-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.dashboard-list {
  width: 220px;
  padding: 12px;
  background: #fafbfc;
  border-right: 1px solid #e5e6eb;
  overflow: auto;
}
.dashboard-row {
  display: block;
  width: 100%;
  margin-top: 8px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.dashboard-row.active {
  background: #eef4ff;
  border-color: #cfe0ff;
}
.dashboard-main {
  flex: 1;
  padding: 16px 20px;
  overflow: auto;
}
.widget-builder,
.schedule-block {
  padding: 14px;
  border: 1px solid #e5e6eb;
  border-radius: 10px;
}
.chart-config {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
  gap: 16px;
  align-items: start;
}
.chart-config-main {
  min-width: 0;
}
.chart-preview {
  min-height: 280px;
  border: 1px solid #eef0f3;
  border-radius: 10px;
  background: #fafbfc;
  padding: 10px;
  position: sticky;
  top: 0;
}
.preview-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 13px;
}
.widget-builder h4,
.schedule-block h4 {
  margin: 0 0 10px;
}
.config-tabs {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border, #e5e6eb);
}
.config-tabs .tab {
  height: 32px;
  padding: 0 4px;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  font-size: 13px;
  color: var(--text-secondary, #646a73);
  cursor: pointer;
}
.config-tabs .tab.active {
  border-bottom-color: var(--brand, #2d8cf0);
  background: transparent;
  color: var(--text, #1f2329);
  font-weight: 600;
}
.preview-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #eef0f3;
}
.metric-rules {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.metric-rule-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.metric-rule-row select,
.metric-rule-row input[type='number'] {
  height: 30px;
  padding: 0 8px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
}
.metric-rule-row input[type='color'] {
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  background: transparent;
}
.type-block {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.field-label {
  font-size: 12px;
  color: #646a73;
}
.type-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}
.type-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-height: 64px;
  padding: 8px 4px;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  background: #fff;
  font-size: 11px;
  color: #4e5969;
  cursor: pointer;
}
.type-card.active {
  border-color: #2d8cf0;
  background: #e8f3ff;
  color: #1d6fdc;
}
.type-icon {
  font-size: 16px;
  line-height: 1.2;
}
.swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.swatch {
  width: 22px;
  height: 22px;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
}
.swatch.active {
  box-shadow: 0 0 0 2px #fff, 0 0 0 4px #2d8cf0;
}
.swatch-custom {
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  background: transparent;
}
.sr-only-select {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.builder-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  align-items: end;
  position: relative;
}
@media (max-width: 1100px) {
  .chart-config {
    grid-template-columns: 1fr;
  }
  .type-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
.inline-check > span:last-child {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
}
.builder-grid label,
.schedule-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #646a73;
}
.builder-grid select,
.builder-grid input,
.schedule-form input,
.schedule-form select {
  height: 30px;
  padding: 0 8px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
  background: #fff;
}
.chart-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-auto-flow: row dense;
  gap: 14px;
  margin-top: 16px;
}
.chart-card {
  position: relative;
  min-width: 0;
  border: 1px solid #eef0f3;
  border-radius: 10px;
  background: #fff;
  padding: 6px;
  transition:
    box-shadow 0.15s,
    border-color 0.15s,
    opacity 0.15s;
}
.chart-card:hover {
  border-color: #d6e4ff;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
}
.chart-card.dragging {
  opacity: 0.45;
}
.chart-card.drop-target {
  border-color: #2d8cf0;
  box-shadow: 0 0 0 2px #d6e4ff;
}
.chart-card-tools {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 2px;
  border: 1px solid #eef0f3;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.94);
  opacity: 0;
  transition: opacity 0.15s;
}
.chart-card:hover .chart-card-tools {
  opacity: 1;
}
.chart-card-tools .icon-btn {
  width: 22px;
  height: 22px;
  font-size: 11px;
}
.drag-grip {
  padding: 0 4px;
  color: #98a2b3;
  cursor: grab;
  font-size: 13px;
}
.icon-btn.danger {
  color: #d4380d;
}
.schedule-block {
  margin-top: 16px;
}
.schedule-form {
  display: flex;
  gap: 10px;
  align-items: end;
}
.schedule-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f8f9fb;
  font-size: 13px;
}
.schedule-row small {
  margin-left: 8px;
  color: #8a9099;
}
.schedule-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.schedule-actions em {
  font-style: normal;
  color: #0f9d58;
}
.empty-hint {
  color: #8a9099;
  font-size: 12px;
}
</style>
