<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import { copyText } from '../ui/clipboard';
import { rewritePublicUrl } from '../ui/public-url';
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
  const url = rewritePublicUrl(view.url) || view.url;
  const ok = await copyText(url);
  toast(ok ? '链接已复制' : url);
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
  align-items: flex-start;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid #e5e6eb;
}
.panel-header strong {
  font-size: 15px;
  font-weight: 600;
  color: #1f2329;
}
.panel-subtitle {
  margin: 6px 0 0;
  color: #8a9099;
  font-size: 12px;
  line-height: 1.5;
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
  padding: 16px 18px;
  overflow: auto;
}
.public-form {
  border-right: 1px solid #e5e6eb;
  background: #fafbfc;
}
.public-form h4,
.public-list h4 {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: #1f2329;
}
.public-form label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: #646a73;
}
.public-form input {
  height: 34px;
  padding: 0 10px;
  border: 1px solid #d0d3d9;
  border-radius: 7px;
  background: #fff;
  font-size: 13px;
}
.public-form input:focus {
  outline: none;
  border-color: #3370ff;
  box-shadow: 0 0 0 2px rgba(51, 112, 255, 0.12);
}
.public-form .btn-primary {
  margin-top: 6px;
  align-self: stretch;
}
.public-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #eef0f3;
  border-radius: 10px;
  background: #fff;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.public-row:hover {
  border-color: #d0d7e3;
  background: #fafbfc;
}
.public-row strong {
  font-size: 13px;
  font-weight: 600;
  color: #1f2329;
}
.public-row small {
  display: block;
  margin: 4px 0 6px;
  color: #8a9099;
  font-size: 12px;
}
.public-row a {
  color: #2d6cdf;
  font-size: 12px;
  word-break: break-all;
  text-decoration: none;
}
.public-row a:hover {
  text-decoration: underline;
}
.row-actions {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  flex-shrink: 0;
}
.empty-hint {
  margin: 24px 0;
  color: #8a9099;
  font-size: 13px;
  text-align: center;
}
</style>
