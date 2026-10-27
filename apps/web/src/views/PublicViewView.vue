<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { endpoints } from '../api/endpoints';
import { ApiError, NetworkError } from '../api/client';
import DashboardChart from '../components/DashboardChart.vue';
import { liveBus } from '../sync/live-bus';
import { liveSocket } from '../sync/live-socket';
import { renderSimpleMarkdown } from '../ui/simple-markdown';
import type {
  PublicViewData,
  PublicViewDashboardData,
  PublicViewSheetData,
} from '../api/types';

type SectionKey = 'sheets' | 'forms' | 'dashboards' | 'reports';

const route = useRoute();
const token = String(route.params.token);
const data = ref<PublicViewData | null>(null);
const password = ref('');
const needPassword = ref(false);
const error = ref('');
const loading = ref(false);
const activeSection = ref<SectionKey>('sheets');
const activeSheetId = ref('');
const activeFormId = ref('');
const activeDashboardId = ref('');
const activeReportId = ref('');

const sheets = computed<PublicViewSheetData[]>(() => data.value?.sheets ?? []);
const formSheets = computed<PublicViewSheetData[]>(
  () => data.value?.formSheets ?? [],
);
const dashboards = computed<PublicViewDashboardData[]>(
  () => data.value?.dashboards ?? [],
);
const analysisReports = computed(
  () => data.value?.analysisReports ?? [],
);

const sections = computed(() => {
  const items: Array<{ key: SectionKey; label: string; count: number }> = [];
  if (sheets.value.length) {
    items.push({ key: 'sheets', label: '工作表', count: sheets.value.length });
  }
  if (formSheets.value.length) {
    items.push({
      key: 'forms',
      label: '表单收集结果',
      count: formSheets.value.length,
    });
  }
  if (dashboards.value.length) {
    items.push({
      key: 'dashboards',
      label: '仪表盘',
      count: dashboards.value.length,
    });
  }
  if (analysisReports.value.length) {
    items.push({
      key: 'reports',
      label: '分析报告',
      count: analysisReports.value.length,
    });
  }
  return items;
});

const activeSheet = computed(
  () =>
    sheets.value.find((sheet) => sheet.id === activeSheetId.value) ??
    sheets.value[0] ??
    null,
);
const activeForm = computed(
  () =>
    formSheets.value.find((sheet) => sheet.id === activeFormId.value) ??
    formSheets.value[0] ??
    null,
);
const activeDashboard = computed(
  () =>
    dashboards.value.find((item) => item.id === activeDashboardId.value) ??
    dashboards.value[0] ??
    null,
);
const activeReport = computed(
  () =>
    analysisReports.value.find((item) => item.id === activeReportId.value) ??
    analysisReports.value[0] ??
    null,
);

const totalRows = computed(
  () =>
    sheets.value.reduce((sum, sheet) => sum + sheet.records.length, 0) +
    formSheets.value.reduce((sum, sheet) => sum + sheet.records.length, 0),
);

watch(
  () => data.value,
  () => {
    activeSheetId.value = sheets.value[0]?.id ?? '';
    activeFormId.value = formSheets.value[0]?.id ?? '';
    activeDashboardId.value = dashboards.value[0]?.id ?? '';
    activeReportId.value = analysisReports.value[0]?.id ?? '';
    activeSection.value = sections.value[0]?.key ?? 'sheets';
  },
);

function displayValue(
  field: PublicViewSheetData['fields'][number],
  value: unknown,
) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (field.type === 'select' || field.type === 'multiSelect') {
    const options = field.options as
      | { choices?: Array<{ id: string; name: string }> }
      | undefined;
    const choices = options?.choices ?? [];
    if (Array.isArray(value)) {
      return value
        .map((item) => choices.find((choice) => choice.id === item)?.name ?? item)
        .join('、');
    }
    return choices.find((choice) => choice.id === value)?.name ?? String(value);
  }
  return String(value);
}

function messageOf(caught: unknown): string {
  if (caught instanceof ApiError) return caught.message;
  if (caught instanceof NetworkError) return caught.message;
  return '公开视图加载失败';
}

