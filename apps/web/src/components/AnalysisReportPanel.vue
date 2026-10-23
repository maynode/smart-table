<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
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
  loading.value = true;
  try {
    active.value = await endpoints.createAnalysisReport(
      props.baseId,
      '分析报告',
    );
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

watch(
  () => active.value?.status,
  async (status) => {
    if (status === 'ready') await scrollChat();
  },
);

onMounted(async () => {
  try {
    await loadList();
    if (list.value[0]) {
      await openReport(list.value[0].id);
    } else {
      await startNew();
    }
  } catch (error) {
    toast(messageOf(error));
  }
});
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
        <button
          v-for="item in list"
          :key="item.id"
          type="button"
          class="list-item"
          :class="{ active: active?.id === item.id }"
          @click="openReport(item.id)"
        >
          <span>{{ item.name }}</span>
          <small>{{ item.status }}</small>
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
          <p class="muted">
            {{
              active?.error
                ? active.error
                : '在右侧对话中确认分析范围后，报告将显示在这里。'
            }}
          </p>
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
  border-bottom: 1px solid #eef0f3;
}
.analysis-top-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.analysis-top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.muted {
  color: #8f959e;
  font-size: 12px;
}
.analysis-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.analysis-list {
  width: 160px;
  border-right: 1px solid #eef0f3;
  overflow: auto;
  padding: 8px;
}
.list-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
}
.list-item:hover,
.list-item.active {
  background: #f2f3f5;
}
.list-item small {
  color: #8f959e;
}
.analysis-main {
  flex: 1.2;
  min-width: 0;
  background: #f7f8fa;
  border-right: 1px solid #eef0f3;
}
.report-canvas {
  height: 100%;
  overflow: auto;
  padding: 24px 28px;
  font-size: 14px;
  line-height: 1.6;
  color: #1f2329;
}
.report-canvas.loading,
.report-canvas.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: #646a73;
}
.spinner {
  width: 42px;
  height: 42px;
  border: 3px solid #d9dee8;
  border-top-color: #3370ff;
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.report-canvas :deep(h1) {
  font-size: 22px;
  margin: 0 0 12px;
}
.report-canvas :deep(h2) {
  font-size: 17px;
  margin: 20px 0 8px;
}
.report-canvas :deep(h3) {
  font-size: 15px;
  margin: 14px 0 6px;
}
.report-canvas :deep(p),
.report-canvas :deep(ul),
.report-canvas :deep(ol) {
  margin: 0 0 10px;
}
.report-canvas :deep(blockquote) {
  margin: 0 0 12px;
  padding: 8px 12px;
  background: #eef3ff;
  border-left: 3px solid #3370ff;
  color: #4e5969;
}
.report-canvas :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 14px;
  font-size: 13px;
  background: #fff;
}
.report-canvas :deep(.md-table th),
.report-canvas :deep(.md-table td) {
  border: 1px solid #e5e6eb;
  padding: 6px 8px;
  text-align: left;
}
.report-canvas :deep(.md-table th) {
  background: #f2f3f5;
}
.analysis-chat {
  width: 340px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fff;
}
.chat-head {
  padding: 12px 14px;
  border-bottom: 1px solid #eef0f3;
}
.steps {
  padding: 10px 14px;
  border-bottom: 1px solid #eef0f3;
  font-size: 12px;
}
.steps-title {
  color: #8f959e;
  margin-bottom: 6px;
}
.steps ol {
  list-style: none;
  margin: 0;
  padding: 0;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  color: #8f959e;
}
.steps li.active {
  color: #1f2329;
  font-weight: 600;
}
.steps li.done {
  color: #52c41a;
}
.step-mark {
  width: 14px;
  text-align: center;
}
.messages {
  flex: 1;
  overflow: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bubble {
  max-width: 100%;
}
.bubble-role {
  font-size: 11px;
  color: #8f959e;
  margin-bottom: 4px;
}
.bubble.user .bubble-body {
  background: #e8f3ff;
  margin-left: auto;
}
.bubble-body {
  display: inline-block;
  padding: 8px 10px;
  border-radius: 10px;
  background: #f5f6f7;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.choice-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.choice-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  background: #fff;
}
.choice-row:hover {
  border-color: #3370ff;
  background: #f5f8ff;
}
.other-input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #d0d3d6;
  border-radius: 6px;
  font-size: 13px;
}
.chat-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid #eef0f3;
}
</style>
