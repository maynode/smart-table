<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { AutomationDto, AutomationRunDto } from '../api/types';

const props = defineProps<{ baseId: string }>();
const emit = defineEmits<{ close: [] }>();

const automations = ref<AutomationDto[]>([]);
const runs = ref<Record<string, AutomationRunDto[]>>({});
const loading = ref(true);
const error = ref('');

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

function formatTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function firstRecordId(run: AutomationRunDto): string {
  const ids = run.steps?.[0]?.output?.recordIds;
  return Array.isArray(ids) && typeof ids[0] === 'string' ? ids[0] : '—';
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

onMounted(load);
</script>

<template>
  <div class="automation-panel" data-testid="automation-panel">
    <header class="panel-header">
      <div>
        <h3>自动化</h3>
        <p class="muted">新增记录时自动查找并修改码库，运行日志实时可见。</p>
      </div>
      <div class="panel-actions">
        <button class="btn small" data-testid="automation-refresh" @click="load">
          刷新
        </button>
        <button class="icon-btn" aria-label="关闭" @click="emit('close')">×</button>
      </div>
    </header>

    <p v-if="loading" class="muted">加载中…</p>
    <p v-else-if="error" class="form-error">{{ error }}</p>
    <p v-else-if="automations.length === 0" class="muted">
      还没有自动化。先运行 <code>pnpm --filter api seed:serial-claim</code> 体验领取流程。
    </p>

    <article
      v-for="automation in automations"
      :key="automation.id"
      class="automation-card"
    >
      <header class="automation-card-head">
        <div>
          <strong>{{ automation.name }}</strong>
          <span class="badge" :class="{ off: !automation.enabled }">
            {{ automation.enabled ? '启用' : '停用' }}
          </span>
        </div>
        <span class="muted small-text">
          {{ triggerLabel(automation) }} ·
          月额度 {{ automation.monthlyQuota ?? '不限' }} ·
          本月已运行 {{ automation.monthlyRunCount ?? 0 }}
        </span>
      </header>

      <table class="automation-runs">
        <thead>
          <tr>
            <th>开始时间</th>
            <th>状态</th>
            <th>耗时</th>
            <th>触发记录</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="run in runs[automation.id] ?? []"
            :key="run.id"
            data-testid="automation-run-row"
            :data-status="run.status"
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
          </tr>
          <tr v-if="(runs[automation.id] ?? []).length === 0">
            <td colspan="4" class="muted">还没有运行记录。</td>
          </tr>
        </tbody>
      </table>
    </article>
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
  align-items: baseline;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.badge {
  margin-left: 8px;
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
.small-text {
  font-size: 12px;
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
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: #667085;
}
.muted {
  color: #667085;
}
</style>
