<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import AutomationEditor from './AutomationEditor.vue';
import type { AutomationDto, AutomationRunDto } from '../api/types';
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

function statusLabel(status: string): string {
  return statusLabels[status] ?? status;
}

function triggerLabel(automation: AutomationDto): string {
  return triggerLabels[String(automation.trigger?.type)] ?? '自定义触发';
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function firstRecordId(run: AutomationRunDto): string {
  const ids = run.steps?.[0]?.output?.recordIds;
  return Array.isArray(ids) && typeof ids[0] === 'string' ? ids[0] : '—';
}

function openCreate(): void {
  editing.value = null;
  editorOpen.value = true;
}

function openEdit(automation: AutomationDto): void {
  editing.value = automation;
  editorOpen.value = true;
}

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
  } catch (caught) {
    toast(caught instanceof ApiError ? caught.message : '运行失败');
  } finally {
    runningId.value = '';
  }
}

async function remove(automation: AutomationDto): Promise<void> {
  if (!window.confirm(`删除自动化「${automation.name}」？历史运行记录也会删除。`)) {
    return;
  }
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
      <div>
        <h3>自动化</h3>
        <p class="muted">新增/更新记录或定时触发，执行查找、修改、发消息和群聊操作。</p>
      </div>
      <div class="panel-actions">
        <button class="btn small" data-testid="automation-refresh" @click="load">
          刷新
        </button>
        <button
          class="btn btn-primary small"
          data-testid="automation-create"
          @click="openCreate"
        >
          + 新建自动化
        </button>
        <button class="icon-btn" aria-label="关闭" @click="emit('close')">×</button>
      </div>
    </header>

    <AutomationEditor
      v-if="editorOpen"
      :base-id="baseId"
      :automation="editing"
      @close="editorOpen = false"
      @saved="onSaved"
    />

    <template v-else>
      <p v-if="loading" class="muted">加载中…</p>
      <p v-else-if="error" class="form-error">{{ error }}</p>
      <div v-else-if="automations.length === 0" class="empty-automations">
        <p>还没有自动化。</p>
        <p class="muted">点击右上角「新建自动化」创建，或运行 seed 体验序列号领取流程。</p>
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
            <button class="btn small" data-testid="automation-edit" @click="openEdit(automation)">
              编辑
            </button>
            <button
              class="btn small"
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
              🗑
            </button>
          </div>
        </header>
        <div class="automation-meta">
          <span>{{ triggerLabel(automation) }}</span>
          <span>月额度 {{ automation.monthlyQuota ?? '不限' }}</span>
          <span>本月已运行 {{ automation.monthlyRunCount ?? 0 }}</span>
          <span v-if="automation.nextRunAt">下次 {{ formatTime(automation.nextRunAt) }}</span>
          <span v-if="automation.lastRunAt">上次 {{ formatTime(automation.lastRunAt) }}</span>
          <span>{{ automation.steps.length }} 个步骤</span>
        </div>

        <table class="automation-runs">
          <thead>
            <tr>
              <th>开始时间</th>
              <th>状态</th>
              <th>耗时</th>
              <th>触发记录</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="run in runs[automation.id] ?? []" :key="run.id">
              <tr
                data-testid="automation-run-row"
                :data-status="run.status"
                @click="toggleRun(run)"
              >
                <td>{{ formatTime(run.startedAt) }}</td>
                <td>
                  <span class="run-status" :class="run.status">
                    {{ statusLabel(run.status) }}
                  </span>
                  <span v-if="run.error" class="run-error">{{ run.error }}</span>
                </td>
                <td>{{ run.durationMs ?? 0 }} ms</td>
                <td class="mono">{{ firstRecordId(run) }}</td>
                <td class="mono">{{ expandedRunId === run.id ? '收起' : '展开' }}</td>
              </tr>
              <tr v-if="expandedRunId === run.id" class="run-detail-row">
                <td colspan="5">
                  <div class="run-steps">
                    <div
                      v-for="step in run.steps"
                      :key="`${run.id}-${step.stepIndex}`"
                      class="run-step"
                    >
                      <span class="run-step-index">{{ step.stepIndex + 1 }}</span>
                      <span>{{ step.type }}</span>
                      <span class="run-status" :class="step.status">{{ statusLabel(step.status) }}</span>
                      <span class="muted">{{ step.durationMs ?? 0 }} ms</span>
                      <span v-if="step.error" class="run-error">{{ step.error }}</span>
                      <pre>{{ JSON.stringify(step.output, null, 2) }}</pre>
                    </div>
                    <p v-if="run.steps.length === 0" class="muted">没有步骤明细。</p>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="(runs[automation.id] ?? []).length === 0">
              <td colspan="5" class="muted">还没有运行记录。</td>
            </tr>
          </tbody>
        </table>
      </article>
    </template>
  </div>
</template>

<style scoped>
.automation-panel {
  padding: 4px 2px;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
}
.panel-header h3 {
  margin: 0 0 4px;
}
.panel-header p {
  margin: 0;
  font-size: 12px;
}
.panel-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.automation-card {
  border: 1px solid #eaecf0;
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 14px;
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
.card-actions {
  display: flex;
  align-items: center;
  gap: 7px;
}
.automation-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 9px 0;
  color: #667085;
  font-size: 11px;
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
  background: #12b76a;
}
.switch input:checked + span::after {
  transform: translateX(14px);
}
.automation-runs {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.automation-runs th {
  text-align: left;
  color: #667085;
  font-weight: 500;
  padding: 6px 8px;
  border-bottom: 1px solid #eaecf0;
}
.automation-runs td {
  padding: 7px 8px;
  border-bottom: 1px solid #f2f4f7;
  vertical-align: top;
}
.automation-runs tbody tr:not(.run-detail-row) {
  cursor: pointer;
}
.automation-runs tbody tr:not(.run-detail-row):hover {
  background: #f8fafc;
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
.run-detail-row td {
  background: #fafbfc;
}
.run-steps {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 4px 0;
}
.run-step {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.run-step-index {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #eef4ff;
  color: #1d6fdc;
}
.run-step pre {
  flex-basis: 100%;
  max-height: 180px;
  overflow: auto;
  margin: 2px 0 0;
  padding: 8px;
  border-radius: 6px;
  background: #101828;
  color: #d1e9ff;
  font-size: 10px;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: #667085;
}
.empty-automations {
  padding: 30px;
  text-align: center;
  color: #475467;
}
.empty-automations p {
  margin: 4px;
}
.icon-btn.danger {
  color: #d4380d;
}
.muted {
  color: #667085;
}
</style>
