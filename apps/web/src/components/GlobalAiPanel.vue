<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { endpoints } from '../api/endpoints';
import type { AgentChatMessageDto } from '../api/types';
import { ApiError } from '../api/client';
import { newId } from '../ui/id';
import { toast } from '../ui/toast';
import AiChatDock, { type AiChatDockMessage } from './AiChatDock.vue';

const props = defineProps<{
  workspaceId?: string;
  baseId?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const sessionId = ref<string | null>(null);
const messages = ref<AiChatDockMessage[]>([]);
const busy = ref(false);
const bootError = ref('');

function toDockMessages(
  rows: AgentChatMessageDto[] | Array<{ id: string; role: string; content: string }>,
): AiChatDockMessage[] {
  return rows
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
}

async function ensureSession(): Promise<string> {
  if (sessionId.value) return sessionId.value;
  const created = await endpoints.createAgentSession({
    workspaceId: props.workspaceId,
    baseId: props.baseId,
    title: '全局助手',
  });
  sessionId.value = created.id;
  return created.id;
}

async function bootstrap(): Promise<void> {
  bootError.value = '';
  busy.value = true;
  try {
    const sessions = await endpoints.listAgentSessions();
    const match = sessions.find(
      (s) =>
        (props.baseId ? s.baseId === props.baseId : true) &&
        s.title === '全局助手',
    );
    if (match) {
      sessionId.value = match.id;
      const full = await endpoints.getAgentSession(match.id);
      messages.value = toDockMessages(
        full.messages.filter(
          (m) => m.role === 'user' || (m.role === 'assistant' && m.content),
        ),
      );
    } else {
      await ensureSession();
      messages.value = [];
    }
  } catch (error) {
    bootError.value =
      error instanceof ApiError
        ? String((error.body as { message?: string })?.message ?? error.message)
        : error instanceof Error
          ? error.message
          : '无法打开 AI 助手';
  } finally {
    busy.value = false;
  }
}

async function onSend(text: string): Promise<void> {
  busy.value = true;
  try {
    const id = await ensureSession();
    const clientMessageId = newId();
    messages.value = [
      ...messages.value,
      { id: `local-${clientMessageId}`, role: 'user', content: text },
    ];
    const result = await endpoints.postAgentMessage(id, text, clientMessageId);
    messages.value = toDockMessages(result.messages);
  } catch (error) {
    const msg =
      error instanceof ApiError
        ? String((error.body as { message?: string })?.message ?? error.message)
        : error instanceof Error
          ? error.message
          : '发送失败';
    toast(msg);
  } finally {
    busy.value = false;
  }
}

async function onClear(): Promise<void> {
  if (!sessionId.value) {
    messages.value = [];
    return;
  }
  busy.value = true;
  try {
    await endpoints.clearAgentSession(sessionId.value);
    messages.value = [];
  } catch (error) {
    toast(error instanceof Error ? error.message : '清空失败');
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void bootstrap();
});

watch(
  () => [props.workspaceId, props.baseId],
  () => {
    sessionId.value = null;
    messages.value = [];
    void bootstrap();
  },
);
</script>

<template>
  <div class="global-ai-panel" data-testid="global-ai-panel">
    <header class="panel-bar">
      <strong>AI 助手</strong>
      <button type="button" class="btn btn-ghost btn-sm" data-testid="global-ai-close" @click="emit('close')">
        关闭
      </button>
    </header>
    <p v-if="bootError" class="boot-error">{{ bootError }}</p>
    <AiChatDock
      v-else
      title="全局 AI"
      :messages="messages"
      :busy="busy"
      test-id-prefix="global-ai"
      placeholder="可查询表、改记录、管视图/表单/自动化…"
      @send="onSend"
      @clear="onClear"
    />
  </div>
</template>

<style scoped>
.global-ai-panel {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  width: min(420px, 100vw);
  height: 100vh;
  background: #fff;
  border-left: 1px solid #e5e6eb;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.06);
}
.panel-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #e5e6eb;
}
.boot-error {
  margin: 16px;
  color: #c45656;
  font-size: 14px;
}
.global-ai-panel :deep(.ai-chat-dock) {
  flex: 1;
  min-height: 0;
  border-left: none;
}
</style>
