<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import { toast } from '../ui/toast';
import type {
  ApiKeyDto,
  WebhookDeliveryDto,
  WebhookDto,
} from '../api/types';

const props = defineProps<{ workspaceId: string }>();
const emit = defineEmits<{ close: [] }>();

const tab = ref<'keys' | 'webhooks'>('keys');
const keys = ref<ApiKeyDto[]>([]);
const hooks = ref<WebhookDto[]>([]);
const deliveries = ref<Record<string, WebhookDeliveryDto[]>>({});
const keyName = ref('服务端集成 Key');
const scopes = ref<'read' | 'write' | 'readwrite'>('readwrite');
const keyToken = ref('');
const webhookUrl = ref('');
const busy = ref(false);

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

async function load(): Promise<void> {
  try {
    const [keyList, hookList] = await Promise.all([
      endpoints.listApiKeys(props.workspaceId),
      endpoints.listWebhooks(props.workspaceId),
    ]);
    keys.value = keyList;
    hooks.value = hookList;
  } catch (error) {
    toast(messageOf(error));
  }
}

async function createKey(): Promise<void> {
  busy.value = true;
  try {
    const created = await endpoints.createApiKey(props.workspaceId, {
      name: keyName.value,
      scopes:
        scopes.value === 'readwrite' ? ['read', 'write'] : [scopes.value],
    });
    keyToken.value = created.token ?? '';
    await load();
    toast('API Key 已创建，请立即保存');
  } catch (error) {
    toast(messageOf(error));
  } finally {
    busy.value = false;
  }
}

async function revokeKey(key: ApiKeyDto): Promise<void> {
  try {
    await endpoints.revokeApiKey(key.id);
    await load();
  } catch (error) {
    toast(messageOf(error));
  }
}

async function createWebhook(): Promise<void> {
  busy.value = true;
  try {
    await endpoints.createWebhook(props.workspaceId, {
      url: webhookUrl.value,
    });
    webhookUrl.value = '';
    await load();
    toast('Webhook 已创建');
  } catch (error) {
    toast(messageOf(error));
  } finally {
    busy.value = false;
  }
}

async function removeWebhook(hook: WebhookDto): Promise<void> {
  try {
    await endpoints.deleteWebhook(hook.id);
    await load();
  } catch (error) {
    toast(messageOf(error));
  }
}

async function loadDeliveries(hook: WebhookDto): Promise<void> {
  try {
    deliveries.value[hook.id] = await endpoints.listWebhookDeliveries(hook.id);
  } catch (error) {
    toast(messageOf(error));
  }
}

async function retry(delivery: WebhookDeliveryDto): Promise<void> {
  try {
    await endpoints.retryWebhookDelivery(delivery.id);
    toast('已重新投递');
  } catch (error) {
    toast(messageOf(error));
  }
}

async function copyToken(): Promise<void> {
  await navigator.clipboard.writeText(keyToken.value).catch(() => undefined);
  toast('已复制');
}

onMounted(load);
</script>

