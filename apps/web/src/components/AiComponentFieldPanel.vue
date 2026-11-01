<script setup lang="ts">
import type { AiComponentAttachment, AiComponentOptions } from 'shared';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { endpoints } from '../api/endpoints';
import { useViewport } from '../composables/useViewport';
import AiComponentHost from '../ai-component/AiComponentHost.vue';

const props = defineProps<{
  fieldId: string;
  fieldName: string;
  modelValue: AiComponentOptions;
}>();

const emit = defineEmits<{
  'update:modelValue': [AiComponentOptions];
}>();

const { isPhone } = useViewport();

const draft = ref('');
const pending = ref<AiComponentAttachment[]>([]);
const busy = ref(false);
const uploading = ref(false);
const error = ref('');
const llmConfigured = ref(false);
const canGenerate = ref(true);
const previewOpen = ref(false);
const previewValue = ref<unknown>({ rating: 0 });
const generateSource = ref<'llm' | 'fallback' | ''>('');
const advancedOpen = ref(false);
const chatScroll = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const EXAMPLE_PROMPTS = [
  '做一个可点击的五星评分，把分数写回本格',
  '做一个开关：开/关，写回本格',
  '做一个 0–100 的进度条，可拖动调整',
  '做一个简单的确认按钮，点后标记为已完成',
] as const;

const messages = computed(
  () =>
    props.modelValue.messages ??
    ([] as NonNullable<AiComponentOptions['messages']>),
);

const status = computed(() => props.modelValue.status ?? 'draft');
const hasBundle = computed(() => Boolean(props.modelValue.bundle?.html));
const isPublished = computed(() => status.value === 'published');

const phase = computed(() => {
  if (isPublished.value && hasBundle.value) return 'live' as const;
  if (hasBundle.value) return 'preview' as const;
  if (messages.value.length > 0) return 'ready' as const;
  return 'start' as const;
});

const phaseHint = computed(() => {
  switch (phase.value) {
    case 'start':
      return '用一句话描述想要的格子交互，或点下方示例快速开始';
    case 'ready':
      return '描述清楚后点「生成组件」，再预览确认';
    case 'preview':
      return '预览没问题就可以发布到表格；也可继续对话再生成';
    case 'live':
      return '已对全表生效。继续对话并重新生成后，需再次发布才会更新';
    default:
      return '';
  }
});

const canSend = computed(
  () => Boolean(draft.value.trim() || pending.value.length) && !busy.value,
);

