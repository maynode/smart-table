<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { endpoints } from '../api/endpoints';
import { messageOf } from '../api/error-message';
import type { FeedbackDto } from '../api/types';
import { auth } from '../stores/auth';
import { toast } from '../ui/toast';

const router = useRouter();
const statusFilter = ref<'open' | 'done' | 'all'>('open');
const items = ref<FeedbackDto[]>([]);
const loading = ref(true);

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
      toast('仅安装管理员可访问');
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

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await endpoints.listAdminFeedback(statusFilter.value);
    items.value = result.items;
  } catch (error) {
    toast(messageOf(error) || '加载失败');
    if (String(messageOf(error)).includes('安装管理员')) {
      void router.replace('/');
    }
  } finally {
    loading.value = false;
  }
}

async function markDone(row: FeedbackDto): Promise<void> {
  try {
    const updated = await endpoints.updateAdminFeedbackStatus(row.id, 'done');
    items.value = items.value.map((item) =>
      item.id === updated.id ? updated : item,
    );
    if (statusFilter.value === 'open') {
      items.value = items.value.filter((item) => item.id !== updated.id);
    }
    toast('已标记完成');
  } catch (error) {
    toast(messageOf(error) || '更新失败');
  }
}

async function reopen(row: FeedbackDto): Promise<void> {
  try {
    const updated = await endpoints.updateAdminFeedbackStatus(row.id, 'open');
    items.value = items.value.map((item) =>
      item.id === updated.id ? updated : item,
    );
    if (statusFilter.value === 'done') {
      items.value = items.value.filter((item) => item.id !== updated.id);
    }
    toast('已重新打开');
  } catch (error) {
    toast(messageOf(error) || '更新失败');
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
  await load();
});

watch(statusFilter, () => {
  void load();
});
</script>

<template>
  <div class="admin-feedback" data-testid="admin-feedback-page">
    <header class="admin-feedback-top">
      <button type="button" class="btn" @click="router.push('/')">返回首页</button>
      <h1>反馈后台</h1>
      <span class="muted">仅安装管理员可见</span>
    </header>

    <div class="admin-feedback-filters">
      <label>
        状态
        <select v-model="statusFilter" data-testid="admin-feedback-filter">
          <option value="open">待处理</option>
          <option value="done">已完成</option>
          <option value="all">全部</option>
        </select>
      </label>
      <button type="button" class="btn" :disabled="loading" @click="load">
        刷新
      </button>
    </div>

    <p v-if="loading" class="muted">加载中…</p>
    <p v-else-if="!items.length" class="muted">暂无反馈</p>
    <ul v-else class="admin-feedback-list">
      <li v-for="row in items" :key="row.id" class="admin-feedback-card">
        <div class="admin-feedback-meta">
          <strong>{{ row.user?.name || row.user?.account || '用户' }}</strong>
          <span class="muted">{{ row.user?.account }}</span>
          <span class="muted">{{ formatTime(row.createdAt) }}</span>
          <span
            class="admin-feedback-status"
            :data-status="row.status"
          >{{ row.status === 'open' ? '待处理' : '已完成' }}</span>
        </div>
        <p v-if="row.content" class="admin-feedback-body">{{ row.content }}</p>
        <div
          v-if="row.imageUrls?.length"
          class="admin-feedback-images"
        >
          <a
            v-for="(url, idx) in row.imageUrls"
            :key="`${row.id}-${idx}`"
            :href="url"
            target="_blank"
            rel="noopener noreferrer"
            class="admin-feedback-image"
          >
            <img :src="url" alt="反馈截图" />
          </a>
        </div>
        <p v-if="row.pagePath" class="muted admin-feedback-path">
          页面：{{ row.pagePath }}
        </p>
        <div class="admin-feedback-actions">
          <button
            v-if="row.status === 'open'"
            type="button"
            class="btn btn-primary"
            @click="markDone(row)"
          >
            标记完成
          </button>
          <button
            v-else
            type="button"
            class="btn"
            @click="reopen(row)"
          >
            重新打开
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
