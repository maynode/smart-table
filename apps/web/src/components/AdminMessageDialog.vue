<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { renderSimpleMarkdown } from '../ui/simple-markdown';

const props = defineProps<{
  open: boolean;
  account: string;
  busy?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  send: [content: string];
}>();

const MAX_LEN = 2000;
const content = ref('');
const error = ref('');
const showPreview = ref(false);
const textareaEl = ref<HTMLTextAreaElement | null>(null);

const previewHtml = computed(() =>
  content.value.trim() ? renderSimpleMarkdown(content.value) : '',
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    content.value = '';
    error.value = '';
    showPreview.value = false;
    void nextTick(() => textareaEl.value?.focus());
  },
);

function wrapSelection(before: string, after = before): void {
  const el = textareaEl.value;
  if (!el) {
    content.value = `${before}${content.value}${after}`;
    return;
  }
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = content.value.slice(start, end) || '文本';
  const next = `${content.value.slice(0, start)}${before}${selected}${after}${content.value.slice(end)}`;
  content.value = next;
  void nextTick(() => {
    el.focus();
    const cursor = start + before.length + selected.length;
    el.setSelectionRange(start + before.length, cursor);
  });
}

function insertLinePrefix(prefix: string): void {
  const el = textareaEl.value;
  if (!el) {
    content.value = `${prefix}${content.value}`;
    return;
  }
  const start = el.selectionStart;
  const lineStart = content.value.lastIndexOf('\n', start - 1) + 1;
  content.value =
    content.value.slice(0, lineStart) + prefix + content.value.slice(lineStart);
  void nextTick(() => {
    el.focus();
    const pos = start + prefix.length;
    el.setSelectionRange(pos, pos);
  });
}

function insertLink(): void {
  const el = textareaEl.value;
  const selected =
    el && el.selectionStart !== el.selectionEnd
      ? content.value.slice(el.selectionStart, el.selectionEnd)
      : '链接文字';
  wrapSelection('[', '](https://)');
  void selected;
}

function submit(): void {
  const text = content.value.trim();
  if (!text) {
    error.value = '请填写消息内容';
    return;
  }
  if (text.length > MAX_LEN) {
    error.value = `消息内容不超过 ${MAX_LEN} 字`;
    return;
  }
  error.value = '';
  emit('send', text);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="admin-msg-mask"
      data-testid="admin-message-dialog"
      @click.self="!busy && emit('close')"
    >
      <section class="admin-msg-panel" role="dialog" aria-modal="true">
        <header class="admin-msg-head">
          <div>
            <h3>发消息</h3>
            <p class="muted">发送给 {{ account }} · 支持 Markdown</p>
          </div>
          <button
            type="button"
            class="admin-msg-close"
            aria-label="关闭"
            :disabled="busy"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="admin-msg-toolbar">
          <button type="button" class="btn" title="加粗" @click="wrapSelection('**')">
            B
          </button>
          <button type="button" class="btn" title="斜体" @click="wrapSelection('*')">
            I
          </button>
          <button type="button" class="btn" title="链接" @click="insertLink">
            链接
          </button>
          <button
            type="button"
            class="btn"
            title="无序列表"
            @click="insertLinePrefix('- ')"
          >
            列表
          </button>
          <span class="admin-msg-spacer" />
          <button
            type="button"
            class="btn"
            :class="{ 'btn-primary': showPreview }"
            @click="showPreview = !showPreview"
          >
            {{ showPreview ? '编辑' : '预览' }}
          </button>
        </div>

        <textarea
          v-show="!showPreview"
          ref="textareaEl"
          v-model="content"
          class="admin-msg-input"
          rows="8"
          :maxlength="MAX_LEN"
          placeholder="支持 **加粗**、*斜体*、列表、- [链接](https://…)"
          data-testid="admin-message-content"
          :disabled="busy"
        />
        <div
          v-show="showPreview"
          class="admin-msg-preview md-body"
          data-testid="admin-message-preview"
        >
          <div v-if="previewHtml" v-html="previewHtml" />
          <p v-else class="muted">暂无内容</p>
        </div>

        <div class="admin-msg-meta">
          <span class="muted">{{ content.length }}/{{ MAX_LEN }}</span>
          <p v-if="error" class="admin-msg-error">{{ error }}</p>
        </div>

        <footer class="admin-msg-foot">
          <button type="button" class="btn" :disabled="busy" @click="emit('close')">
            取消
          </button>
          <button
            type="button"
            class="btn btn-primary"
            data-testid="admin-message-send"
            :disabled="busy"
            @click="submit"
          >
            {{ busy ? '发送中…' : '发送' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.admin-msg-mask {
  position: fixed;
  inset: 0;
  z-index: 1400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.42);
}

.admin-msg-panel {
  width: min(560px, 100%);
  background: #fff;
  border-radius: 12px;
  border: 1px solid var(--border, #e5e6eb);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
  padding: 18px 18px 16px;
}

.admin-msg-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid #eef0f3;
}

.admin-msg-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}

.admin-msg-head .muted {
  margin: 4px 0 0;
  font-size: 12px;
}

.admin-msg-close {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  color: var(--text-secondary, #646a73);
  cursor: pointer;
}

.admin-msg-close:hover:not(:disabled) {
  background: var(--bg-hover, #f2f3f5);
  color: var(--text, #1f2329);
}

.admin-msg-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding: 6px;
  background: var(--bg-muted, #f7f8fa);
  border-radius: 8px;
}

.admin-msg-toolbar .btn {
  height: 28px;
  min-width: 28px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 600;
  background: #fff;
}

.admin-msg-spacer {
  flex: 1;
  min-width: 8px;
}

.admin-msg-input,
.admin-msg-preview {
  width: 100%;
  min-height: 200px;
  box-sizing: border-box;
  border: 1px solid var(--border, #e5e6eb);
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.55;
}

.admin-msg-input {
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.admin-msg-input:focus-visible {
  border-color: var(--brand, #2d8cf0);
}

.admin-msg-preview {
  overflow: auto;
  background: #fafbfc;
}

.admin-msg-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  min-height: 20px;
}

.admin-msg-error {
  margin: 0;
  font-size: 12px;
  color: var(--danger, #d4380d);
}

.admin-msg-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #eef0f3;
}
</style>