function widgetConfig(widget: PublicViewDashboardData['widgets'][number]) {
  return (widget.config ?? {}) as {
    themeColor?: string;
    showLegend?: boolean;
    showLabel?: boolean;
    legendPosition?: 'top' | 'bottom' | 'left' | 'right' | 'topRight';
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
  };
}

async function load(withPassword?: string): Promise<void> {
  if (loading.value) return;
  const submitted = withPassword?.trim() ?? '';
  if (needPassword.value && !submitted) {
    error.value = '请输入访问密码';
    return;
  }
  loading.value = true;
  error.value = '';
  const cacheKey = `public-view:${token}`;
  try {
    data.value = await endpoints.getPublicView(
      token,
      submitted || undefined,
    );
    needPassword.value = false;
    liveSocket.connectPublic(token);
    if (!submitted) {
      const { localDb } = await import('../sync/local-db-client');
      void localDb.putObjectCache(cacheKey, 'public-view', data.value);
    }
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 401) {
      needPassword.value = true;
      if (submitted) error.value = messageOf(caught);
    } else if (caught instanceof ApiError && caught.status === 403) {
      needPassword.value = true;
      error.value = messageOf(caught) || '访问密码错误';
    } else {
      try {
        const { localDb } = await import('../sync/local-db-client');
        const cached = await localDb.getObjectCache(cacheKey);
        if (cached) {
          data.value = cached as typeof data.value;
          needPassword.value = false;
          error.value = '';
        } else {
          error.value = messageOf(caught);
        }
      } catch {
        error.value = messageOf(caught);
      }
    }
  } finally {
    loading.value = false;
  }
}

function submitPassword(): void {
  void load(password.value);
}

const liveUnsubs: Array<() => void> = [];

function onPublicLive(): void {
  if (!data.value) return;
  void load(password.value || undefined);
}

onMounted(() => {
  void load();
  liveUnsubs.push(
    liveBus.on('sheet.rev_bumped', onPublicLive),
    liveBus.on('sheet.schema_changed', onPublicLive),
    liveBus.on('dashboard.updated', onPublicLive),
    liveBus.on('dashboard.deleted', onPublicLive),
    liveBus.on('widget.changed', onPublicLive),
    liveBus.on('public_view.*', onPublicLive),
    liveBus.on('form.updated', onPublicLive),
    liveBus.on('form.deleted', onPublicLive),
    liveBus.on('analysis.updated', onPublicLive),
    liveBus.on('analysis.deleted', onPublicLive),
  );
});

onBeforeUnmount(() => {
  while (liveUnsubs.length) liveUnsubs.pop()?.();
  liveSocket.disconnect();
});
</script>