<template>
  <section class="developer-panel" data-testid="developer-panel">
    <header class="dev-header">
      <strong>开发者</strong>
      <button class="icon-btn" data-testid="developer-close" @click="emit('close')">
        ×
      </button>
    </header>

    <nav class="dev-tabs">
      <button :class="{ active: tab === 'keys' }" @click="tab = 'keys'">API Key</button>
      <button :class="{ active: tab === 'webhooks' }" @click="tab = 'webhooks'">
        Webhook
      </button>
    </nav>

    <div v-if="tab === 'keys'" class="dev-body">
      <div class="dev-form">
        <h4>创建 API Key</h4>
        <label>
          名称
          <input v-model="keyName" data-testid="api-key-name" />
        </label>
        <label>
          权限
          <select v-model="scopes" data-testid="api-key-scopes">
            <option value="readwrite">读写</option>
            <option value="read">只读</option>
            <option value="write">只写</option>
          </select>
        </label>
        <button
          class="btn btn-primary"
          :disabled="busy"
          data-testid="api-key-create"
          @click="createKey"
        >
          创建
        </button>
        <div v-if="keyToken" class="token-box" data-testid="api-key-token">
          <p>仅显示一次，请立即保存：</p>
          <code>{{ keyToken }}</code>
          <button class="btn btn-ghost" @click="copyToken">复制</button>
        </div>
      </div>

      <div class="dev-list">
        <h4>已有 Key</h4>
        <div
          v-for="key in keys"
          :key="key.id"
          class="dev-row"
          data-testid="api-key-row"
        >
          <div>
            <strong>{{ key.name }}</strong>
            <small>st_{{ key.prefix }}… · {{ key.scopes.join(', ') }}</small>
            <small>最近使用：{{ key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : '从未' }}</small>
          </div>
          <button
            class="btn btn-danger"
            data-testid="api-key-revoke"
            @click="revokeKey(key)"
          >
            撤销
          </button>
        </div>
        <p v-if="!keys.length" class="empty-hint">暂无 API Key。</p>
      </div>
    </div>

    <div v-else class="dev-body">
      <div class="dev-form">
        <h4>创建 Webhook</h4>
        <label>
          URL
          <input
            v-model="webhookUrl"
            placeholder="https://example.com/hooks/smart-table"
            data-testid="webhook-url"
          />
        </label>
        <p class="hint">事件：record.created / updated / deleted；HMAC-SHA256 签名头 X-SmartTable-Signature。</p>
        <button
          class="btn btn-primary"
          :disabled="busy"
          data-testid="webhook-create"
          @click="createWebhook"
        >
          创建
        </button>
      </div>

      <div class="dev-list">
        <h4>Webhook</h4>
        <div
          v-for="hook in hooks"
          :key="hook.id"
          class="dev-row webhook-row"
          data-testid="webhook-row"
        >
          <div>
            <strong>{{ hook.url }}</strong>
            <small>{{ hook.events.join(', ') }}</small>
          </div>
          <div class="hook-actions">
            <button class="btn btn-ghost" @click="loadDeliveries(hook)">投递记录</button>
            <button class="btn btn-danger" @click="removeWebhook(hook)">删除</button>
          </div>
          <div v-if="deliveries[hook.id]" class="deliveries">
            <div
              v-for="delivery in deliveries[hook.id]"
              :key="delivery.id"
              class="delivery"
              data-testid="webhook-delivery"
            >
              <span :class="['status', delivery.status]">{{ delivery.status }}</span>
              <span>{{ delivery.event }}</span>
              <span>尝试 {{ delivery.attempts }}</span>
              <small v-if="delivery.error">{{ delivery.error }}</small>
              <button
                v-if="delivery.status === 'failed'"
                class="btn btn-ghost"
                @click="retry(delivery)"
              >
                重试
              </button>
            </div>
          </div>
        </div>
        <p v-if="!hooks.length" class="empty-hint">暂无 Webhook。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.developer-panel {
  display: flex;
  flex-direction: column;
  width: min(860px, 94vw);
  height: min(600px, 84vh);
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.24);
}
.dev-header {
  display: flex;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid #e5e6eb;
}
.dev-tabs {
  display: flex;
  gap: 6px;
  padding: 10px 16px;
  border-bottom: 1px solid #eef0f3;
}
.dev-tabs button {
  border: 0;
  background: transparent;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  color: #646a73;
}
.dev-tabs button.active {
  background: #eaf2ff;
  color: #2d6cdf;
}
.dev-body {
  display: grid;
  grid-template-columns: 280px 1fr;
  flex: 1;
  min-height: 0;
}
.dev-form,
.dev-list {
  padding: 16px;
  overflow: auto;
}
.dev-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-right: 1px solid #eef0f3;
  background: #fafbfc;
}
.dev-form h4,
.dev-list h4 {
  margin: 0;
}
.dev-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #646a73;
}
.dev-form input,
.dev-form select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
}
.token-box {
  padding: 8px;
  background: #fff7e6;
  border: 1px solid #ffe0a3;
  border-radius: 8px;
  font-size: 12px;
}
.token-box code {
  display: block;
  word-break: break-all;
  margin: 6px 0;
}
.dev-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border: 1px solid #eef0f3;
  border-radius: 8px;
  margin-bottom: 8px;
}
.dev-row small {
  display: block;
  color: #8a9099;
  font-size: 11px;
  margin-top: 2px;
}
.webhook-row {
  flex-wrap: wrap;
}
.hook-actions {
  display: flex;
  gap: 6px;
  align-items: flex-start;
}
.deliveries {
  flex-basis: 100%;
  border-top: 1px dashed #eef0f3;
  padding-top: 6px;
}
.delivery {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  padding: 3px 0;
  flex-wrap: wrap;
}
.status.success {
  color: #14a44d;
}
.status.failed {
  color: #d92d20;
}
.status.pending {
  color: #b7791f;
}
.hint,
.empty-hint {
  color: #8a9099;
  font-size: 12px;
}
</style>
