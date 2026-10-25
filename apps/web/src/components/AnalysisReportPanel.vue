<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import { confirmDialog, promptDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import { renderSimpleMarkdown } from '../ui/simple-markdown';
import type {
  AnalysisReportDto,
  AnalysisReportListItemDto,
  SheetDto,
} from '../api/types';

const props = defineProps<{
  baseId: string;
  sheets: SheetDto[];
  /** 从壳层新建时传入，直接打开该报告 */
  reportId?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const list = ref<AnalysisReportListItemDto[]>([]);
const active = ref<AnalysisReportDto | null>(null);
const loading = ref(false);
const submitting = ref(false);
const selectedOption = ref('');
const otherText = ref('');
const chatEnd = ref<HTMLElement | null>(null);

const busy = computed(() =>
  ['exploring', 'generating'].includes(active.value?.status ?? ''),
);

const reportHtml = computed(() => {
  const md = active.value?.reportMarkdown;
  if (!md) return '';
  return renderSimpleMarkdown(md);
});

const lastChoice = computed(() => {
  const messages = active.value?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.kind === 'choice' && msg.options?.length) {
      return msg;
    }
  }
  return null;
});

const showConfirmBar = computed(() => {
  if (!active.value) return false;
  if (active.value.status !== 'asking') return false;
  return true;
});

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : '网络错误';
}

