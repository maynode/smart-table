<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { endpoints } from '../api/endpoints';
import type { NotificationDto } from '../api/types';

const router = useRouter();
const items = ref<NotificationDto[]>([]);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const unreadCount = computed(
  () => items.value.filter((row) => !row.readAt).length,
);

async function refresh(): Promise<void> {
  try {
    const result = await endpoints.listNotifications(40);
    items.value = result.notifications;
  } catch {
    // Silent on poll; dedicated page surfaces errors.
  }
}

function openPage(): void {
  void router.push('/notifications');
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
      title="消息"
      aria-label="消息"
      data-testid="notifications-open"
      @click="openPage"
    >
      <span class="notify-icon-wrap">
        <svg
          class="notify-icon"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22Zm7-5.5V11a7 7 0 1 0-14 0v5.5L3 18.5V20h18v-1.5l-2-2Z"
          />
        </svg>
        <i
          v-if="unreadCount"
          class="notify-dot"
          data-testid="notifications-unread"
          :aria-label="`${unreadCount} 条未读`"
        />
      </span>
      <span class="notify-label">消息</span>
    </button>
  </div>
</template>

<style scoped>
.notify-wrap {
  position: relative;
}

.notify-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary, #646a73);
  font: inherit;
  cursor: pointer;
}

.notify-btn:hover {
  color: var(--text, #1f2329);
  background: var(--bg-hover, #f2f3f5);
}

.notify-icon-wrap {
  position: relative;
  display: inline-flex;
  flex: none;
}

.notify-icon {
  display: block;
}

.notify-dot {
  position: absolute;
  top: -1px;
  right: -1px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e34d59;
  box-shadow: 0 0 0 2px #fff;
  pointer-events: none;
}

.notify-label {
  font-size: 13px;
}
</style>
