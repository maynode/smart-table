<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { endpoints } from '../api/endpoints';
import { messageOf } from '../api/error-message';
import type { FeedbackDto } from '../api/types';
import ImageLightbox from '../components/ImageLightbox.vue';
import PageLoading from '../components/PageLoading.vue';
import { auth } from '../stores/auth';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';

const router = useRouter();
const statusFilter = ref<'open' | 'done' | 'all'>('open');
const items = ref<FeedbackDto[]>([]);
const loading = ref(true);
const previewImages = ref<string[]>([]);
const previewIndex = ref(0);

function openPreview(urls: string[], index: number): void {
  previewImages.value = urls;
  previewIndex.value = index;
}

function closePreview(): void {
  previewImages.value = [];
  previewIndex.value = 0;
}

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

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await endpoints.listAdminFeedback(statusFilter.value);
    items.value = result.items;
  } catch (error) {
    toast(messageOf(error) || '加载失败');
    if (String(messageOf(error)).includes('系统管理员')) {
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

async function remove(row: FeedbackDto): Promise<void> {
  const ok = await confirmDialog('确定删除这条反馈？删除后无法恢复。', {
    title: '删除反馈',
    confirmLabel: '删除',
    danger: true,
  });
  if (!ok) return;
  try {
    await endpoints.deleteAdminFeedback(row.id);
    items.value = items.value.filter((item) => item.id !== row.id);
    toast('已删除');
  } catch (error) {
    toast(messageOf(error) || '删除失败');
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
  <div class="admin-page" data-testid="admin-feedback-page">
    <div class="admin-page-inner">
      <header class="admin-page-head">
        <div class="admin-page-head-main">
          <h1 class="admin-page-title">系统后台</h1>
          <p class="admin-page-desc">用户反馈 · 仅系统管理员可见</p>
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
        <button type="button" class="admin-tab is-active">反馈后台</button>
        <button
          type="button"
          class="admin-tab"
          @click="router.push('/admin/activity')"
        >
          日志管理
        </button>
      </nav>

      <div class="admin-toolbar">
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
        <span v-if="!loading" class="admin-toolbar-meta">
          共 {{ items.length }} 条
        </span>
      </div>

      <PageLoading v-if="loading" label="加载反馈…" />
      <p v-else-if="!items.length" class="admin-empty">暂无反馈</p>
      <ul v-else class="admin-feedback-list">
        <li v-for="row in items" :key="row.id" class="admin-feedback-card">
          <div class="admin-feedback-meta">
            <strong>{{ row.user?.name || row.user?.account || '匿名' }}</strong>
            <span v-if="row.user?.account" class="muted">{{ row.user.account }}</span>
            <span v-else class="muted">未登录</span>
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
            <button
              v-for="(url, idx) in row.imageUrls"
              :key="`${row.id}-${idx}`"
              type="button"
              class="admin-feedback-image"
              title="预览"
              @click="openPreview(row.imageUrls, idx)"
            >
              <img :src="url" alt="反馈截图" />
            </button>
          </div>
          <p v-if="row.pagePath" class="admin-feedback-path">
            {{ row.pagePath }}
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
            <button
              type="button"
              class="btn btn-ghost"
              data-testid="admin-feedback-delete"
              @click="remove(row)"
            >
              删除
            </button>
          </div>
        </li>
      </ul>

      <ImageLightbox
        v-if="previewImages.length"
        :images="previewImages"
        v-model:index="previewIndex"
        test-id="admin-feedback-image-preview"
        @close="closePreview"
      />
    </div>
  </div>
</template>
