<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { endpoints } from '../api/endpoints';
import type { NotificationDto } from '../api/types';
import PageLoading from '../components/PageLoading.vue';
import { resolveNotificationLink } from '../notifications/notification-link';
import { liveBus } from '../sync/live-bus';
import { liveSocket } from '../sync/live-socket';
import { renderSimpleMarkdown } from '../ui/simple-markdown';
import { toast } from '../ui/toast';

const router = useRouter();
const loading = ref(false);
const markingAll = ref(false);
const opening = ref(false);
const items = ref<NotificationDto[]>([]);
const detail = ref<NotificationDto | null>(null);

const unreadCount = computed(
  () => items.value.filter((row) => !row.readAt).length,
);

const detailHtml = computed(() =>
  detail.value ? renderSimpleMarkdown(detail.value.body || '') : '',
);

function isSystemMessage(row: NotificationDto): boolean {
  const kind = typeof row.data?.kind === 'string' ? row.data.kind : '';
  return kind === 'admin.message' || row.title === '系统消息';
}

/** 列表单行摘要：去掉 MD 标记后压成一行 */
function bodySummary(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

async function refresh(): Promise<void> {
  loading.value = true;
  const cacheKey = 'notifications:list';
  try {
    const result = await endpoints.listNotifications(100);
    items.value = result.notifications;
    const { localDb } = await import('../sync/local-db-client');
    void localDb.putObjectCache(cacheKey, 'notifications', items.value);
  } catch (error) {
    try {
      const { localDb } = await import('../sync/local-db-client');
      const cached = (await localDb.getObjectCache(cacheKey)) as
        | NotificationDto[]
        | null;
      if (cached?.length) {
        items.value = cached;
        toast('已从离线缓存打开消息');
      } else {
        toast(error instanceof Error ? error.message : '加载消息失败');
      }
    } catch {
      toast(error instanceof Error ? error.message : '加载消息失败');
    }
  } finally {
    loading.value = false;
  }
}

async function markRead(row: NotificationDto): Promise<void> {
  if (row.readAt) return;
  try {
    if (!navigator.onLine) {
      const { enqueueObjectMutation } = await import('../sync/object-outbox');
      const { localDb } = await import('../sync/local-db-client');
      row.readAt = new Date().toISOString();
      await enqueueObjectMutation({
        type: 'notification.read',
        notificationId: row.id,
      });
      void localDb.putObjectCache('notifications:list', 'notifications', [
        ...items.value,
      ]);
      return;
    }
    await endpoints.markNotificationRead(row.id);
    row.readAt = new Date().toISOString();
  } catch (error) {
    toast(error instanceof Error ? error.message : '标记已读失败');
  }
}

async function openDetail(row: NotificationDto): Promise<void> {
  detail.value = row;
  await markRead(row);
}

function closeDetail(): void {
  detail.value = null;
}

async function openNotification(row: NotificationDto): Promise<void> {
  if (opening.value) return;
  if (isSystemMessage(row)) {
    await openDetail(row);
    return;
  }
  opening.value = true;
  try {
    await markRead(row);
    const result = await resolveNotificationLink(row.data);
    if (result.status === 'none') {
      // 无可跳转目标时改为弹窗看全文
      detail.value = row;
      return;
    }
    if (result.status === 'unavailable') {
      toast(result.message);
      if (!result.fallback) {
        detail.value = row;
        return;
      }
      await router.push({
        path: result.fallback.path,
        query: result.fallback.query,
      });
      return;
    }
    await router.push({
      path: result.route.path,
      query: result.route.query,
    });
  } catch (error) {
    toast(error instanceof Error ? error.message : '打开消息失败');
  } finally {
    opening.value = false;
  }
}

function canNavigate(row: NotificationDto): boolean {
  const data = row.data ?? {};
  const kind = typeof data.kind === 'string' ? data.kind : '';
  if (kind === 'workspace_member_removed') return true;
  if (
    kind === 'workspace_member_added' ||
    kind === 'workspace_member_role_changed'
  ) {
    return true;
  }
  return Boolean(
    data.baseId ||
      data.sheetId ||
      data.dashboardId ||
      data.workspaceId ||
      data.objectId,
  );
}

async function markAllRead(): Promise<void> {
  if (unreadCount.value === 0 || markingAll.value) return;
  markingAll.value = true;
  try {
    const now = new Date().toISOString();
    if (!navigator.onLine) {
      const { enqueueObjectMutation } = await import('../sync/object-outbox');
      const { localDb } = await import('../sync/local-db-client');
      items.value = items.value.map((row) =>
        row.readAt ? row : { ...row, readAt: now },
      );
      await enqueueObjectMutation({ type: 'notification.readAll' });
      void localDb.putObjectCache(
        'notifications:list',
        'notifications',
        items.value,
      );
      toast('离线已全部标为已读，联网后同步');
      return;
    }
    await endpoints.markAllNotificationsRead();
    items.value = items.value.map((row) =>
      row.readAt ? row : { ...row, readAt: now },
    );
    toast('已全部标为已读');
  } catch (error) {
    toast(error instanceof Error ? error.message : '一键已读失败');
  } finally {
    markingAll.value = false;
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function goBack(): void {
  if (window.history.length > 1) {
    router.back();
    return;
  }
  void router.push('/');
}

const liveUnsubs: Array<() => void> = [];

onMounted(() => {
  liveSocket.connect({ userOnly: true });
  liveUnsubs.push(
    liveBus.on('notification.created', () => {
      void refresh();
    }),
    liveBus.on('notification.read', () => {
      void refresh();
    }),
  );
  void refresh();
});

onBeforeUnmount(() => {
  while (liveUnsubs.length) liveUnsubs.pop()?.();
  liveSocket.disconnect();
});
</script>

<template>
  <div class="notify-page" data-testid="notifications-page">
    <header class="notify-topbar">
      <button
        class="back-btn"
        type="button"
        data-testid="notifications-back"
        @click="goBack"
      >
        ← 返回
      </button>
      <h1>消息</h1>
      <div class="topbar-right">
        <span v-if="unreadCount > 0" class="unread-hint">
          {{ unreadCount }} 条未读
        </span>
        <span v-else class="unread-hint muted">全部已读</span>
        <button
          class="mark-all-btn"
          type="button"
          data-testid="notifications-mark-all"
          :disabled="unreadCount === 0 || markingAll"
          @click="markAllRead"
        >
          {{ markingAll ? '处理中…' : '一键已读' }}
        </button>
      </div>
    </header>

    <main class="notify-main">
      <PageLoading
        v-if="loading && items.length === 0"
        label="加载消息…"
      />
      <div v-else-if="items.length === 0" class="notify-empty">暂无消息</div>
      <ul v-else class="notify-list">
        <li
          v-for="row in items"
          :key="row.id"
          class="notify-item"
          :class="{
            unread: !row.readAt,
            linkable: canNavigate(row) || isSystemMessage(row),
          }"
          :data-testid="`notification-${row.id}`"
          @click="openNotification(row)"
        >
          <div class="notify-item-main">
            <div class="notify-title">
              <i v-if="!row.readAt" class="unread-dot" aria-hidden="true" />
              {{ row.title }}
            </div>
            <div class="notify-body notify-body-one-line">
              {{ bodySummary(row.body || '') || '（无正文）' }}
            </div>
          </div>
          <div class="notify-meta">
            <div class="notify-time">{{ formatTime(row.createdAt) }}</div>
            <button
              type="button"
              class="notify-go"
              data-testid="notification-view"
              @click.stop="
                isSystemMessage(row) || !canNavigate(row)
                  ? openDetail(row)
                  : openNotification(row)
              "
            >
              {{ canNavigate(row) && !isSystemMessage(row) ? '查看 →' : '查看' }}
            </button>
          </div>
        </li>
      </ul>
    </main>

    <Teleport to="body">
      <div
        v-if="detail"
        class="notify-detail-mask"
        data-testid="notification-detail"
        @click.self="closeDetail"
      >
        <section class="notify-detail-panel" role="dialog" aria-modal="true">
          <header class="notify-detail-head">
            <div>
              <h3>{{ detail.title }}</h3>
              <p class="muted">{{ formatTime(detail.createdAt) }}</p>
            </div>
            <button
              type="button"
              class="notify-detail-close"
              aria-label="关闭"
              @click="closeDetail"
            >
              ×
            </button>
          </header>
          <div class="notify-detail-body md-body" v-html="detailHtml" />
          <footer class="notify-detail-foot">
            <button type="button" class="btn btn-primary" @click="closeDetail">
              知道了
            </button>
          </footer>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.notify-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f6f8;
}

.notify-topbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 20px;
  background: #fff;
  border-bottom: 1px solid var(--border, #e5e6eb);
}

.back-btn {
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary, #646a73);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.back-btn:hover {
  background: var(--bg-hover, #f2f3f5);
  color: var(--text, #1f2329);
}

.notify-topbar h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.topbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.unread-hint {
  font-size: 12px;
  color: var(--brand-strong, #1a6dcc);
}

.unread-hint.muted {
  color: var(--text-tertiary, #8f959e);
}

.mark-all-btn {
  height: 30px;
  padding: 0 12px;
  border: 1px solid #d0d3d9;
  border-radius: 8px;
  background: #fff;
  color: var(--text, #1f2329);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.mark-all-btn:hover:not(:disabled) {
  border-color: var(--brand, #2d8cf0);
  color: var(--brand-strong, #1a6dcc);
  background: #f3f8ff;
}

.mark-all-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.notify-main {
  flex: 1;
  width: min(720px, 100%);
  margin: 0 auto;
  padding: 20px 16px 40px;
}

.notify-empty {
  margin-top: 64px;
  text-align: center;
  color: var(--text-tertiary, #8f959e);
  font-size: 14px;
}

.notify-list {
  list-style: none;
  margin: 0;
  padding: 0;
  background: #fff;
  border: 1px solid var(--border, #e5e6eb);
  border-radius: 12px;
  overflow: hidden;
}

.notify-item {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 16px 18px;
  border-bottom: 1px solid #eef0f3;
  cursor: pointer;
  transition: background 0.12s ease;
}

.notify-item:last-child {
  border-bottom: 0;
}

.notify-item:hover {
  background: #f7f8fa;
}

.notify-item.linkable:hover .notify-go {
  color: var(--brand-strong, #1a6dcc);
}

.notify-item.unread {
  background: #f7fbff;
}

.notify-item-main {
  min-width: 0;
  flex: 1;
}

.notify-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text, #1f2329);
  line-height: 1.4;
}

.unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e34d59;
  flex: none;
}

.notify-body {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-secondary, #646a73);
  line-height: 1.55;
  word-break: break-word;
}

.notify-body-one-line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notify-meta {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  margin-top: 2px;
}

.notify-time {
  font-size: 12px;
  color: var(--text-tertiary, #8f959e);
  white-space: nowrap;
}

.notify-go {
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  font-size: 12px;
  color: var(--brand, #2d8cf0);
  white-space: nowrap;
  cursor: pointer;
}

.notify-item:hover .notify-go {
  color: var(--brand-strong, #1a6dcc);
}

.notify-detail-mask {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.4);
}

.notify-detail-panel {
  width: min(560px, 100%);
  max-height: min(80vh, 720px);
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 12px;
  border: 1px solid var(--border, #e5e6eb);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
  padding: 16px;
}

.notify-detail-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.notify-detail-head h3 {
  margin: 0;
  font-size: 16px;
}

.notify-detail-head .muted {
  margin: 4px 0 0;
  font-size: 12px;
}

.notify-detail-close {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 20px;
  color: var(--text-secondary, #646a73);
  cursor: pointer;
}

.notify-detail-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 2px 12px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text, #1f2329);
}

.notify-detail-body :deep(p) {
  margin: 0 0 0.55em;
}

.notify-detail-body :deep(p:last-child) {
  margin-bottom: 0;
}

.notify-detail-body :deep(ul),
.notify-detail-body :deep(ol) {
  margin: 0.3em 0 0.55em;
  padding-left: 1.3em;
}

.notify-detail-body :deep(a) {
  color: var(--brand, #2d8cf0);
}

.notify-detail-body :deep(code) {
  padding: 0 4px;
  border-radius: 4px;
  background: #f2f3f5;
  font-size: 12px;
}

.notify-detail-foot {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}

@media (max-width: 640px) {
  .notify-item {
    flex-direction: column;
    gap: 8px;
  }

  .notify-meta {
    margin-top: 0;
    flex-direction: row;
    align-items: center;
    width: 100%;
    justify-content: space-between;
  }
}
</style>