const STATUS_LABELS: Record<string, string> = {
  asking: '待确认',
  exploring: '分析中',
  generating: '生成中',
  ready: '已完成',
  failed: '失败',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

async function scrollChat(): Promise<void> {
  await nextTick();
  chatEnd.value?.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

async function loadList(): Promise<void> {
  list.value = await endpoints.listAnalysisReports(props.baseId);
}

async function openReport(id: string): Promise<void> {
  loading.value = true;
  try {
    active.value = await endpoints.getAnalysisReport(id);
    selectedOption.value = '';
    otherText.value = '';
    await scrollChat();
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

async function startNew(): Promise<void> {
  const name = (await promptDialog('新分析报告名称', '分析报告'))?.trim();
  if (!name) return;
  loading.value = true;
  try {
    active.value = await endpoints.createAnalysisReport(props.baseId, name);
    await loadList();
    selectedOption.value = '';
    otherText.value = '';
    await scrollChat();
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

async function submitAnswer(skip = false): Promise<void> {
  if (!active.value || submitting.value) return;
  submitting.value = true;
  try {
    const body: { optionId?: string; text?: string; skip?: boolean } = {};
    if (skip) {
      body.skip = true;
    } else if (selectedOption.value === 'other') {
      body.optionId = 'other';
      body.text = otherText.value.trim() || undefined;
    } else if (selectedOption.value) {
      body.optionId = selectedOption.value;
    } else if ((active.value.sheetIds ?? []).length > 0) {
      // single-sheet preselected — confirm
      body.skip = false;
      body.optionId = `sheet:${active.value.sheetIds[0]}`;
    } else {
      body.skip = true;
    }
    active.value = await endpoints.answerAnalysisReport(active.value.id, body);
    await loadList();
    selectedOption.value = '';
    otherText.value = '';
    await scrollChat();
  } catch (error) {
    toast(messageOf(error));
  } finally {
    submitting.value = false;
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function stopPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPollIfBusy(): void {
  stopPoll();
  if (!busy.value || !active.value) return;
  const id = active.value.id;
  pollTimer = setInterval(() => {
    void (async () => {
      if (!active.value || active.value.id !== id) {
        stopPoll();
        return;
      }
      try {
        active.value = await endpoints.getAnalysisReport(id);
        await loadList();
        if (!busy.value) {
          stopPoll();
          if (active.value.status === 'ready') await scrollChat();
          if (active.value.status === 'failed') {
            toast(active.value.error || '分析失败');
          }
        }
      } catch {
        stopPoll();
      }
    })();
  }, 1500);
}

async function removeActive(): Promise<void> {
  if (!active.value) return;
  const ok = await confirmDialog(`删除分析报告「${active.value.name}」？`);
  if (!ok) return;
  try {
    const id = active.value.id;
    await endpoints.deleteAnalysisReport(id);
    stopPoll();
    active.value = null;
    await loadList();
    if (list.value[0]) await openReport(list.value[0].id);
    toast('已删除');
  } catch (error) {
    toast(messageOf(error));
  }
}

watch(
  () => active.value?.status,
  async (status) => {
    if (status === 'ready') await scrollChat();
    startPollIfBusy();
  },
);

onMounted(async () => {
  try {
    await loadList();
    if (props.reportId) {
      await openReport(props.reportId);
      startPollIfBusy();
      return;
    }
    if (list.value[0]) {
      await openReport(list.value[0].id);
      startPollIfBusy();
    }
  } catch (error) {
    toast(messageOf(error));
  }
});

onUnmounted(() => stopPoll());
</script>

<template>
  <section class="analysis-panel" data-testid="analysis-report-panel">
    <header class="analysis-top">
      <div class="analysis-top-left">
        <strong>分析报告</strong>
        <span class="muted">AI 对话生成</span>
      </div>
      <div class="analysis-top-actions">
        <button class="btn" type="button" data-testid="analysis-new" @click="startNew">
          新建分析
        </button>
        <button
          v-if="active"
          class="btn btn-ghost"
          type="button"
          data-testid="analysis-delete"
          @click="removeActive"
        >
          删除
        </button>
        <button
          class="icon-btn"
          type="button"
          data-testid="analysis-close"
          aria-label="关闭"
          @click="emit('close')"
        >
          ×
        </button>
      </div>
    </header>

    <div class="analysis-body">
      <aside class="analysis-list" v-if="list.length > 1">
        <div class="list-head">历史</div>
        <button
          v-for="item in list"
          :key="item.id"
          type="button"
          class="list-item"
          :class="{ active: active?.id === item.id }"
          @click="openReport(item.id)"
        >
          <span class="list-name">{{ item.name }}</span>
          <small class="list-status" :data-status="item.status">{{ statusLabel(item.status) }}</small>
        </button>
      </aside>

      <div class="analysis-main">
        <div
          v-if="busy || loading"
          class="report-canvas loading"
          data-testid="analysis-report-loading"
        >
          <div class="spinner"></div>
          <p>预计需要几分钟，可以稍后回来查看</p>
        </div>
        <div
          v-else-if="active?.reportMarkdown"
          class="report-canvas"
          data-testid="analysis-report-body"
          v-html="reportHtml"
        ></div>
        <div v-else class="report-canvas empty">
          <template v-if="active?.error">
            <div class="empty-icon error" aria-hidden="true">!</div>
            <p class="empty-state-title">生成失败</p>
            <p class="empty-state-hint">{{ active.error }}</p>
          </template>
          <template v-else>
            <div class="empty-icon" aria-hidden="true">◇</div>
            <p class="empty-state-title">暂无报告</p>
            <p class="empty-state-hint">
              在右侧对话中确认要分析的工作表后，Markdown 报告会显示在这里。
            </p>
          </template>
        </div>
      </div>

      <aside class="analysis-chat" data-testid="analysis-chat">
        <header class="chat-head">
          <strong>生成分析报告</strong>
        </header>

        <div v-if="active?.steps?.length" class="steps" data-testid="analysis-steps">
          <div class="steps-title">分析进度</div>
          <ol>
            <li
              v-for="step in active.steps"
              :key="step.id"
              :class="step.status"
            >
              <span class="step-mark">
                {{
                  step.status === 'done' ? '✓' : step.status === 'active' ? '…' : '○'
                }}
              </span>
              {{ step.label }}
            </li>
          </ol>
        </div>

        <div class="messages" data-testid="analysis-messages">
          <div
            v-for="msg in active?.messages ?? []"
            :key="msg.id"
            class="bubble"
            :class="msg.role"
          >
            <div class="bubble-role">
              {{ msg.role === 'user' ? '我' : '分析助手' }}
            </div>
            <div class="bubble-body">{{ msg.content }}</div>
            <div
              v-if="msg.kind === 'choice' && msg.options?.length && active?.status === 'asking' && msg.id === lastChoice?.id"
              class="choice-list"
            >
              <label
                v-for="opt in msg.options"
                :key="opt.id"
                class="choice-row"
              >
                <input
                  v-model="selectedOption"
                  type="radio"
                  name="analysis-choice"
                  :value="opt.id"
                  data-testid="analysis-choice"
                />
                <span>{{ opt.label }}</span>
              </label>
              <input
                v-if="selectedOption === 'other'"
                v-model="otherText"
                class="other-input"
                placeholder="请输入…"
                data-testid="analysis-other-input"
              />
            </div>
          </div>
          <div ref="chatEnd"></div>
        </div>

        <footer v-if="showConfirmBar" class="chat-actions">
          <button
            class="btn"
            type="button"
            data-testid="analysis-skip"
            :disabled="submitting || busy"
            @click="submitAnswer(true)"
          >
            跳过
          </button>
          <button
            class="btn btn-primary"
            type="button"
            data-testid="analysis-confirm"
            :disabled="submitting || busy"
            @click="submitAnswer(false)"
          >
            {{ submitting || busy ? '生成中…' : '确认' }}
          </button>
        </footer>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.analysis-panel {
  width: min(1120px, 96vw);
  height: min(780px, 90vh);
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.22);
}
.analysis-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light, #eef0f3);
}
.analysis-top-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.analysis-top-left strong {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #1f2329);
}
.analysis-top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.muted {
  color: var(--text-tertiary, #8f959e);
  font-size: 12px;
}
.analysis-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.analysis-list {
  width: 168px;
  border-right: 1px solid var(--border-light, #eef0f3);
  overflow: auto;
  padding: 10px 8px;
  background: #fafbfc;
}
.list-head {
  padding: 4px 10px 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-tertiary, #8f959e);
  text-transform: uppercase;
}
.list-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.12s ease;
}
.list-item:hover {
  background: #f0f2f5;
}
.list-item.active {
  background: #e8f0ff;
}
.list-name {
  color: var(--text-primary, #1f2329);
  font-weight: 500;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.list-item.active .list-name {
  color: #245bdb;
}
.list-status {
  font-size: 11px;
  color: var(--text-tertiary, #8f959e);
}
.list-status[data-status='ready'] {
  color: #0f9d58;
}
.list-status[data-status='failed'] {
  color: #d4380d;
}
.list-status[data-status='exploring'],
.list-status[data-status='generating'] {
  color: #3370ff;
}
.analysis-main {
  flex: 1.2;
  min-width: 0;
  background: #f5f6f8;
  border-right: 1px solid var(--border-light, #eef0f3);
}
.report-canvas {
  height: 100%;
  overflow: auto;
  padding: 28px 32px;
  font-size: 14px;
  line-height: 1.65;
  color: var(--text-primary, #1f2329);
  background: #fff;
  margin: 12px;
  border-radius: 10px;
  border: 1px solid var(--border-light, #eef0f3);
  box-sizing: border-box;
  width: calc(100% - 24px);
  height: calc(100% - 24px);
}
.report-canvas.loading,
.report-canvas.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 28px;
  color: var(--text-secondary, #646a73);
  text-align: center;
  background: transparent;
  border: 1px dashed #d9dee8;
}
.empty-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: #eef3ff;
  color: #3370ff;
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 4px;
}
.empty-icon.error {
  background: #fff1f0;
  color: #d4380d;
}
.report-canvas.empty .empty-state-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-secondary, #4e5969);
}
.report-canvas.empty .empty-state-hint {
  margin: 0;
  max-width: 300px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-tertiary, #8a9099);
}
.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e5e8ef;
  border-top-color: #3370ff;
  border-radius: 50%;
  animation: spin 0.85s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.report-canvas :deep(h1) {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 14px;
  line-height: 1.3;
}
.report-canvas :deep(h2) {
  font-size: 16px;
  font-weight: 600;
  margin: 22px 0 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-light, #f0f2f5);
}
.report-canvas :deep(h3) {
  font-size: 14px;
  font-weight: 600;
  margin: 16px 0 6px;
}
.report-canvas :deep(p),
.report-canvas :deep(ul),
.report-canvas :deep(ol) {
  margin: 0 0 12px;
}
.report-canvas :deep(li) {
  margin-bottom: 4px;
}
.report-canvas :deep(blockquote) {
  margin: 0 0 14px;
  padding: 10px 14px;
  background: #f5f8ff;
  border-left: 3px solid #3370ff;
  border-radius: 0 6px 6px 0;
  color: var(--text-secondary, #4e5969);
}
.report-canvas :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 16px;
  font-size: 13px;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
}
.report-canvas :deep(.md-table th),
.report-canvas :deep(.md-table td) {
  border: 1px solid #e8eaed;
  padding: 8px 10px;
  text-align: left;
}
.report-canvas :deep(.md-table th) {
  background: #f7f8fa;
  font-weight: 600;
  color: var(--text-secondary, #646a73);
}
.analysis-chat {
  width: 340px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fff;
}
.chat-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light, #eef0f3);
}
.chat-head strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1f2329);
}
.steps {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light, #eef0f3);
  font-size: 12px;
  background: #fafbfc;
}
.steps-title {
  color: var(--text-tertiary, #8f959e);
  margin-bottom: 8px;
  font-weight: 500;
}
.steps ol {
  list-style: none;
  margin: 0;
  padding: 0;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  color: var(--text-tertiary, #8f959e);
}
.steps li.active {
  color: var(--text-primary, #1f2329);
  font-weight: 600;
}
.steps li.done {
  color: #0f9d58;
}
.step-mark {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 10px;
  background: #f0f2f5;
  flex-shrink: 0;
}
.steps li.active .step-mark {
  background: #e8f0ff;
  color: #3370ff;
}
.steps li.done .step-mark {
  background: #e6f7ef;
  color: #0f9d58;
}
.messages {
  flex: 1;
  overflow: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.bubble {
  max-width: 100%;
}
.bubble.user {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.bubble-role {
  font-size: 11px;
  color: var(--text-tertiary, #8f959e);
  margin-bottom: 4px;
}
.bubble.user .bubble-body {
  background: #e8f3ff;
  color: #1f2329;
}
.bubble-body {
  display: inline-block;
  max-width: 100%;
  padding: 9px 12px;
  border-radius: 10px;
  background: #f5f6f7;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
}
.choice-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.choice-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 11px;
  border: 1px solid var(--border-light, #e5e6eb);
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  background: #fff;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.choice-row:hover {
  border-color: #3370ff;
  background: #f5f8ff;
}
.choice-row:has(input:checked) {
  border-color: #3370ff;
  background: #eef3ff;
  box-shadow: 0 0 0 1px #3370ff inset;
}
.other-input {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #d0d3d6;
  border-radius: 6px;
  font-size: 13px;
  box-sizing: border-box;
}
.other-input:focus {
  outline: none;
  border-color: #3370ff;
  box-shadow: 0 0 0 2px rgba(51, 112, 255, 0.15);
}
.chat-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-light, #eef0f3);
  background: #fafbfc;
}
</style>
