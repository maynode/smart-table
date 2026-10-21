<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import { toast } from '../ui/toast';
import type { PublicViewDto } from '../api/types';

const props = defineProps<{ sheetId: string }>();
const emit = defineEmits<{ close: [] }>();

const views = ref<PublicViewDto[]>([]);
const name = ref('只读数据视图');
const password = ref('');
const expiresAt = ref('');
const loading = ref(false);

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    views.value = await endpoints.listPublicViews(props.sheetId);
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

async function create(): Promise<void> {
  try {
    const expires = expiresAt.value
      ? new Date(`${expiresAt.value}T23:59:59`).toISOString()
      : null;
    await endpoints.createPublicView(props.sheetId, {
      name: name.value,
      password: password.value || undefined,
      expiresAt: expires,
    });
    password.value = '';
    await load();
    toast('公开只读链接已创建');
  } catch (error) {
    toast(messageOf(error));
  }
}

async function revoke(view: PublicViewDto): Promise<void> {
  try {
    await endpoints.revokePublicView(view.id);
    await load();
    toast('公开链接已撤销');
  } catch (error) {
    toast(messageOf(error));
  }
}

async function copy(view: PublicViewDto): Promise<void> {
  try {
    await navigator.clipboard.writeText(view.url);
    toast('链接已复制');
  } catch {
    toast(view.url);
  }
}

onMounted(load);
</script>

<template>
  <section class="public-panel" data-testid="public-view-panel">
    <header class="panel-header">
      <div>
        <strong>公开只读视图</strong>
        <p class="panel-subtitle">
          任何人可通过链接查看，不能编辑；可设置密码与有效期。
        </p>
      </div>
      <button
        class="icon-btn"
        data-testid="public-view-close"
        @click="emit('close')"
      >
        ×
      </button>
    </header>

    <div class="public-body">
      <div class="public-form">
        <h4>新建链接</h4>
        <label>
          名称
          <input v-model="name" data-testid="public-view-name" />
        </label>
        <label>
          访问密码（可选）
          <input
            v-model="password"
            type="password"
            placeholder="至少 4 位"
            data-testid="public-view-password"
          />
        </label>
        <label>
          有效期（可选）
          <input v-model="expiresAt" type="date" data-testid="public-view-expiry" />
        </label>
        <button
          class="btn btn-primary"
          data-testid="public-view-create"
          @click="create"
        >
          创建公开链接
        </button>
      </div>

      <div class="public-list">
        <h4>已创建</h4>
        <div
          v-for="view in views"
          :key="view.id"
          class="public-row"
          data-testid="public-view-row"
        >
          <div>
            <strong>{{ view.name }}</strong>
            <small>
              {{ view.passwordRequired ? '密码保护' : '无密码' }}
              <template v-if="view.expiresAt">
                · 至 {{ new Date(view.expiresAt).toLocaleDateString() }}
              </template>
            </small>
            <a :href="view.url" target="_blank" rel="noreferrer">{{ view.url }}</a>
          </div>
          <div class="row-actions">
            <button class="btn btn-ghost" data-testid="public-view-copy" @click="copy(view)">
              复制
            </button>
            <button class="btn btn-danger" data-testid="public-view-revoke" @click="revoke(view)">
              撤销
            </button>
          </div>
        </div>
        <p v-if="!views.length && !loading" class="empty-hint">暂无公开链接。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.public-panel {
  display: flex;
  flex-direction: column;
  width: min(780px, 94vw);
  height: min(560px, 82vh);
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.24);
}
.panel-header {
  display: flex;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #e5e6eb;
}
.panel-subtitle {
  margin: 4px 0 0;
  color: #8a9099;
  font-size: 12px;
}
.public-body {
  display: grid;
  grid-template-columns: 260px 1fr;
  flex: 1;
  min-height: 0;
}
.public-form,
.public-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  overflow: auto;
}
.public-form {
  border-right: 1px solid #e5e6eb;
  background: #fafbfc;
}
.public-form h4,
.public-list h4 {
  margin: 0 0 4px;
}
.public-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #646a73;
}
.public-form input {
  height: 32px;
  padding: 0 8px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
}
.public-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px;
  border: 1px solid #eef0f3;
  border-radius: 8px;
}
.public-row small {
  display: block;
  margin: 3px 0;
  color: #8a9099;
}
.public-row a {
  color: #2d6cdf;
  font-size: 12px;
  word-break: break-all;
}
.row-actions {
  display: flex;
  gap: 6px;
  align-items: flex-start;
}
.empty-hint {
  color: #8a9099;
  font-size: 12px;
}
</style>