async function refreshSession(): Promise<void> {
  if (!props.fieldId) return;
  try {
    const session = await endpoints.getAiComponentSession(props.fieldId);
    llmConfigured.value = session.llmConfigured;
    emit('update:modelValue', {
      ...props.modelValue,
      status: session.status as AiComponentOptions['status'],
      version: session.version,
      messages: session.messages as AiComponentOptions['messages'],
      gridContract: (session.gridContract ??
        props.modelValue.gridContract) as AiComponentOptions['gridContract'],
      bundle: (session.bundle ??
        props.modelValue.bundle) as AiComponentOptions['bundle'],
      bridgeManifest: (session.bridgeManifest ??
        props.modelValue.bridgeManifest) as AiComponentOptions['bridgeManifest'],
      valueSchema: (session.valueSchema ??
        props.modelValue.valueSchema) as AiComponentOptions['valueSchema'],
    });
    canGenerate.value = true;
    await scrollChat();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function scrollChat(): Promise<void> {
  await nextTick();
  const el = chatScroll.value;
  if (el) el.scrollTop = el.scrollHeight;
}

onMounted(() => {
  void refreshSession();
});

watch(
  () => props.fieldId,
  () => {
    void refreshSession();
  },
);

async function addFiles(fileList: FileList | File[]): Promise<void> {
  const files = [...fileList];
  if (!files.length || !props.fieldId) return;
  uploading.value = true;
  error.value = '';
  try {
    for (const file of files) {
      const uploaded = await endpoints.uploadAiComponentAttachment(
        props.fieldId,
        file,
      );
      pending.value = [...pending.value, uploaded];
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    uploading.value = false;
  }
}

function removePending(index: number): void {
  pending.value = pending.value.filter((_, i) => i !== index);
}

function onPickFiles(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  if (input.files?.length) void addFiles(input.files);
  input.value = '';
}

async function onPaste(ev: ClipboardEvent): Promise<void> {
  const items = ev.clipboardData?.items;
  if (!items) return;
  const files: File[] = [];
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length) {
    ev.preventDefault();
    await addFiles(files);
  }
}

function onDrop(ev: DragEvent): void {
  ev.preventDefault();
  if (ev.dataTransfer?.files?.length) void addFiles(ev.dataTransfer.files);
}

function useExample(text: string): void {
  draft.value = text;
}

async function sendChat(): Promise<void> {
  if (!canSend.value || !props.fieldId) return;
  busy.value = true;
  error.value = '';
  const text = draft.value;
  const attachments = [...pending.value];
  try {
    const result = await endpoints.chatAiComponent(
      props.fieldId,
      text,
      attachments,
    );
    draft.value = '';
    pending.value = [];
    llmConfigured.value = result.llmConfigured;
    canGenerate.value = result.canGenerate;
    emit('update:modelValue', {
      ...props.modelValue,
      messages: result.messages as AiComponentOptions['messages'],
      status: props.modelValue.status === 'published' ? 'published' : 'draft',
    });
    await scrollChat();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function generate(): Promise<void> {
  if (!props.fieldId || busy.value) return;
  busy.value = true;
  error.value = '';
  generateSource.value = '';
  try {
    const result = await endpoints.generateAiComponent(props.fieldId);
    generateSource.value = result.source ?? '';
    emit('update:modelValue', {
      ...props.modelValue,
      status: 'draft',
      bundle: result.bundle as AiComponentOptions['bundle'],
      bridgeManifest:
        result.bridgeManifest as AiComponentOptions['bridgeManifest'],
      valueSchema: result.valueSchema as AiComponentOptions['valueSchema'],
      gridContract: result.gridContract as AiComponentOptions['gridContract'],
    });
    canGenerate.value = true;
    previewValue.value = /开关|toggle/i.test(result.previewHint)
      ? { on: false }
      : { rating: 0 };
    previewOpen.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function publish(): Promise<void> {
  if (!props.fieldId || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await endpoints.publishAiComponent(props.fieldId);
    emit('update:modelValue', {
      ...props.modelValue,
      status: 'published',
      version: result.version,
      bundle: (result.bundle ??
        props.modelValue.bundle) as AiComponentOptions['bundle'],
      bridgeManifest: (result.bridgeManifest ??
        props.modelValue.bridgeManifest) as AiComponentOptions['bridgeManifest'],
      gridContract: (result.gridContract ??
        props.modelValue.gridContract) as AiComponentOptions['gridContract'],
    });
    previewOpen.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

function isImage(mime: string): boolean {
  return /^image\//i.test(mime);
}

function fileUrl(url: string): string {
  return url;
}

async function previewGetCell(): Promise<unknown> {
  return previewValue.value;
}
async function previewSetCell(value: unknown): Promise<void> {
  previewValue.value = value;
}
</script>

<template>
  <div
    class="ai-component-panel"
    :class="{ 'is-phone': isPhone }"
    data-testid="ai-component-field-panel"
  >
    <header class="panel-head">
      <div class="panel-head-main">
        <div class="status-row">
          <span
            class="status-pill"
            :data-status="status"
            data-testid="ai-component-status"
          >
            {{
              status === 'published'
                ? '已发布'
                : status === 'failed'
                  ? '生成失败'
                  : '草稿'
            }}
          </span>
          <span v-if="modelValue.version" class="version"
            >v{{ modelValue.version }}</span
          >
          <span
            class="llm-dot"
            :class="{ on: llmConfigured }"
            :title="llmConfigured ? 'AI 已配置' : 'AI 未配置，将用本地模板'"
          />
        </div>
        <p class="phase-hint">{{ phaseHint }}</p>
      </div>
      <ol class="steps" aria-label="配置步骤">
        <li :class="{ done: messages.length > 0, current: phase === 'start' }">
          1 描述
        </li>
        <li
          :class="{
            done: hasBundle,
            current: phase === 'ready' || phase === 'preview',
          }"
        >
          2 生成
        </li>
        <li :class="{ done: isPublished, current: phase === 'live' }">
          3 发布
        </li>
      </ol>
    </header>

    <div
      ref="chatScroll"
      class="ai-component-chat"
      data-testid="ai-component-chat"
    >
      <div v-if="messages.length === 0" class="empty-chat">
        <p class="empty-title">还没有对话</p>
        <p class="empty-sub">选一个示例，或自己输入需求：</p>
        <div class="example-chips">
          <button
            v-for="ex in EXAMPLE_PROMPTS"
            :key="ex"
            type="button"
            class="example-chip"
            data-testid="ai-component-example"
            @click="useExample(ex)"
          >
            {{ ex }}
          </button>
        </div>
      </div>
      <div
        v-for="(msg, idx) in messages"
        :key="idx"
        class="ai-component-msg"
        :data-role="msg.role"
      >
        <span class="role">{{ msg.role === 'user' ? '你' : '助手' }}</span>
        <pre>{{ msg.content }}</pre>
        <div v-if="msg.attachments?.length" class="attach-row">
          <template
            v-for="(file, fi) in msg.attachments"
            :key="`${idx}-${fi}`"
          >
            <a
              v-if="isImage(file.mimetype)"
              class="attach-thumb"
              :href="fileUrl(file.url)"
              target="_blank"
              rel="noreferrer"
            >
              <img :src="fileUrl(file.url)" :alt="file.name" />
            </a>
            <a
              v-else
              class="attach-file"
              :href="fileUrl(file.url)"
              target="_blank"
              rel="noreferrer"
            >
              📎 {{ file.name }}
            </a>
          </template>
        </div>
      </div>
    </div>

    <div
      class="composer"
      data-testid="ai-component-composer"
      @dragover.prevent
      @drop="onDrop"
    >
      <div v-if="pending.length" class="pending-row">
        <div
          v-for="(file, index) in pending"
          :key="file.url"
          class="pending-item"
        >
          <img
            v-if="isImage(file.mimetype)"
            :src="fileUrl(file.url)"
            :alt="file.name"
          />
          <span v-else class="pending-name">{{ file.name }}</span>
          <button
            type="button"
            class="pending-remove"
            aria-label="移除附件"
            @click="removePending(index)"
          >
            ×
          </button>
        </div>
      </div>
      <textarea
        v-model="draft"
        rows="2"
        data-testid="ai-component-chat-input"
        placeholder="描述想要的交互…（Ctrl+Enter 发送，可粘贴截图）"
        :disabled="busy"
        @paste="onPaste"
        @keydown.ctrl.enter.prevent="sendChat"
      />
      <div class="composer-bar">
        <input
          ref="fileInput"
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.csv,.xlsx,.docx,.zip"
          hidden
          @change="onPickFiles"
        />
        <button
          type="button"
          class="btn btn-ghost touch-target"
          data-testid="ai-component-upload"
          :disabled="busy || uploading"
          :title="uploading ? '上传中…' : '上传附件'"
          @click="fileInput?.click()"
        >
          {{ uploading ? '…' : '附件' }}
        </button>
        <button
          type="button"
          class="btn btn-primary touch-target send-btn"
          data-testid="ai-component-chat-send"
          :disabled="!canSend"
          @click="sendChat"
        >
          发送
        </button>
      </div>
    </div>

    <div class="action-dock" data-testid="ai-component-actions">
      <button
        v-if="hasBundle && phase !== 'live'"
        type="button"
        class="btn touch-target"
        data-testid="ai-component-preview"
        @click="previewOpen = true"
      >
        预览
      </button>
      <button
        type="button"
        class="btn touch-target"
        data-testid="ai-component-generate"
        :disabled="busy || messages.length === 0"
        @click="generate"
      >
        {{ hasBundle ? '重新生成' : '生成组件' }}
      </button>
      <button
        type="button"
        class="btn btn-primary touch-target primary-cta"
        data-testid="ai-component-publish"
        :disabled="
          busy || (phase !== 'live' && !hasBundle && messages.length === 0)
        "
        @click="onPrimaryClick"
      >
        {{
          phase === 'live'
            ? '打开预览'
            : hasBundle
              ? busy
                ? '发布中…'
                : '发布到表格'
              : busy
                ? '生成中…'
                : '生成并预览'
        }}
      </button>
    </div>

    <p v-if="error" class="error" data-testid="ai-component-error">{{ error }}</p>

    <button
      type="button"
      class="advanced-toggle"
      @click="advancedOpen = !advancedOpen"
    >
      {{ advancedOpen ? '收起技术信息' : '技术信息（筛选/排序合同）' }}
    </button>
    <div v-if="advancedOpen" class="advanced">
      <p class="muted small">
        LLM：{{ llmConfigured ? '已配置' : '未配置, 本地模板兜底' }}
        <span v-if="generateSource">
          · 上次生成：{{ generateSource === 'llm' ? '模型' : '本地兜底' }}
        </span>
      </p>
      <p v-if="modelValue.gridContract" class="muted small">
        排序键 {{ modelValue.gridContract.sortKey?.path }}（{{
          modelValue.gridContract.sortKey?.type
        }}）· 导出「{{ modelValue.gridContract.exportDisplay?.template }}」
      </p>
      <p v-else class="muted small">尚未生成 gridContract</p>
    </div>

    <AiComponentHost
      placement="modal"
      :open="previewOpen"
      :title="fieldName"
      :html="modelValue.bundle?.html ?? ''"
      :css="modelValue.bundle?.css"
      :js="modelValue.bundle?.js"
      :value="previewValue"
      :get-cell="previewGetCell"
      :set-cell="previewSetCell"
      @close="previewOpen = false"
    />
  </div>
</template>

<style scoped>
.ai-component-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.panel-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  background: #f2f3f5;
  color: #646a73;
}

.status-pill[data-status='published'] {
  background: #e8fff3;
  color: #0f9d58;
}

.status-pill[data-status='failed'] {
  background: #fff1f0;
  color: #d4380d;
}

.version {
  font-size: 12px;
  color: #8f959e;
}

.llm-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d0d3d9;
}

.llm-dot.on {
  background: #0f9d58;
}

.phase-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: #646a73;
}

.steps {
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.steps li {
  flex: 1;
  text-align: center;
  padding: 6px 4px;
  border-radius: 8px;
  font-size: 12px;
  color: #8f959e;
  background: #f7f8fa;
}

.steps li.done {
  color: #1d6fdc;
  background: #f0f7ff;
  font-weight: 600;
}

.steps li.current {
  color: #fff;
  background: #2d8cf0;
  font-weight: 600;
}

.ai-component-chat {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 160px;
  max-height: min(42vh, 360px);
  overflow: auto;
  padding: 4px 2px;
  -webkit-overflow-scrolling: touch;
}

.empty-chat {
  padding: 12px;
  border: 1px dashed #d0d3d9;
  border-radius: 10px;
  background: #fafbfc;
}

.empty-title {
  margin: 0 0 4px;
  font-weight: 600;
  font-size: 14px;
}

.empty-sub {
  margin: 0 0 10px;
  font-size: 12px;
  color: #8f959e;
}

.example-chips {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.example-chip {
  text-align: left;
  padding: 10px 12px;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  background: #fff;
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
  color: #1f2329;
  cursor: pointer;
}

.example-chip:hover {
  border-color: #2d8cf0;
  background: #f5f9ff;
}

.ai-component-msg {
  border: 1px solid #e5e6eb;
  border-radius: 10px;
  padding: 8px 10px;
  background: #fafafa;
}

.ai-component-msg[data-role='assistant'] {
  background: #f0f7ff;
  border-color: #d6e4ff;
}

.ai-component-msg .role {
  font-size: 12px;
  color: #646a73;
  font-weight: 600;
}

.ai-component-msg pre {
  margin: 4px 0 0;
  white-space: pre-wrap;
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
}

.attach-row,
.pending-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.attach-thumb img,
.pending-item img {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid #e5e6eb;
  display: block;
}

.attach-file,
.pending-name {
  font-size: 12px;
  color: #1d6fdc;
}

.composer {
  border: 1px solid #e5e6eb;
  border-radius: 12px;
  padding: 8px;
  background: #fff;
}

.pending-item {
  position: relative;
}

.pending-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 50%;
  background: #1f2329;
  color: #fff;
  cursor: pointer;
  line-height: 1;
}

.composer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}

.send-btn {
  min-width: 88px;
}

.action-dock {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
  padding-top: 4px;
}

.primary-cta {
  min-width: 120px;
}

.error {
  color: #d4380d;
  margin: 0;
  font-size: 13px;
}

.advanced-toggle {
  align-self: flex-start;
  border: 0;
  background: transparent;
  color: #8f959e;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.advanced {
  padding: 8px 10px;
  border-radius: 8px;
  background: #f7f8fa;
}

.muted {
  margin: 0;
  color: #8f959e;
}

.small {
  font-size: 12px;
  line-height: 1.45;
}

textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 64px;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  padding: 10px;
  font: inherit;
  font-size: 14px;
}

.ai-component-panel.is-phone .ai-component-chat {
  max-height: min(36vh, 280px);
}

.ai-component-panel.is-phone .action-dock {
  position: sticky;
  bottom: 0;
  background: linear-gradient(180deg, transparent, #fff 28%);
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.ai-component-panel.is-phone .primary-cta,
.ai-component-panel.is-phone .send-btn {
  min-height: var(--touch-min, 44px);
}

@media (max-width: 767.98px) {
  .steps li {
    font-size: 11px;
    padding: 8px 2px;
  }

  .example-chip {
    min-height: var(--touch-min, 44px);
  }
}
</style>
