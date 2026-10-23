<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { endpoints } from '../api/endpoints';
import type { NotificationDto } from '../api/types';
import { toast } from '../ui/toast';

const open = ref(false);
const loading = ref(false);
const items = ref<NotificationDto[]>([]);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const unreadCount = computed(
  () => items.value.filter((row) => !row.readAt).length,
);

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const result = await endpoints.listNotifications(40);
    items.value = result.notifications;
  } catch (error) {
    // Silent on poll; surface only when user opens the panel.
    if (open.value) {
      toast(error instanceof Error ? error.message : '加载通知失败');
    }
  } finally {
    loading.value = false;
  }
}

async function toggle(): Promise<void> {
  open.value = !open.value;
  if (open.value) await refresh();
}

async function markRead(row: NotificationDto): Promise<void> {
  if (row.readAt) return;
  try {
    await endpoints.markNotificationRead(row.id);
    row.readAt = new Date().toISOString();
  } catch (error) {
    toast(error instanceof Error ? error.message : '标记已读失败');
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

onMounted(() => {
  void refresh();
  pollTimer = setInterval(() => {
    void refresh();
  }, 30_000);
});

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <div class="notify-wrap">
    <button
      class="topbar-btn notify-btn"
      type="button"
      data-testid="notifications-open"
      @click="toggle"
    >
      消息
      <em v-if="unreadCount" data-testid="notifications-unread">{{
        unreadCount > 99 ? '99+' : unreadCount
      }}</em>
    </button>
    <div
      v-if="open"
      class="notify-panel"
      data-testid="notifications-panel"
    >
      <header class="notify-header">
        <strong>站内消息</strong>
        <button class="icon-btn" type="button" @click="open = false">×</button>
      </header>
      <div v-if="loading && items.length === 0" class="notify-empty">加载中…</div>
      <div v-else-if="items.length === 0" class="notify-empty">暂无消息</div>
      <ul v-else class="notify-list">
        <li
          v-for="row in items"
          :key="row.id"
          class="notify-item"
          :class="{ unread: !row.readAt }"
          :data-testid="`notification-${row.id}`"
          @click="markRead(row)"
        >
          <div class="notify-title">{{ row.title }}</div>
          <div class="notify-body">{{ row.body }}</div>
          <div class="notify-time">{{ formatTime(row.createdAt) }}</div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.notify-wrap {
  position: relative;
}

.notify-btn {
  position: relative;
}

.notify-btn em {
  display: inline-flex;
  min-width: 16px;
  height: 16px;
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 8px;
  background: #e34d59;
  color: #fff;
  font-size: 11px;
  font-style: normal;
  line-height: 16px;
  justify-content: center;
  align-items: center;
}

.notify-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  width: 340px;
  max-height: 420px;
  overflow: auto;
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14);
  animation: notify-in 0.14s ease;
}

@keyframes notify-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.notify-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid #f0f0f0;
  background: #fafbfc;
  position: sticky;
  top: 0;
}

.notify-header strong {
  font-size: 13px;
  font-weight: 600;
}

.notify-empty {
  padding: 36px 16px;
  color: #8f959e;
  text-align: center;
  font-size: 13px;
}

.notify-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.notify-item {
  padding: 12px 14px;
  border-bottom: 1px solid #f5f6f7;
  cursor: pointer;
  transition: background 0.12s ease;
}

.notify-item:hover {
  background: #f7f8fa;
}

.notify-item.unread {
  background: #f0f7ff;
  box-shadow: inset 3px 0 0 #3370ff;
}

.notify-title {
  font-size: 13px;
  font-weight: 600;
  color: #1f2329;
}

.notify-body {
  margin-top: 4px;
  font-size: 12px;
  color: #646a73;
  line-height: 1.4;
}

.notify-time {
  margin-top: 6px;
  font-size: 11px;
  color: #8f959e;
}

.icon-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  color: #8f959e;
}

.topbar-btn {
  border: 1px solid transparent;
  background: transparent;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #1f2329;
}

.topbar-btn:hover {
  background: #f2f3f5;
}
</style>
