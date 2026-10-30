<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { endpoints } from '../api/endpoints';
import { messageOf } from '../api/error-message';
import type { ActivityLogDto } from '../api/types';
import PageLoading from '../components/PageLoading.vue';
import { auth } from '../stores/auth';
import { toast } from '../ui/toast';

const router = useRouter();
const loading = ref(true);
const loadingMore = ref(false);
const items = ref<ActivityLogDto[]>([]);
const nextCursor = ref<string | null>(null);
const q = ref('');
const op = ref('');
const source = ref('');

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
      name: user.name,
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

onMounted(async () => {
  if (!(await ensureAdmin())) return;
  await load(true);
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
