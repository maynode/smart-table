<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import DashboardChart from './DashboardChart.vue';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import { toast } from '../ui/toast';
import type {
  DashboardDataDto,
  DashboardDto,
  DashboardScheduleDto,
  DashboardWidgetData,
  FieldDto,
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

const widgetType = ref<'bar' | 'line' | 'pie' | 'metric' | 'table'>('bar');
const widgetTitle = ref('按区域统计');
const widgetSheetId = ref('');
const dimensionField = ref('');
const metricField = ref('');
const aggregation = ref<'sum' | 'count' | 'avg' | 'min' | 'max'>('count');
const themeColor = ref('#2d8cf0');
const showLegend = ref(true);
const showLabel = ref(false);
const legendPosition = ref<'top' | 'bottom'>('top');
const sheetFields = ref<FieldDto[]>([]);
const cron = ref('0 9 * * *');
const channel = ref('notification');
const dragWidgetId = ref('');
const dropWidgetId = ref('');
const busyWidgetId = ref('');

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
  if (!active.value || !window.confirm(`删除图表「${widget.title}」？`)) return;
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

async function loadFields(sheetId: string): Promise<void> {
  try {
    const sheet = await endpoints.getSheet(sheetId);
    sheetFields.value = sheet.fields ?? [];
    if (!dimensionField.value && sheetFields.value[0]) {
      dimensionField.value = sheetFields.value[0].id;
    }
    const metricCandidate = sheetFields.value.find(
      (field) => field.type === 'number' || field.type === 'currency',
    );
    if (!metricField.value && metricCandidate) {
      metricField.value = metricCandidate.id;
    }
  } catch (error) {
    sheetFields.value = [];
    toast(messageOf(error));
  }
}

watch(widgetSheetId, (sheetId) => {
  if (sheetId) void loadFields(sheetId);
});

async function addWidget(): Promise<void> {
  if (!active.value) return;
  if (!widgetSheetId.value || !dimensionField.value) {
    toast('请选择工作表和维度字段');
    return;
  }
  try {
    await endpoints.addDashboardWidget(active.value.id, {
      type: widgetType.value,
      title: widgetTitle.value,
      sheetId: widgetSheetId.value,
      config: {
        dimensionFieldId: dimensionField.value,
        metricFieldId: metricField.value || undefined,
        aggregation: aggregation.value,
        themeColor: themeColor.value,
        showLegend: showLegend.value,
        showLabel: showLabel.value,
        legendPosition: legendPosition.value,
      },
      layout: { w: 6, h: 3 },
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
        <p class="panel-subtitle">
          ECharts 画布 · 多图布局 · 定时推送。分析引擎
          {{ data?.driver ?? 'postgres' }}。
        </p>
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
        <section class="widget-builder">
          <h4>添加图表</h4>
          <div class="builder-grid">
            <label>
              类型
              <select v-model="widgetType" data-testid="dashboard-widget-type">
                <option value="bar">柱状图</option>
                <option value="line">折线图</option>
                <option value="pie">饼图</option>
                <option value="metric">指标卡</option>
                <option value="table">表格</option>
              </select>
            </label>
            <label>
              标题
              <input v-model="widgetTitle" data-testid="dashboard-widget-title" />
            </label>
            <label>
              工作表
              <select v-model="widgetSheetId" data-testid="dashboard-widget-sheet">
                <option v-for="sheet in sheets" :key="sheet.id" :value="sheet.id">
                  {{ sheet.name }}
                </option>
              </select>
            </label>
            <label>
              分组字段
              <select v-model="dimensionField" data-testid="dashboard-widget-dimension">
                <option v-for="field in sheetFields" :key="field.id" :value="field.id">
                  {{ field.name }}
                </option>
              </select>
            </label>
            <label>
              数值字段
              <select v-model="metricField" data-testid="dashboard-widget-metric">
                <option value="">无</option>
                <option v-for="field in sheetFields" :key="field.id" :value="field.id">
                  {{ field.name }}
                </option>
              </select>
            </label>
            <label>
              聚合
              <select v-model="aggregation" data-testid="dashboard-widget-aggregation">
                <option value="count">计数</option>
                <option value="sum">求和</option>
                <option value="avg">平均</option>
                <option value="min">最小</option>
                <option value="max">最大</option>
              </select>
            </label>
            <label>
              主题色
              <input
                v-model="themeColor"
                type="color"
                data-testid="dashboard-widget-color"
              />
            </label>
            <label class="inline-check">
              <span>图例</span>
              <span>
                <input v-model="showLegend" type="checkbox" /> 显示
              </span>
            </label>
            <label>
              图例位置
              <select v-model="legendPosition">
                <option value="top">顶部</option>
                <option value="bottom">底部</option>
              </select>
            </label>
            <label class="inline-check">
              <span>数据标签</span>
              <span>
                <input v-model="showLabel" type="checkbox" /> 显示
              </span>
            </label>
            <button
              class="btn btn-primary"
              data-testid="dashboard-widget-add"
              @click="addWidget"
            >
              添加图表
            </button>
          </div>
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
.widget-builder h4,
.schedule-block h4 {
  margin: 0 0 10px;
}
.builder-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  align-items: end;
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
