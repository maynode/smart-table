<script setup lang="ts">
import type { AiComponentAttachment, AiComponentOptions } from 'shared';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { endpoints } from '../api/endpoints';
import AiComponentHost from '../ai-component/AiComponentHost.vue';

const props = defineProps<{
  fieldId: string;
  fieldName: string;
  modelValue: AiComponentOptions;
}>();

const emit = defineEmits<{
  'update:modelValue': [AiComponentOptions];
}>();

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
const chatScroll = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const messages = computed(
  () =>
    props.modelValue.messages ??
    ([] as NonNullable<AiComponentOptions['messages']>),
);

const statusLabel = computed(() => {
  const s = props.modelValue.status ?? 'draft';
  if (s === 'published') return '已发布';
  if (s === 'failed') return '生成失败';
  return '草稿';
});

const hasBundle = computed(() => Boolean(props.modelValue.bundle?.html));

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
  // Vite proxies /files → API; keep path absolute on same origin.
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
  <div class="ai-component-panel" data-testid="ai-component-field-panel">
    <p class="muted">
      「{{ fieldName }}」· 多轮对话设计组件；可粘贴截图、拖拽或上传文件。点「生成」会按整段会话（含附件）产出代码包再发布。
    </p>
    <p>
      状态：<strong>{{ statusLabel }}</strong>
      <span v-if="modelValue.version"> · v{{ modelValue.version }}</span>
      <span class="muted">
        · LLM {{ llmConfigured ? '已配置' : '未配置（仅本地模板兜底）' }}
      </span>
      <span v-if="generateSource" class="muted">
        · 上次生成：{{ generateSource === 'llm' ? '模型' : '本地兜底' }}
      </span>
    </p>

    <div
      ref="chatScroll"
      class="ai-component-chat"
      data-testid="ai-component-chat"
    >
      <div
        v-for="(msg, idx) in messages"
        :key="idx"
        class="ai-component-msg"
        :data-role="msg.role"
      >
        <span class="role">{{ msg.role === 'user' ? '你' : '助手' }}</span>
        <pre>{{ msg.content }}</pre>
        <div
          v-if="msg.attachments?.length"
          class="attach-row"
        >
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
        rows="3"
        data-testid="ai-component-chat-input"
        placeholder="继续描述需求；可 Ctrl+V 粘贴截图，或拖入文件"
        :disabled="busy"
        @paste="onPaste"
        @keydown.ctrl.enter.prevent="sendChat"
      />
      <div class="ai-component-actions">
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
          class="btn"
          data-testid="ai-component-upload"
          :disabled="busy || uploading"
          @click="fileInput?.click()"
        >
          {{ uploading ? '上传中…' : '上传附件' }}
        </button>
        <button
          type="button"
          class="btn"
          data-testid="ai-component-chat-send"
          :disabled="!canSend"
          @click="sendChat"
        >
          发送
        </button>
        <button
          type="button"
          class="btn"
          data-testid="ai-component-generate"
          :disabled="busy || messages.length === 0"
          @click="generate"
        >
          生成组件
        </button>
        <button
          type="button"
          class="btn btn-primary"
          data-testid="ai-component-publish"
          :disabled="busy || !hasBundle"
          @click="publish"
        >
          发布
        </button>
        <button
          type="button"
          class="btn"
          data-testid="ai-component-preview"
          :disabled="!hasBundle"
          @click="previewOpen = true"
        >
          预览
        </button>
      </div>
    </div>

    <p v-if="error" class="error" data-testid="ai-component-error">{{ error }}</p>
    <p v-if="modelValue.gridContract" class="muted small">
      gridContract：排序
      {{ modelValue.gridContract.sortKey?.path }}（{{
        modelValue.gridContract.sortKey?.type
      }}）· 导出「{{ modelValue.gridContract.exportDisplay?.template }}」
    </p>

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
}
.ai-component-chat {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow: auto;
  padding-right: 2px;
}
.ai-component-msg {
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  padding: 8px 10px;
  background: #fafafa;
}
.ai-component-msg[data-role='assistant'] {
  background: #f0f7ff;
}
.ai-component-msg .role {
  font-size: 12px;
  color: #646a73;
}
.ai-component-msg pre {
  margin: 4px 0 0;
  white-space: pre-wrap;
  font: inherit;
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
  width: 72px;
  height: 72px;
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
  border: 1px dashed #d0d3d9;
  border-radius: 10px;
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
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 50%;
  background: #1f2329;
  color: #fff;
  cursor: pointer;
  line-height: 1;
}
.ai-component-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.error {
  color: #d4380d;
  margin: 0;
}
.small {
  font-size: 12px;
}
textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  padding: 8px;
}
</style>
