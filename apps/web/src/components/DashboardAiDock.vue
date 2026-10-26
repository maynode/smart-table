<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import type {
  DashboardAiActionResultDto,
  DashboardAiSessionDto,
  DashboardWidgetDto,
} from '../api/types';
import { toast } from '../ui/toast';
import AiChatDock from './AiChatDock.vue';

const props = defineProps<{
  dashboardId: string;
}>();

const emit = defineEmits<{
  applied: [payload: {
    applied: DashboardAiActionResultDto[];
    widgets: DashboardWidgetDto[];
  }];
}>();

const session = ref<DashboardAiSessionDto | null>(null);
const loading = ref(false);
const submitting = ref(false);

const busy = computed(
  () => submitting.value || session.value?.status === 'thinking',
);

const messages = computed(() => session.value?.messages ?? []);

async function loadSession(): Promise<void> {
  loading.value = true;
  try {
    session.value = await endpoints.getDashboardAiSession(props.dashboardId);
  } catch (error) {
    toast(
      error instanceof ApiError ? error.message : '加载仪表盘助手失败',
      'error',
    );
  } finally {
    loading.value = false;
  }
}

async function clearChat(): Promise<void> {
  if (submitting.value) return;
  try {
    session.value = await endpoints.clearDashboardAiSession(props.dashboardId);
    toast('已清空对话');
  } catch (error) {
    toast(
      error instanceof ApiError ? error.message : '清空失败',
      'error',
    );
  }
}

async function sendChat(text: string): Promise<void> {
  if (!text.trim() || submitting.value) return;
  submitting.value = true;
  const clientMessageId = `c_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  try {
    const result = await endpoints.chatDashboardAi(props.dashboardId, {
      text,
      clientMessageId,
    });
    session.value = {
      id: result.id,
      dashboardId: result.dashboardId,
      status: result.status,
      messages: result.messages,
      error: result.error,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
    if (result.applied?.length) {
      emit('applied', {
        applied: result.applied,
        widgets: result.widgets ?? [],
      });
    }
  } catch (error) {
    toast(
      error instanceof ApiError ? error.message : '发送失败',
      'error',
    );
  } finally {
    submitting.value = false;
  }
}

watch(
  () => props.dashboardId,
  () => {
    void loadSession();
  },
);

onMounted(() => {
  void loadSession();
});
</script>

<template>
  <div class="dashboard-ai-dock-wrap" data-testid="dashboard-ai-chat">
    <AiChatDock
      title="仪表盘助手"
      assistant-label="仪表盘助手"
      test-id-prefix="dashboard-ai"
      :messages="messages"
      :busy="busy || loading"
      placeholder="例如：加一张柱状图 / 删除最后一张 / 数据概况"
      @send="sendChat"
      @clear="clearChat"
    />
  </div>
</template>

<style scoped>
.dashboard-ai-dock-wrap {
  width: 320px;
  min-width: 280px;
  max-width: 360px;
  height: 100%;
  min-height: 0;
  flex: none;
}
</style>
