<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { endpoints } from '../api/endpoints';
import { messageOf } from '../api/error-message';
import type {
  ActivityCleanupSettingsDto,
  ActivityLogDto,
} from '../api/types';
import PageLoading from '../components/PageLoading.vue';
import { auth } from '../stores/auth';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';

const router = useRouter();
const loading = ref(true);
const loadingMore = ref(false);
const items = ref<ActivityLogDto[]>([]);
const nextCursor = ref<string | null>(null);
const q = ref('');
const op = ref('');
const source = ref('');
/** datetime-local：起止时间 */
const fromAt = ref('');
const toAt = ref('');
const cleanup = ref<ActivityCleanupSettingsDto | null>(null);
const cleanupBusy = ref(false);
/** 绑定 time input：HH:mm:ss */
const cleanupTime = ref('02:00:00');
const nextRunAt = ref('');
const deleteBefore = ref('');
let previewTimer: ReturnType<typeof setTimeout> | null = null;

function formatCleanupTime(s: ActivityCleanupSettingsDto): string {
  const hh = String(s.hour ?? 2).padStart(2, '0');
  const mm = String(s.minute ?? 0).padStart(2, '0');
  const ss = String(s.second ?? 0).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const OP_LABEL: Record<string, string> = {
  create: '增',
  update: '改',
  delete: '删',
  read: '查',
  other: '其它',
};

const SOURCE_LABEL: Record<string, string> = {
  api: '接口',
  client: '页面',
  collab: '协同',
};

async function ensureAdmin(): Promise<boolean> {
  try {
    const user = await endpoints.me();
    auth.updateUser({
      id: user.id,
      account: user.account,
      avatarSeed: user.avatarSeed,
      avatarUrl: user.avatarUrl,
      installAdmin: user.installAdmin,
    });
    if (!user.installAdmin) {
      toast('仅系统管理员可访问');
      void router.replace('/');
      return false;
    }
    return true;
  } catch (error) {
    toast(messageOf(error) || '无法验证权限');
    void router.replace('/');
    return false;
  }
}

async function load(reset = true): Promise<void> {
  if (reset) {
    loading.value = true;
    nextCursor.value = null;
  } else {
    loadingMore.value = true;
  }
  try {
    const result = await endpoints.listAdminActivityLogs({
      q: q.value.trim() || undefined,
      op: op.value || undefined,
      source: source.value || undefined,
      from: fromAt.value ? new Date(fromAt.value).toISOString() : undefined,
      to: toAt.value ? new Date(toAt.value).toISOString() : undefined,
      limit: 50,
      cursor: reset ? undefined : nextCursor.value || undefined,
    });
    items.value = reset ? result.items : [...items.value, ...result.items];
    nextCursor.value = result.nextCursor;
  } catch (error) {
    toast(messageOf(error) || '加载失败');
    if (String(messageOf(error)).includes('系统管理员')) {
      void router.replace('/');
    }
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

async function loadCleanup(previewOnly = false): Promise<void> {
  try {
    const result = await endpoints.getActivityCleanupSettings(
      cleanup.value
        ? {
            dayOfMonth: cleanup.value.dayOfMonth,
            time: cleanupTime.value || '02:00:00',
            retentionMonths: cleanup.value.retentionMonths,
          }
        : undefined,
    );
    if (!previewOnly) {
      cleanup.value = result.settings;
      cleanupTime.value = formatCleanupTime(result.settings);
    }
    nextRunAt.value = result.nextRunAt;
    deleteBefore.value = result.deleteBefore;
  } catch (error) {
    if (!previewOnly) toast(messageOf(error) || '加载清理设置失败');
  }
}

function schedulePreview(): void {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    void loadCleanup(true);
  }, 250);
}

async function saveCleanup(): Promise<void> {
  if (!cleanup.value || cleanupBusy.value) return;
  cleanupBusy.value = true;
  try {
    cleanup.value = await endpoints.updateActivityCleanupSettings({
      enabled: cleanup.value.enabled,
      dayOfMonth: cleanup.value.dayOfMonth,
      time: cleanupTime.value || '02:00:00',
      retentionMonths: cleanup.value.retentionMonths,
    });
    cleanupTime.value = formatCleanupTime(cleanup.value);
    await loadCleanup(true);
    toast('清理设置已保存');
  } catch (error) {
    toast(messageOf(error) || '保存失败');
  } finally {
    cleanupBusy.value = false;
  }
}

watch(
  () => [
    cleanup.value?.dayOfMonth,
    cleanup.value?.retentionMonths,
    cleanupTime.value,
  ],
  () => {
    if (!cleanup.value) return;
    schedulePreview();
  },
);

async function runCleanupNow(): Promise<void> {
  if (cleanupBusy.value) return;
  const ok = await confirmDialog(
    '立即按当前保留策略删除过期操作日志？此操作不可恢复。',
    { title: '手动清理', confirmLabel: '清理', danger: true },
  );
  if (!ok) return;
  cleanupBusy.value = true;
  try {
    const result = await endpoints.runActivityCleanup();
    toast(`已删除 ${result.deleted} 条`);
    await loadCleanup();
    await load(true);
  } catch (error) {
    toast(messageOf(error) || '清理失败');
  } finally {
    cleanupBusy.value = false;
  }
}

onMounted(async () => {
  if (!(await ensureAdmin())) return;
  await Promise.all([load(true), loadCleanup()]);
});
</script>

<template>
  <div class="admin-page" data-testid="admin-activity-page">
    <div class="admin-page-inner">
      <header class="admin-page-head">
        <div class="admin-page-head-main">
          <h1 class="admin-page-title">系统后台</h1>
          <p class="admin-page-desc">操作日志 · 前台增删改查一目了然</p>
        </div>
        <div class="admin-page-head-actions">
          <button type="button" class="btn btn-ghost" @click="router.push('/')">
            返回首页
          </button>
        </div>
      </header>

      <nav class="admin-tabs" aria-label="后台导航">
        <button
          type="button"
          class="admin-tab"
          @click="router.push('/admin/users')"
        >
          用户管理
        </button>
        <button
          type="button"
          class="admin-tab"
          @click="router.push('/admin/feedback')"
        >
          反馈后台
        </button>
        <button type="button" class="admin-tab is-active">日志管理</button>
      </nav>

      <section
        v-if="cleanup"
        class="admin-cleanup-card"
        data-testid="admin-activity-cleanup"
      >
        <div class="admin-cleanup-head">
          <strong>定时清理</strong>
          <span class="muted">按上海时间调度；改完设置后看下方说明</span>
        </div>
        <div class="admin-cleanup-grid">
          <label class="admin-cleanup-check">
            <input v-model="cleanup.enabled" type="checkbox" />
            启用定时清理
          </label>
          <label>
            每月几号
            <input
              v-model.number="cleanup.dayOfMonth"
              type="number"
              min="1"
              max="28"
            />
          </label>
          <label>
            开始时间
            <input
              v-model="cleanupTime"
              type="time"
              step="1"
              data-testid="admin-activity-cleanup-time"
            />
          </label>
          <label>
            保留月数
            <input
              v-model.number="cleanup.retentionMonths"
              type="number"
              min="1"
              max="120"
            />
          </label>
        </div>
        <div class="admin-cleanup-explain" data-testid="admin-activity-cleanup-explain">
          <p>
            <span class="admin-cleanup-label">下一次清理时间</span>
            {{ cleanup.enabled ? formatTime(nextRunAt) || '—' : '已关闭' }}
          </p>
          <p>
            <span class="admin-cleanup-label">将清理</span>
            {{
              deleteBefore
                ? `${formatTime(deleteBefore)} 及之前的日志`
                : '—'
            }}
          </p>
          <p v-if="cleanup.lastRunAt" class="muted">
            上次清理 {{ formatTime(cleanup.lastRunAt) }}（删
            {{ cleanup.lastDeleted }} 条）
          </p>
        </div>
        <div class="admin-cleanup-actions">
          <button
            type="button"
            class="btn btn-primary"
            :disabled="cleanupBusy"
            @click="saveCleanup"
          >
            保存设置
          </button>
          <button
            type="button"
            class="btn"
            :disabled="cleanupBusy"
            data-testid="admin-activity-cleanup-run"
            @click="runCleanupNow"
          >
            立即清理
          </button>
        </div>
      </section>

      <div class="admin-toolbar">
        <label>
          搜索
          <input
            v-model="q"
            type="search"
            placeholder="用户 / 摘要 / 动作"
            data-testid="admin-activity-search"
            @keydown.enter="load(true)"
          />
        </label>
        <label>
          开始时间
          <input
            v-model="fromAt"
            type="datetime-local"
            data-testid="admin-activity-from"
          />
        </label>
        <label>
          结束时间
          <input
            v-model="toAt"
            type="datetime-local"
            data-testid="admin-activity-to"
          />
        </label>
        <label>
          类型
          <select v-model="op" data-testid="admin-activity-op">
            <option value="">全部</option>
            <option value="create">增</option>
            <option value="update">改</option>
            <option value="delete">删</option>
            <option value="read">查</option>
            <option value="other">其它</option>
          </select>
        </label>
        <label>
          来源
          <select v-model="source" data-testid="admin-activity-source">
            <option value="">全部</option>
            <option value="api">接口</option>
            <option value="client">页面</option>
            <option value="collab">协同</option>
          </select>
        </label>
        <button type="button" class="btn" :disabled="loading" @click="load(true)">
          查询
        </button>
        <button
          v-if="fromAt || toAt"
          type="button"
          class="btn btn-ghost"
          :disabled="loading"
          @click="fromAt = ''; toAt = ''; load(true)"
        >
          清除时间
        </button>
        <span v-if="!loading" class="admin-toolbar-meta">
          本页 {{ items.length }} 条
        </span>
      </div>

      <PageLoading v-if="loading" label="加载日志…" />
      <p v-else-if="!items.length" class="admin-empty">暂无操作日志</p>
      <div v-else class="admin-activity-list" data-testid="admin-activity-list">
        <article
          v-for="row in items"
          :key="row.id"
          class="admin-activity-row"
        >
          <div class="admin-activity-main">
            <div class="admin-activity-summary">{{ row.summary }}</div>
            <div class="admin-activity-meta">
              <span
                class="admin-activity-op"
                :data-op="row.op"
              >{{ OP_LABEL[row.op] || row.op }}</span>
              <span class="muted">{{ SOURCE_LABEL[row.source] || row.source }}</span>
              <span class="muted">{{ row.actorAccount || '—' }}</span>
              <span v-if="row.method" class="muted">{{ row.method }}</span>
              <span v-if="row.path" class="admin-activity-path" :title="row.path">
                {{ row.path }}
              </span>
            </div>
          </div>
          <time class="admin-activity-time">{{ formatTime(row.createdAt) }}</time>
        </article>
        <div v-if="nextCursor" class="admin-activity-more">
          <button
            type="button"
            class="btn"
            :disabled="loadingMore"
            data-testid="admin-activity-more"
            @click="load(false)"
          >
            {{ loadingMore ? '加载中…' : '加载更多' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
