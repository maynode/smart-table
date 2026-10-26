<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

export type AiChatDockMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

const props = withDefaults(
  defineProps<{
    title?: string;
    messages: AiChatDockMessage[];
    busy?: boolean;
    disabled?: boolean;
    placeholder?: string;
    testIdPrefix?: string;
    assistantLabel?: string;
  }>(),
  {
    title: 'AI 助手',
    busy: false,
    disabled: false,
    placeholder: '输入消息，Enter 发送，Shift+Enter 换行',
    testIdPrefix: 'ai-chat',
    assistantLabel: '助手',
  },
);

const emit = defineEmits<{
  send: [text: string];
  clear: [];
}>();

const draft = ref('');
const chatEnd = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);

const canSend = computed(
  () =>
    Boolean(draft.value.trim()) && !props.busy && !props.disabled,
);

async function scrollToEnd(): Promise<void> {
  await nextTick();
  chatEnd.value?.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

watch(
  () => props.messages.length,
  () => {
    void scrollToEnd();
  },
);

function submit(): void {
  const text = draft.value.trim();
  if (!text || props.busy || props.disabled) return;
  draft.value = '';
  emit('send', text);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
}

defineExpose({ focus: () => inputRef.value?.focus() });
</script>

<template>
  <aside class="ai-chat-dock" :data-testid="`${testIdPrefix}`">
    <header class="chat-head">
      <strong>{{ title }}</strong>
      <div class="chat-head-actions">
        <span v-if="busy" class="chat-busy">思考中…</span>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :data-testid="`${testIdPrefix}-clear`"
          :disabled="busy || disabled"
          @click="emit('clear')"
        >
          清空
        </button>
      </div>
    </header>

    <div class="messages" :data-testid="`${testIdPrefix}-messages`">
      <div
        v-for="msg in messages"
        :key="msg.id"
        class="bubble"
        :class="msg.role"
      >
        <div class="bubble-role">
          {{ msg.role === 'user' ? '我' : assistantLabel }}
        </div>
        <div v-if="msg.content" class="bubble-body">{{ msg.content }}</div>
      </div>
      <div ref="chatEnd"></div>
    </div>

    <footer class="chat-composer" :data-testid="`${testIdPrefix}-composer`">
      <textarea
        ref="inputRef"
        v-model="draft"
        class="chat-input"
        rows="3"
        :placeholder="placeholder"
        :data-testid="`${testIdPrefix}-input`"
        :disabled="busy || disabled"
        @keydown="onKeydown"
      />
      <div class="composer-actions">
        <button
          class="btn btn-primary"
          type="button"
          :data-testid="`${testIdPrefix}-send`"
          :disabled="!canSend"
          @click="submit"
        >
          {{ busy ? '发送中…' : '发送' }}
        </button>
      </div>
    </footer>
  </aside>
</template>

<style scoped>
.ai-chat-dock {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: #fff;
  border-left: 1px solid #e5e6eb;
}
.chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid #e5e6eb;
}
.chat-head strong {
  font-size: 14px;
}
.chat-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.chat-busy {
  font-size: 12px;
  color: #8a9099;
}
.btn-sm {
  padding: 2px 8px;
  font-size: 12px;
}
.messages {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #f7f8fa;
}
.bubble {
  max-width: 92%;
  padding: 8px 10px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #e8eaed;
}
.bubble.user {
  align-self: flex-end;
  background: #e8f3ff;
  border-color: #c6e2ff;
}
.bubble.assistant,
.bubble.system {
  align-self: flex-start;
}
.bubble-role {
  font-size: 11px;
  color: #8a9099;
  margin-bottom: 4px;
}
.bubble-body {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.5;
  color: #1f2329;
}
.chat-composer {
  padding: 10px 12px 12px;
  border-top: 1px solid #e5e6eb;
  background: #fff;
}
.chat-input {
  width: 100%;
  resize: none;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  font-size: 13px;
  box-sizing: border-box;
}
.chat-input:focus {
  outline: none;
  border-color: #2d8cf0;
}
.chat-input:disabled {
  background: #f2f3f5;
}
.composer-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
