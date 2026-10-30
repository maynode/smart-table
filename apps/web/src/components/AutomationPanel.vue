<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { liveBus } from '../sync/live-bus';
import AutomationEditor from './AutomationEditor.vue';
import type {
  AutomationDto,
  AutomationRunDto,
  SheetDto,
} from '../api/types';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';

const props = withDefaults(
  defineProps<{ baseId: string; editable?: boolean }>(),
  { editable: true },
);
const emit = defineEmits<{ close: [] }>();

const automations = ref<AutomationDto[]>([]);
const sheets = ref<SheetDto[]>([]);
const runs = ref<Record<string, AutomationRunDto[]>>({});
const loading = ref(true);
const error = ref('');
const editorOpen = ref(false);
const editing = ref<AutomationDto | null>(null);
const runningId = ref('');
const expandedRunId = ref('');
const runsViewAutomation = ref<AutomationDto | null>(null);
const runsLoading = ref(false);
const menuOpenId = ref('');
const runStatusFilter = ref<'all' | 'success' | 'failed'>('all');
const runDateFrom = ref('');
const runDateTo = ref('');

const statusLabels: Record<string, string> = {
  success: '运行成功',
  failed: '运行失败',
  skipped: '已跳过',
  running: '运行中',
};

const triggerLabels: Record<string, string> = {
  recordCreated: '添加新记录时',
  recordUpdated: '更新记录时',
  schedule: '定时触发',
};

const stepLabels: Record<string, string> = {
  findRecords: '查找记录',
  createRecord: '新增记录',
  modifyRecords: '修改记录',
  sendMessage: '发送消息',
};

const enabledCount = computed(
  () => automations.value.filter((item) => item.enabled).length,
);

const filteredRuns = computed(() => {
  const automation = runsViewAutomation.value;
  if (!automation) return [] as AutomationRunDto[];
  let list = runs.value[automation.id] ?? [];
  if (runStatusFilter.value !== 'all') {
    list = list.filter((run) => run.status === runStatusFilter.value);
  }
  if (runDateFrom.value) {
    const from = new Date(runDateFrom.value).getTime();
    list = list.filter((run) => new Date(run.startedAt).getTime() >= from);
  }
  if (runDateTo.value) {
    const to = new Date(runDateTo.value);
    to.setHours(23, 59, 59, 999);
    list = list.filter((run) => new Date(run.startedAt).getTime() <= to.getTime());
  }
  return list;
});

function statusLabel(status: string): string {
  return statusLabels[status] ?? status;
}