<template>
  <div class="public-view-page">
    <header class="public-header">
      <strong>只读数据视图</strong>
      <span v-if="data">
        <template v-if="totalRows">共 {{ totalRows }} 行 · </template>
        不可编辑
      </span>
    </header>

    <div v-if="needPassword" class="password-card">
      <h2>{{ data?.name ?? '受保护的公开视图' }}</h2>
      <p>该视图需要访问密码。</p>
      <input
        v-model="password"
        type="password"
        placeholder="请输入访问密码"
        data-testid="public-view-password"
        :disabled="loading"
        @keyup.enter="submitPassword"
      />
      <p v-if="error" class="password-error" data-testid="public-view-error">
        {{ error }}
      </p>
      <button
        class="btn btn-primary"
        data-testid="public-view-submit"
        :disabled="loading"
        @click="submitPassword"
      >
        {{ loading ? '验证中…' : '查看数据' }}
      </button>
    </div>

    <div v-else-if="error" class="password-card">
      <h2>无法访问</h2>
      <p>{{ error }}</p>
    </div>

    <div v-else-if="loading" class="empty">加载中…</div>

    <template v-else-if="data">
      <div class="view-title">
        <h1>{{ data.name }}</h1>
        <small>公开只读</small>
      </div>

      <div
        v-if="sections.length > 1"
        class="section-tabs"
        data-testid="public-view-sections"
      >
        <button
          v-for="section in sections"
          :key="section.key"
          type="button"
          class="section-tab"
          :class="{ active: section.key === activeSection }"
          @click="activeSection = section.key"
        >
          {{ section.label }}
          <span class="count">{{ section.count }}</span>
        </button>
      </div>

      <template v-if="activeSection === 'sheets' && activeSheet">
        <div v-if="sheets.length > 1" class="item-tabs">
          <button
            v-for="sheet in sheets"
            :key="sheet.id"
            type="button"
            class="item-tab"
            :class="{ active: sheet.id === activeSheet.id }"
            @click="activeSheetId = sheet.id"
          >
            {{ sheet.name }}
          </button>
        </div>
        <div class="table-wrap">
          <table data-testid="public-view-table">
            <thead>
              <tr>
                <th v-for="field in activeSheet.fields" :key="field.id">
                  {{ field.name }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="record in activeSheet.records" :key="record.id">
                <td v-for="field in activeSheet.fields" :key="field.id">
                  {{ displayValue(field, record.cells[field.id]) }}
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!activeSheet.records.length" class="empty">暂无数据。</p>
        </div>
      </template>

      <template v-else-if="activeSection === 'forms' && activeForm">
        <div v-if="formSheets.length > 1" class="item-tabs">
          <button
            v-for="sheet in formSheets"
            :key="sheet.id"
            type="button"
            class="item-tab"
            :class="{ active: sheet.id === activeForm.id }"
            @click="activeFormId = sheet.id"
          >
            {{ sheet.name }}
          </button>
        </div>
        <div class="table-wrap">
          <table data-testid="public-view-form-table">
            <thead>
              <tr>
                <th v-for="field in activeForm.fields" :key="field.id">
                  {{ field.name }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="record in activeForm.records" :key="record.id">
                <td v-for="field in activeForm.fields" :key="field.id">
                  {{ displayValue(field, record.cells[field.id]) }}
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!activeForm.records.length" class="empty">暂无收集结果。</p>
        </div>
      </template>

      <template v-else-if="activeSection === 'dashboards' && activeDashboard">
        <div v-if="dashboards.length > 1" class="item-tabs">
          <button
            v-for="item in dashboards"
            :key="item.id"
            type="button"
            class="item-tab"
            :class="{ active: item.id === activeDashboard.id }"
            @click="activeDashboardId = item.id"
          >
            {{ item.name }}
          </button>
        </div>
        <div class="dashboard-grid" data-testid="public-view-dashboard">
          <div
            v-for="widget in activeDashboard.widgets"
            :key="widget.id"
            class="dashboard-card"
          >
            <DashboardChart
              :type="widget.type"
              :title="widget.title"
              :labels="widget.labels"
              :values="widget.values"
              :theme-color="widgetConfig(widget).themeColor"
              :show-legend="widgetConfig(widget).showLegend"
              :show-label="widgetConfig(widget).showLabel"
              :legend-position="widgetConfig(widget).legendPosition"
              :stack-mode="widgetConfig(widget).stackMode"
              :show-x-axis="widgetConfig(widget).showXAxis"
              :show-y-axis="widgetConfig(widget).showYAxis"
              :show-grid="widgetConfig(widget).showGrid"
              :x-axis-title="widgetConfig(widget).xAxisTitle"
              :y-axis-title="widgetConfig(widget).yAxisTitle"
              :y-min="widgetConfig(widget).yMin"
              :y-max="widgetConfig(widget).yMax"
              :log-scale="widgetConfig(widget).logScale"
              :text-content="widgetConfig(widget).textContent"
              :metric="widget.metric"
            />
          </div>
          <p v-if="!activeDashboard.widgets.length" class="empty">
            该仪表盘暂无组件。
          </p>
        </div>
      </template>

      <template v-else-if="activeSection === 'reports' && activeReport">
        <div v-if="analysisReports.length > 1" class="item-tabs">
          <button
            v-for="item in analysisReports"
            :key="item.id"
            type="button"
            class="item-tab"
            :class="{ active: item.id === activeReport.id }"
            @click="activeReportId = item.id"
          >
            {{ item.name }}
          </button>
        </div>
        <article
          class="report-body"
          data-testid="public-view-report"
          v-html="renderSimpleMarkdown(activeReport.reportMarkdown)"
        />
      </template>

      <p v-else class="empty">该公开视图没有可展示的内容。</p>
    </template>
  </div>
</template>

<style scoped>
.public-view-page {
  min-height: 100vh;
  background: linear-gradient(180deg, #eef2f7 0%, #f5f7fa 180px);
  color: #1f2329;
}
.public-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 22px;
  background: rgba(255, 255, 255, 0.92);
  border-bottom: 1px solid #e5e6eb;
  font-size: 13px;
  color: #646a73;
  backdrop-filter: blur(8px);
}
.public-header strong {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
}
.password-card {
  width: min(420px, 90vw);
  margin: 88px auto;
  padding: 28px 26px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.1);
  text-align: center;
  border: 1px solid #eef0f3;
}
.password-card h2 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
}
.password-card p {
  margin: 0;
  color: #8a9099;
  font-size: 13px;
  line-height: 1.5;
}
.password-card input {
  width: 100%;
  height: 38px;
  margin: 16px 0 12px;
  padding: 0 12px;
  border: 1px solid #d0d3d9;
  border-radius: 8px;
  box-sizing: border-box;
  font-size: 14px;
}
.password-card input:focus {
  outline: none;
  border-color: #3370ff;
  box-shadow: 0 0 0 2px rgba(51, 112, 255, 0.12);
}
.password-error {
  margin: 0 0 12px !important;
  color: #d92d20 !important;
  font-size: 13px;
}
.password-card .btn-primary:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.view-title {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  max-width: 1100px;
  margin: 28px auto 12px;
  padding: 0 18px;
}
.view-title h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.view-title small {
  color: #8a9099;
  font-size: 12px;
}
.section-tabs,
.item-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-width: 1100px;
  margin: 0 auto 12px;
  padding: 0 18px;
}
.section-tab,
.item-tab {
  height: 32px;
  padding: 0 12px;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  background: #fff;
  color: #646a73;
  font-size: 13px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.section-tab:hover,
.item-tab:hover {
  border-color: #c9ced6;
  color: #1f2329;
}
.section-tab.active,
.item-tab.active {
  border-color: #3370ff;
  color: #3370ff;
  background: rgba(51, 112, 255, 0.06);
  font-weight: 600;
}
.section-tab .count {
  font-size: 11px;
  color: #8a9099;
}
.table-wrap {
  max-width: 1100px;
  margin: 0 auto 48px;
  padding: 0 18px;
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 16px rgba(15, 23, 42, 0.06);
  font-size: 13px;
  border: 1px solid #eef0f3;
}
th,
td {
  padding: 11px 14px;
  border-bottom: 1px solid #f0f1f3;
  text-align: left;
  white-space: nowrap;
}
th {
  background: #f7f8fa;
  color: #646a73;
  font-weight: 600;
  font-size: 12px;
}
tbody tr:hover td {
  background: #fafbfc;
}
tbody tr:last-child td {
  border-bottom: none;
}
.dashboard-grid {
  max-width: 1100px;
  margin: 0 auto 48px;
  padding: 0 18px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
}
.dashboard-card {
  min-height: 260px;
  background: #fff;
  border: 1px solid #eef0f3;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 16px rgba(15, 23, 42, 0.06);
}
.report-body {
  max-width: 800px;
  margin: 0 auto 48px;
  padding: 24px 22px;
  background: #fff;
  border: 1px solid #eef0f3;
  border-radius: 12px;
  box-shadow: 0 2px 16px rgba(15, 23, 42, 0.06);
  line-height: 1.7;
  font-size: 14px;
}
.report-body :deep(h1),
.report-body :deep(h2),
.report-body :deep(h3) {
  margin: 1.2em 0 0.5em;
}
.report-body :deep(p) {
  margin: 0.6em 0;
}
.report-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
}
.report-body :deep(th),
.report-body :deep(td) {
  border: 1px solid #e5e6eb;
  padding: 8px 10px;
  white-space: normal;
}
.empty {
  padding: 48px 24px;
  color: #8a9099;
  text-align: center;
  font-size: 13px;
}
</style>
