<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import AutomationEditor from './AutomationEditor.vue';
import type { AutomationDto, AutomationRunDto } from '../api/types';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';

const props = defineProps<{ baseId: string }>();
const emit = defineEmits<{ close: [] }>();

const automations = ref<AutomationDto[]>([]);
const runs = ref<Record<string, AutomationRunDto[]>>({});
const loading = ref(true);
const error = ref('');
const editorOpen = ref(false);
const editing = ref<AutomationDto | null>(null);
const runningId = ref('');
const expandedRunId = ref('');
const runsViewAutomation = ref<AutomationDto | null>(null);
const runsLoading = ref(false);

const statusLabels: Record<string, string> = {
  success: '成功',
  failed: '失败',
  skipped: '跳过',
  running: '运行中',
};

const triggerLabels: Record<string, string> = {
  recordCreated: '新增记录时',
  recordUpdated: '更新记录时',
  schedule: '定时触发',
};

const stepLabels: Record<string, string> = {
  findRecords: '查找记录',
  createRecord: '新增记录',
  modifyRecords: '修改记录',
  sendMessage: '发送消息',
  startGroupChat: '创建群聊',
  addGroupMembers: '添加群成员',
};

const enabledCount = computed(
  () => automations.value.filter((item) => item.enabled).length,
);

function statusLabel(status: string): string {
  return statusLabels[status] ?? status;
}

function triggerLabel(automation: AutomationDto): string {
  return triggerLabels[String(automation.trigger?.type)] ?? '自定义触发';
}

function stepLabel(type: string): string {
  return stepLabels[type] ?? type;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function firstRecordId(run: AutomationRunDto): string {
  const ids = run.steps?.[0]?.output?.recordIds;
  return Array.isArray(ids) && typeof ids[0] === 'string' ? ids[0] : '—';
}

function flowSummary(automation: AutomationDto): string {
  const trigger = triggerLabel(automation);
  const steps = automation.steps
    .slice(0, 3)
    .map((step) =>
      stepLabel(String((step as { type?: unknown }).type ?? '')),
    );
  if (steps.length === 0) return `当${trigger}`;
  return `当${trigger}，就${steps.join('，然后')}${
    automation.steps.length > 3 ? '…' : ''
  }`;
}

function openCreate(): void {
  editing.value = null;
  runsViewAutomation.value = null;
  editorOpen.value = true;
}

function openEdit(automation: AutomationDto): void {
  editing.value = automation;
  runsViewAutomation.value = null;
  editorOpen.value = true;
}

async function openRuns(automation: AutomationDto): Promise<void> {
  runsViewAutomation.value = automation;
  editorOpen.value = false;
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

const activeRuns = computed(() => {
  const automation = runsViewAutomation.value;
  if (!automation) return [] as AutomationRunDto[];
  return runs.value[automation.id] ?? [];
});

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    automations.value = await endpoints.listAutomations(props.baseId);
    const entries = await Promise.all(
      automations.value.map(async (automation) => {
        const list = await endpoints.listAutomationRuns(automation.id, 10);
        return [automation.id, list] as const;
      }),
    );
    runs.value = Object.fromEntries(entries);
  } catch (caught) {
    error.value =
      caught instanceof ApiError ? caught.message : '自动化加载失败';
  } finally {
    loading.value = false;
  }
}