function stepLabel(type: string): string {
  return stepLabels[type] ?? type;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatDuration(ms: number | null | undefined): string {
  const value = ms ?? 0;
  return `${(value / 1000).toFixed(1)} 秒`;
}

function sheetName(sheetId: unknown): string {
  if (typeof sheetId !== 'string' || !sheetId) return '工作表';
  return sheets.value.find((sheet) => sheet.id === sheetId)?.name ?? '工作表';
}

type SummaryPart =
  | { kind: 'text'; value: string }
  | { kind: 'pill'; value: string };

function flowParts(automation: AutomationDto): SummaryPart[] {
  const trigger = automation.trigger as Record<string, unknown>;
  const type = String(trigger.type ?? 'recordCreated');
  const parts: SummaryPart[] = [{ kind: 'text', value: '当' }];
  if (type === 'schedule') {
    parts.push({ kind: 'pill', value: '定时触发' });
  } else {
    parts.push({ kind: 'pill', value: sheetName(trigger.sheetId) });
    parts.push({ kind: 'text', value: '里' });
    parts.push({
      kind: 'pill',
      value: triggerLabels[type] ?? '触发时',
    });
  }
  const steps = automation.steps as Array<Record<string, unknown>>;
  steps.slice(0, 3).forEach((step, index) => {
    const stepType = String(step.type ?? '');
    parts.push({
      kind: 'text',
      value: index === 0 ? '，就在' : '，然后在',
    });
    if (stepType === 'findRecords' || stepType === 'createRecord') {
      parts.push({ kind: 'pill', value: sheetName(step.sheetId) });
      parts.push({ kind: 'text', value: '里' });
      parts.push({ kind: 'pill', value: stepLabel(stepType) });
    } else if (stepType === 'modifyRecords') {
      parts.push({ kind: 'pill', value: sheetName(step.sheetId) });
      parts.push({ kind: 'text', value: '里' });
      parts.push({ kind: 'pill', value: '修改记录' });
    } else if (stepType === 'sendMessage') {
      parts.push({ kind: 'pill', value: '发送消息' });
    } else {
      parts.push({ kind: 'pill', value: stepLabel(stepType) });
    }
  });
  if (steps.length > 3) parts.push({ kind: 'text', value: '…' });
  return parts;
}

function openCreate(): void {
  if (!props.editable) {
    toast('当前为只读权限，无法新建流程');
    return;
  }
  editing.value = null;
  runsViewAutomation.value = null;
  menuOpenId.value = '';
  editorOpen.value = true;
}

function openEdit(automation: AutomationDto): void {
  if (!props.editable) {
    void openRuns(automation);
    return;
  }
  editing.value = automation;
  runsViewAutomation.value = null;
  menuOpenId.value = '';
  editorOpen.value = true;
}

async function openRuns(automation: AutomationDto): Promise<void> {
  runsViewAutomation.value = automation;
  editorOpen.value = false;
  menuOpenId.value = '';
  expandedRunId.value = '';
  runsLoading.value = true;
  try {
    const list = await endpoints.listAutomationRuns(automation.id, 50);
    runs.value = { ...runs.value, [automation.id]: list };
  } catch (caught) {
    toast(caught instanceof ApiError ? caught.message : '运行日志加载失败');
  } finally {
    runsLoading.value = false;
  }
}

function closeRuns(): void {
  runsViewAutomation.value = null;
  expandedRunId.value = '';
}

function toggleMenu(id: string): void {
  menuOpenId.value = menuOpenId.value === id ? '' : id;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  const cacheKey = `automations:${props.baseId}`;
  try {
    const [list, sheetList] = await Promise.all([
      endpoints.listAutomations(props.baseId),
      endpoints.listSheets(props.baseId),
    ]);
    automations.value = list;
    sheets.value = sheetList;
    const entries = await Promise.all(
      automations.value.map(async (automation) => {
        const runList = await endpoints.listAutomationRuns(automation.id, 10);
        return [automation.id, runList] as const;
      }),
    );
    runs.value = Object.fromEntries(entries);
    const { localDb } = await import('../sync/local-db-client');
    void localDb.putObjectCache(cacheKey, 'automation', {
      list,
      sheets: sheetList,
      runs: runs.value,
    });
  } catch (caught) {
    try {
      const { localDb } = await import('../sync/local-db-client');
      const cached = (await localDb.getObjectCache(cacheKey)) as {
        list?: typeof automations.value;
        sheets?: typeof sheets.value;
        runs?: typeof runs.value;
      } | null;
      if (cached?.list) {
        automations.value = cached.list;
        sheets.value = cached.sheets ?? [];
        runs.value = cached.runs ?? {};
        error.value = '';
        toast('已从离线缓存打开自动化');
      } else {
        error.value =
          caught instanceof ApiError ? caught.message : '自动化加载失败';
      }
    } catch {
      error.value =
        caught instanceof ApiError ? caught.message : '自动化加载失败';
    }
  } finally {
    loading.value = false;
  }
}

async function toggleEnabled(
  automation: AutomationDto,
  event?: Event,
): Promise<void> {
  if (!props.editable) return;
  // Prefer the checkbox's post-click state — label clicks can re-enter with a
  // stale closure if we only flip `!automation.enabled`.
  const target = event?.target as HTMLInputElement | undefined;
  const nextEnabled =
    target && typeof target.checked === 'boolean'
      ? target.checked
      : !automation.enabled;
  try {
    if (!navigator.onLine) {
      const { enqueueObjectMutation } = await import('../sync/object-outbox');
      automations.value = automations.value.map((item) =>
        item.id === automation.id ? { ...item, enabled: nextEnabled } : item,
      );
      await enqueueObjectMutation({
        type: 'automation.toggle',
        automationId: automation.id,
        enabled: nextEnabled,
      });
      toast(nextEnabled ? '离线已启用，联网后同步' : '离线已停用，联网后同步');
      return;
    }
    const updated = await endpoints.updateAutomation(automation.id, {
      enabled: nextEnabled,
    });
    automations.value = automations.value.map((item) =>
      item.id === updated.id ? updated : item,
    );
    toast(updated.enabled ? '自动化已启用' : '自动化已停用');
  } catch (caught) {
    toast(caught instanceof ApiError ? caught.message : '操作失败');
  }
}

async function runNow(automation: AutomationDto): Promise<void> {
  if (!props.editable) {
    toast('当前为只读权限，无法运行');
    return;
  }
  const { offlineDecision, offlineBlockMessage } = await import(
    '../sync/offline-capability'
  );
  if (offlineDecision('automation.run') === 'block') {
    toast(offlineBlockMessage('automation.run'));
    return;
  }
  runningId.value = automation.id;
  try {
    const result = await endpoints.runAutomation(automation.id);
    toast(`运行${statusLabel(result.status)}`);
    await load();
    if (runsViewAutomation.value?.id === automation.id) {
      await openRuns(automation);
    }
  } catch (caught) {
    toast(caught instanceof ApiError ? caught.message : '运行失败');
  } finally {
    runningId.value = '';
  }
}

async function remove(automation: AutomationDto): Promise<void> {
  menuOpenId.value = '';
  if (!props.editable) return;
  const ok = await confirmDialog(
    `删除自动化「${automation.name}」？历史运行记录也会删除。`,
    { title: '删除自动化', confirmLabel: '删除' },
  );
  if (!ok) return;
  try {
    if (!navigator.onLine) {
      const { enqueueObjectMutation } = await import('../sync/object-outbox');
      automations.value = automations.value.filter(
        (item) => item.id !== automation.id,
      );
      await enqueueObjectMutation({
        type: 'automation.delete',
        automationId: automation.id,
      });
      toast('离线已删除，联网后同步');
      return;
    }
    await endpoints.deleteAutomation(automation.id);
    automations.value = automations.value.filter(
      (item) => item.id !== automation.id,
    );
    toast('自动化已删除');
  } catch (caught) {
    toast(caught instanceof ApiError ? caught.message : '删除失败');
  }
}

function toggleRun(run: AutomationRunDto): void {
  expandedRunId.value = expandedRunId.value === run.id ? '' : run.id;
}

async function onSaved(): Promise<void> {
  editorOpen.value = false;
  editing.value = null;
  await load();
  toast('自动化已保存');
}

function onEditorOpenRuns(): void {
  const target = editing.value;
  editorOpen.value = false;
  if (target) void openRuns(target);
}

const liveUnsubs: Array<() => void> = [];

async function onAutomationLive(): Promise<void> {
  await load();
  const viewing = runsViewAutomation.value;
  if (viewing) {
    const next = automations.value.find((item) => item.id === viewing.id);
    if (next) await openRuns(next);
  }
}

onMounted(() => {
  void load();
  liveUnsubs.push(liveBus.on('automation.*', onAutomationLive));
});

onBeforeUnmount(() => {
  while (liveUnsubs.length) liveUnsubs.pop()?.();
});
</script>

<template>
  <div class="automation-panel" data-testid="automation-panel" @click="menuOpenId = ''">
    <header v-if="!editorOpen" class="panel-header">
      <div class="panel-title-block">
        <h3>{{ runsViewAutomation ? '运行详情' : '自动化' }}</h3>
        <p v-if="runsViewAutomation" class="quota-line">{{ runsViewAutomation.name }}</p>
      </div>
      <button class="icon-btn close-btn" aria-label="关闭" @click="emit('close')">
        ×
      </button>
    </header>

    <AutomationEditor
      v-if="editorOpen"
      :base-id="baseId"
      :automation="editing"
      @close="editorOpen = false"
      @saved="onSaved"
      @open-runs="onEditorOpenRuns"
    />

    <template v-else-if="runsViewAutomation">
      <div class="runs-view" data-testid="automation-runs-panel">
        <div class="runs-view-head">
          <button
            class="btn ghost small"
            type="button"
            data-testid="automation-runs-back"
            @click="closeRuns"
          >
            ← 返回
          </button>
          <div class="runs-filters">
            <input v-model="runDateFrom" type="date" class="filter-input" />
            <span class="muted">—</span>
            <input v-model="runDateTo" type="date" class="filter-input" />
            <select v-model="runStatusFilter" class="filter-input" data-testid="runs-status-filter">
              <option value="all">全部状态</option>
              <option value="success">运行成功</option>
              <option value="failed">运行失败</option>
            </select>
            <button
              v-if="editable"
              class="btn ghost small"
              type="button"
              data-testid="automation-run"
              :disabled="runningId === runsViewAutomation.id"
              @click="runNow(runsViewAutomation)"
            >
              {{ runningId === runsViewAutomation.id ? '运行中…' : '立即运行' }}
            </button>
            <button
              class="icon-btn"
              type="button"
              title="刷新"
              @click="openRuns(runsViewAutomation)"
            >
              ↻
            </button>
          </div>
        </div>

        <p v-if="runsLoading" class="muted runs-empty">加载运行记录…</p>
        <p v-else-if="filteredRuns.length === 0" class="muted runs-empty">还没有运行记录</p>

        <table v-else class="runs-table">
          <thead>
            <tr>
              <th>日志产生时间</th>
              <th>运行状态</th>
              <th>运行耗时</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="run in filteredRuns" :key="run.id">
              <tr data-testid="automation-run-row" :data-status="run.status">
                <td>{{ formatTime(run.startedAt) }}</td>
                <td>
                  <span class="run-status" :class="run.status">
                    {{ statusLabel(run.status) }}
                  </span>
                  <button
                    v-if="run.status === 'failed'"
                    class="link-btn"
                    type="button"
                    data-testid="automation-run-retry"
                    :disabled="runningId === runsViewAutomation.id"
                    @click="runNow(runsViewAutomation)"
                  >
                    重试
                  </button>
                  <div
                    v-if="run.status === 'failed' && run.error && expandedRunId !== run.id"
                    class="run-error-inline"
                    :title="run.error"
                  >
                    {{ run.error }}
                  </div>
                </td>
                <td>{{ formatDuration(run.durationMs) }}</td>
                <td>
                  <button class="link-btn" type="button" @click="toggleRun(run)">
                    {{ expandedRunId === run.id ? '收起' : '详情' }}
                  </button>
                </td>
              </tr>
              <tr v-if="expandedRunId === run.id" class="run-detail-row">
                <td colspan="4">
                  <div v-if="run.error" class="run-error-line">{{ run.error }}</div>
                  <div
                    v-for="step in run.steps"
                    :key="`${run.id}-${step.stepIndex}`"
                    class="run-step"
                  >
                    <span class="run-step-index">{{ step.stepIndex + 1 }}</span>
                    <span>{{ stepLabel(step.type) }}</span>
                    <span class="run-status" :class="step.status">
                      {{ statusLabel(step.status) }}
                    </span>
                    <span class="muted">{{ formatDuration(step.durationMs) }}</span>
                    <span v-if="step.error" class="run-error">{{ step.error }}</span>
                  </div>
                  <p v-if="run.steps.length === 0" class="muted">没有步骤明细。</p>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <div class="list-toolbar">
        <span class="list-count">
          <template v-if="loading">
            <span class="page-loading page-loading-inline" style="padding: 0">
              <span class="page-loading-spinner" aria-hidden="true" />
              加载中…
            </span>
          </template>
          <template v-else>
            {{ automations.length }} 条自动化流程，{{ enabledCount }} 条运行中
          </template>
        </span>
        <button
          v-if="editable"
          class="btn btn-primary"
          data-testid="automation-create"
          @click="openCreate"
        >
          新建流程
        </button>
      </div>

      <p v-if="error" class="form-error">{{ error }}</p>

      <div v-else-if="!loading && automations.length === 0" class="empty-state">
        <div class="empty-visual" aria-hidden="true">
          <span class="empty-node">触</span>
          <span class="empty-line"></span>
          <span class="empty-node mid">查</span>
          <span class="empty-line"></span>
          <span class="empty-node">改</span>
        </div>
        <h4>还没有自动化流程</h4>
        <p>例如：表单提交后自动改状态、发消息提醒相关人。</p>
        <button
          v-if="editable"
          class="btn btn-primary"
          data-testid="automation-create-empty"
          @click="openCreate"
        >
          新建流程
        </button>
        <p v-else class="muted">当前为只读，无法新建流程。</p>
      </div>

      <article
        v-for="automation in automations"
        :key="automation.id"
        class="automation-card"
        data-testid="automation-card"
        @click="openEdit(automation)"
      >
        <header class="automation-card-head" @click.stop>
          <strong class="card-name" @click="openEdit(automation)">
            {{ automation.name }}
          </strong>
          <div class="card-actions">
            <label
              v-if="editable"
              class="switch"
              :title="automation.enabled ? '停用' : '启用'"
              data-testid="automation-toggle"
            >
              <input
                type="checkbox"
                :checked="automation.enabled"
                data-testid="automation-toggle-input"
                @change="toggleEnabled(automation)"
              />
              <span></span>
            </label>
            <span v-else class="muted">{{ automation.enabled ? '运行中' : '已停用' }}</span>
            <div class="more-wrap">
              <button
                class="icon-btn"
                type="button"
                title="更多"
                aria-label="更多操作"
                data-testid="automation-more"
                @click="toggleMenu(automation.id)"
              >
                ···
              </button>
              <Transition name="menu-fade">
                <div
                  v-if="menuOpenId === automation.id"
                  class="more-menu"
                  @click.stop
                >
                  <button
                    v-if="editable"
                    type="button"
                    data-testid="automation-edit"
                    @click="openEdit(automation)"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    data-testid="automation-runs-open"
                    @click="openRuns(automation)"
                  >
                    运行日志
                  </button>
                  <button
                    v-if="editable"
                    type="button"
                    data-testid="automation-run"
                    :disabled="runningId === automation.id"
                    @click="runNow(automation)"
                  >
                    {{ runningId === automation.id ? '运行中…' : '立即运行' }}
                  </button>
                  <button
                    v-if="editable"
                    type="button"
                    class="danger"
                    data-testid="automation-delete"
                    @click="remove(automation)"
                  >
                    删除
                  </button>
                </div>
              </Transition>
            </div>
          </div>
        </header>

        <p class="flow-summary">
          <template v-for="(part, index) in flowParts(automation)" :key="index">
            <span v-if="part.kind === 'text'">{{ part.value }}</span>
            <span v-else class="flow-pill">{{ part.value }}</span>
          </template>
        </p>
      </article>
    </template>
  </div>
</template>

<style scoped>
.automation-panel {
  display: flex;
  flex-direction: column;
  min-height: 420px;
  padding: 4px 4px 12px;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 4px 4px 12px;
  border-bottom: 1px solid #eef0f3;
}
.panel-title-block h3 {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #1f2329;
}
.quota-line {
  margin: 0;
  font-size: 13px;
  color: #8f959e;
  line-height: 1.45;
}
.close-btn {
  width: 32px;
  height: 32px;
  font-size: 20px;
  color: #8f959e;
  border-radius: 8px;
}
.close-btn:hover {
  background: #f5f6f7;
  color: #1f2329;
}
.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 4px 12px;
}
.list-count {
  font-size: 13px;
  color: #646a73;
}
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 24px 56px;
  margin: 8px 4px 0;
  border: 1px dashed #e5e6eb;
  border-radius: 12px;
  background: linear-gradient(180deg, #fafbfc 0%, #fff 70%);
  text-align: center;
}
.empty-visual {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}
.empty-node {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #e8f3ff;
  color: #1d6fdc;
  font-size: 13px;
  font-weight: 600;
}
.empty-node.mid {
  background: #fff7e6;
  color: #d46b08;
}
.empty-line {
  width: 28px;
  height: 2px;
  background: #d0d3d9;
}
.empty-state h4 {
  margin: 4px 0 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2329;
}
.empty-state p {
  margin: 0 0 12px;
  max-width: 360px;
  font-size: 13px;
  color: #8f959e;
  line-height: 1.5;
}
.automation-card {
  border: 1px solid #e5e6eb;
  border-radius: 12px;
  padding: 14px 16px;
  margin: 0 4px 12px;
  background: #fff;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    background 0.15s ease;
}
.automation-card:hover {
  border-color: #91caff;
  box-shadow: 0 4px 16px rgba(31, 35, 41, 0.06);
}
.automation-card:focus-within {
  border-color: #91caff;
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.18);
}
.automation-card-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}
.card-name {
  font-size: 15px;
  font-weight: 600;
  color: #1f2329;
  cursor: pointer;
}
.card-name:hover {
  color: #1d6fdc;
}
.card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.flow-summary {
  margin: 10px 0 0;
  color: #4e5969;
  font-size: 13px;
  line-height: 1.7;
}
.flow-pill {
  display: inline-flex;
  align-items: center;
  margin: 0 2px;
  padding: 1px 8px;
  border: 1px solid #e5e6eb;
  border-radius: 6px;
  background: #fff;
  color: #1f2329;
  font-size: 12px;
  vertical-align: baseline;
}
.more-wrap {
  position: relative;
}
.more-menu {
  position: absolute;
  top: 28px;
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 120px;
  padding: 4px;
  border: 1px solid #eaecf0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
}
.more-menu button {
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  font-size: 13px;
  cursor: pointer;
}
.more-menu button:hover {
  background: #f5f8ff;
}
.more-menu button.danger {
  color: #d4380d;
}
.switch {
  position: relative;
  display: inline-flex;
  width: 34px;
  height: 20px;
  flex-shrink: 0;
}
/* 原生 checkbox 铺满开关区域（透明），保证可点、可测、可聚焦 */
.switch input {
  position: absolute;
  inset: 0;
  z-index: 1;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.switch span {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: #d0d5dd;
  pointer-events: none;
  transition: background 0.15s;
}
.switch span::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s;
}
.switch input:checked + span {
  background: #2d8cf0;
}
.switch input:checked + span::after {
  transform: translateX(14px);
}
.runs-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 4px 0;
}
.runs-view-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.runs-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex: 1;
}
.filter-input {
  height: 30px;
  padding: 0 8px;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
  font-size: 12px;
  background: #fff;
}
.runs-empty {
  padding: 40px 24px;
  text-align: center;
  border: 1px dashed #e5e6eb;
  border-radius: 10px;
  background: #fafbfc;
  color: #8f959e;
  font-size: 13px;
}
.runs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.runs-table th,
.runs-table td {
  padding: 12px 10px;
  border-bottom: 1px solid #eef0f3;
  text-align: left;
  vertical-align: middle;
}
.runs-table th {
  color: #8f959e;
  font-weight: 500;
  background: #fafbfc;
}
.runs-table tbody tr:hover td {
  background: #f7faff;
}
.run-detail-row td {
  background: #fafbfc;
  padding-top: 4px;
  padding-bottom: 12px;
}
.link-btn {
  margin-left: 8px;
  padding: 0;
  border: none;
  background: transparent;
  color: #1d6fdc;
  font-size: 13px;
  cursor: pointer;
}
.run-error-line {
  margin: 0 0 8px;
  color: #b42318;
  font-size: 12px;
}
.run-error-inline {
  margin-top: 4px;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #b42318;
  font-size: 12px;
  line-height: 1.4;
}
.run-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
  background: #f2f4f7;
}
.run-status.success {
  color: #067647;
  background: #ecfdf3;
}
.run-status.failed {
  color: #b42318;
  background: #fef3f2;
}
.run-status.skipped {
  color: #b54708;
  background: #fffaeb;
}
.run-error {
  margin-left: 6px;
  color: #b42318;
}
.run-step {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 6px 0;
}
.run-step-index {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e8f3ff;
  color: #1d6fdc;
}
.btn.ghost {
  background: #fff;
  border: 1px solid #dee0e3;
  color: #1f2329;
}
.btn.ghost.small {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}
.muted {
  color: #8f959e;
}
.form-error {
  margin: 12px 4px;
  color: #d92d20;
  font-size: 13px;
}
</style>