async function toggleEnabled(automation: AutomationDto): Promise<void> {
  try {
    const updated = await endpoints.updateAutomation(automation.id, {
      enabled: !automation.enabled,
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
  const ok = await confirmDialog(
    `删除自动化「${automation.name}」？历史运行记录也会删除。`,
    { title: '删除自动化', confirmLabel: '删除' },
  );
  if (!ok) return;
  try {
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

onMounted(load);
</script>

<template>
  <div class="automation-panel" data-testid="automation-panel">
    <header class="panel-header">
      <div class="panel-title-block">
        <h3>自动化</h3>
        <p class="quota-line">
          用触发条件串起查找、修改与消息，让表格自己干活。
        </p>
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
    />

    <template v-else-if="runsViewAutomation">
      <div class="runs-view" data-testid="automation-runs-panel">
        <div class="runs-view-head">
          <button class="btn ghost small" type="button" data-testid="automation-runs-back" @click="closeRuns">
            ← 返回
          </button>
          <div class="runs-view-title">
            <h4>运行日志</h4>
            <p>{{ runsViewAutomation.name }}</p>
          </div>
          <div class="toolbar-actions">
            <button
              class="btn ghost small"
              type="button"
              :disabled="runningId === runsViewAutomation.id"
              data-testid="automation-run"
              @click="runNow(runsViewAutomation)"
            >
              {{ runningId === runsViewAutomation.id ? '运行中…' : '立即运行' }}
            </button>
            <button class="btn ghost small" type="button" @click="openRuns(runsViewAutomation)">
              刷新
            </button>
          </div>
        </div>

        <p v-if="runsLoading" class="muted runs-empty">加载运行记录…</p>
        <p v-else-if="activeRuns.length === 0" class="muted runs-empty">还没有运行记录</p>

        <div v-else class="runs-list">
          <article
            v-for="run in activeRuns"
            :key="run.id"
            class="run-card"
            :class="{ open: expandedRunId === run.id }"
            data-testid="automation-run-row"
            :data-status="run.status"
          >
            <button class="run-card-head" type="button" @click="toggleRun(run)">
              <span class="run-status" :class="run.status">{{ statusLabel(run.status) }}</span>
              <span class="run-time">{{ formatTime(run.startedAt) }}</span>
              <span class="muted">{{ run.durationMs ?? 0 }} ms</span>
              <span class="mono">记录 {{ firstRecordId(run) }}</span>
              <span class="expand-cell">{{ expandedRunId === run.id ? '收起' : '详情' }}</span>
            </button>
            <p v-if="run.error" class="run-error-line">{{ run.error }}</p>
            <div v-if="expandedRunId === run.id" class="run-steps">
              <div
                v-for="step in run.steps"
                :key="`${run.id}-${step.stepIndex}`"
                class="run-step"
              >
                <span class="run-step-index">{{ step.stepIndex + 1 }}</span>
                <span>{{ stepLabel(step.type) }}</span>
                <span class="run-status" :class="step.status">{{ statusLabel(step.status) }}</span>
                <span class="muted">{{ step.durationMs ?? 0 }} ms</span>
                <span v-if="step.error" class="run-error">{{ step.error }}</span>
                <pre>{{ JSON.stringify(step.output, null, 2) }}</pre>
              </div>
              <p v-if="run.steps.length === 0" class="muted">没有步骤明细。</p>
              <button
                v-if="run.status === 'failed' && runsViewAutomation"
                class="btn ghost small"
                type="button"
                data-testid="automation-run-retry"
                :disabled="runningId === runsViewAutomation.id"
                @click="runNow(runsViewAutomation)"
              >
                重试
              </button>
            </div>
          </article>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="list-toolbar">
        <span class="list-count">
          <template v-if="loading">加载中…</template>
          <template v-else>
            {{ automations.length }} 条自动化流程
            <span v-if="enabledCount" class="count-sep">·</span>
            <span v-if="enabledCount">{{ enabledCount }} 条启用中</span>
          </template>
        </span>
        <div class="toolbar-actions">
          <button class="btn ghost" data-testid="automation-refresh" @click="load">
            刷新
          </button>
          <button
            class="btn btn-primary"
            data-testid="automation-create"
            @click="openCreate"
          >
            新建流程
          </button>
        </div>
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
          class="btn btn-primary"
          data-testid="automation-create-empty"
          @click="openCreate"
        >
          新建流程
        </button>
      </div>

      <article
        v-for="automation in automations"
        :key="automation.id"
        class="automation-card"
        data-testid="automation-card"
      >
        <header class="automation-card-head">
          <div class="automation-title">
            <strong>{{ automation.name }}</strong>
            <span class="badge" :class="{ off: !automation.enabled }">
              {{ automation.enabled ? '启用' : '停用' }}
            </span>
          </div>
          <div class="card-actions">
            <label
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
            <button
              class="btn ghost small"
              data-testid="automation-edit"
              @click="openEdit(automation)"
            >
              编辑
            </button>
            <button
              class="btn ghost small"
              data-testid="automation-runs-open"
              @click="openRuns(automation)"
            >
              运行日志
            </button>
            <button
              class="btn ghost small"
              data-testid="automation-run"
              :disabled="runningId === automation.id"
              @click="runNow(automation)"
            >
              {{ runningId === automation.id ? '运行中…' : '立即运行' }}
            </button>
            <button
              class="icon-btn danger"
              title="删除自动化"
              data-testid="automation-delete"
              @click="remove(automation)"
            >
              ×
            </button>
          </div>
        </header>

        <p class="flow-summary">{{ flowSummary(automation) }}</p>

        <div class="automation-meta">
          <span>月额度 {{ automation.monthlyQuota ?? '不限' }}</span>
          <span>本月已运行 {{ automation.monthlyRunCount ?? 0 }}</span>
          <span v-if="automation.nextRunAt">下次 {{ formatTime(automation.nextRunAt) }}</span>
          <span v-if="automation.lastRunAt">上次 {{ formatTime(automation.lastRunAt) }}</span>
          <span>{{ automation.steps.length }} 个步骤</span>
          <button class="meta-link" type="button" @click="openRuns(automation)">
            查看 {{ (runs[automation.id] ?? []).length }} 条近期运行 →
          </button>
        </div>
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
.count-sep {
  margin: 0 4px;
  color: #c0c4cc;
}
.toolbar-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.btn.ghost {
  background: #fff;
  border: 1px solid #dee0e3;
  color: #1f2329;
}
.btn.ghost:hover {
  background: #f5f6f7;
}
.btn.ghost.small {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
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
  gap: 0;
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
  border-radius: 10px;
  padding: 14px 16px;
  margin: 0 4px 12px;
  background: #fff;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.automation-card:hover {
  border-color: #c9cdd4;
  box-shadow: 0 4px 16px rgba(31, 35, 41, 0.06);
}
.automation-card-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.automation-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.automation-title strong {
  font-size: 15px;
  color: #1f2329;
}
.card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.flow-summary {
  margin: 10px 0 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f7f8fa;
  color: #4e5969;
  font-size: 13px;
  line-height: 1.55;
}
.automation-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  color: #8f959e;
  font-size: 12px;
  align-items: center;
}
.meta-link {
  margin-left: auto;
  padding: 0;
  border: none;
  background: transparent;
  color: #1d6fdc;
  font-size: 12px;
  cursor: pointer;
}
.badge {
  font-size: 11px;
  color: #067647;
  background: #ecfdf3;
  border-radius: 999px;
  padding: 2px 8px;
}
.badge.off {
  color: #667085;
  background: #f2f4f7;
}
.switch {
  position: relative;
  display: inline-flex;
  width: 34px;
  height: 20px;
}
.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.switch span {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: #d0d5dd;
  cursor: pointer;
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
  align-items: center;
  gap: 12px;
}
.runs-view-title {
  flex: 1;
  min-width: 0;
}
.runs-view-title h4 {
  margin: 0;
  font-size: 16px;
  color: #1f2329;
}
.runs-view-title p {
  margin: 2px 0 0;
  font-size: 12px;
  color: #8f959e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.runs-empty {
  padding: 32px;
  text-align: center;
}
.runs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.run-card {
  border: 1px solid #e5e6eb;
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
}
.run-card.open {
  border-color: #c7d7f5;
}
.run-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  width: 100%;
  padding: 12px 14px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: #4e5969;
}
.run-card-head:hover {
  background: #f7f8fa;
}
.run-time {
  color: #1f2329;
  font-size: 13px;
}
.expand-cell {
  margin-left: auto;
  color: #2d8cf0;
  white-space: nowrap;
  font-size: 12px;
}
.run-error-line {
  margin: 0;
  padding: 0 14px 10px;
  color: #b42318;
  font-size: 12px;
}
.run-status {
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
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
.run-steps {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 0 14px 14px;
  border-top: 1px solid #f2f4f7;
  background: #fafbfc;
}
.run-step {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  padding-top: 10px;
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
.run-step pre {
  flex-basis: 100%;
  max-height: 180px;
  overflow: auto;
  margin: 2px 0 0;
  padding: 8px;
  border-radius: 6px;
  background: #1f2329;
  color: #d1e9ff;
  font-size: 10px;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: #667085;
}
.icon-btn.danger {
  color: #8f959e;
}
.icon-btn.danger:hover {
  color: #d4380d;
  background: #fff1f0;
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
