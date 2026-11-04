<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { endpoints } from '../api/endpoints';
import type { AgentApiTokenDto } from '../api/types';
import { ApiError } from '../api/client';
import { resolveAvatarSrc } from '../utils/avatar';
import { auth } from '../stores/auth';
import { confirmDialog, promptDialog } from '../ui/dialog';
import { toast } from '../ui/toast';

const router = useRouter();

const user = computed(() => auth.state.user);
const avatarSrc = computed(() =>
  resolveAvatarSrc({
    avatarUrl: user.value?.avatarUrl,
    avatarSeed: user.value?.avatarSeed,
  }),
);
const isInstallAdmin = computed(() => Boolean(user.value?.installAdmin));

const tokens = ref<AgentApiTokenDto[]>([]);
const createdToken = ref<string | null>(null);
const mcpSnippet = computed(() => {
  if (!createdToken.value) return '';
  return JSON.stringify(
    {
      mcpServers: {
        'smart-table': {
          command: 'node',
          args: ['apps/mcp/src/index.mjs'],
          env: {
            SMART_TABLE_URL: window.location.origin.replace(/:\d+$/, ':3000'),
            SMART_TABLE_TOKEN: createdToken.value,
          },
        },
      },
    },
    null,
    2,
  );
});

async function loadTokens(): Promise<void> {
  try {
    const res = await endpoints.listAgentTokens();
    tokens.value = res.tokens;
  } catch {
    tokens.value = [];
  }
}

async function createToken(): Promise<void> {
  const name = await promptDialog('创建 MCP 令牌', 'Cursor', {
    message: '令牌名称',
    placeholder: '例如 Cursor',
  });
  if (name === null) return;
  try {
    const created = await endpoints.createAgentToken(name.trim() || 'MCP Token');
    createdToken.value = created.token;
    toast('令牌已创建，请立即复制（仅显示一次）');
    await loadTokens();
  } catch (error) {
    toast(
      error instanceof ApiError
        ? String((error.body as { message?: string })?.message ?? error.message)
        : '创建失败',
    );
  }
}

async function revokeToken(token: AgentApiTokenDto): Promise<void> {
  const ok = await confirmDialog(`确定吊销令牌「${token.name}」？`, {
    title: '吊销令牌',
    confirmLabel: '吊销',
  });
  if (!ok) return;
  try {
    await endpoints.revokeAgentToken(token.id);
    if (createdToken.value?.startsWith(token.prefix)) {
      createdToken.value = null;
    }
    await loadTokens();
    toast('已吊销');
  } catch {
    toast('吊销失败');
  }
}

async function copySnippet(): Promise<void> {
  if (!mcpSnippet.value) return;
  try {
    await navigator.clipboard.writeText(mcpSnippet.value);
    toast('已复制 MCP 配置');
  } catch {
    toast('复制失败，请手动选择');
  }
}

async function signOut(): Promise<void> {
  const ok = await confirmDialog('确定退出当前账号？', {
    title: '退出登录',
    confirmLabel: '退出',
  });
  if (!ok) return;
  auth.signOut();
  await router.push('/login');
}

onMounted(() => {
  void loadTokens();
});
</script>

<template>
  <div class="me-page" data-testid="me-page">
    <header class="me-header">
      <h1>我的</h1>
    </header>

    <section class="me-card me-profile">
      <img
        v-if="avatarSrc"
        class="me-avatar"
        :src="avatarSrc"
        alt=""
        width="56"
        height="56"
      />
      <div v-else class="me-avatar me-avatar-fallback" aria-hidden="true">
        {{ (user?.account ?? '?').slice(0, 1).toUpperCase() }}
      </div>
      <div class="me-profile-text">
        <div class="me-account">{{ user?.account ?? '未登录' }}</div>
        <div class="me-hint">账号与工作区成员管理请在首页工作区中操作</div>
      </div>
    </section>

    <section class="me-card me-links" data-testid="me-mcp-section">
      <h2 class="me-section-title">连接外部助手（MCP）</h2>
      <p class="me-hint">
        签发个人访问令牌后，可在 Cursor / Claude Desktop 通过
        <code>apps/mcp</code> 调用本系统全部工具能力。详见
        <code>docs/AGENT-MCP.md</code>。
      </p>
      <button
        type="button"
        class="me-link touch-target"
        data-testid="me-mcp-create"
        @click="createToken"
      >
        创建 MCP 令牌
      </button>
      <div v-if="createdToken" class="mcp-created">
        <div class="me-hint">明文令牌（仅此一次）：</div>
        <code class="mcp-token" data-testid="me-mcp-token">{{ createdToken }}</code>
        <pre class="mcp-snippet" data-testid="me-mcp-snippet">{{ mcpSnippet }}</pre>
        <button type="button" class="me-link touch-target" @click="copySnippet">
          复制 Cursor 配置
        </button>
      </div>
      <ul v-if="tokens.length" class="token-list">
        <li v-for="token in tokens" :key="token.id" class="token-row">
          <span>{{ token.name }} · {{ token.prefix }}…</span>
          <button type="button" class="token-revoke" @click="revokeToken(token)">
            吊销
          </button>
        </li>
      </ul>
    </section>

    <section v-if="isInstallAdmin" class="me-card me-links">
      <h2 class="me-section-title">管理后台</h2>
      <RouterLink class="me-link touch-target" to="/admin/users"
        >用户管理</RouterLink
      >
      <RouterLink class="me-link touch-target" to="/admin/feedback"
        >反馈</RouterLink
      >
      <RouterLink class="me-link touch-target" to="/admin/activity"
        >活动日志</RouterLink
      >
    </section>

    <section class="me-card">
      <button
        type="button"
        class="me-danger touch-target"
        data-testid="me-sign-out"
        @click="signOut"
      >
        退出登录
      </button>
    </section>
  </div>
</template>

<style scoped>
.me-page {
  max-width: 560px;
  margin: 0 auto;
  padding: 16px;
}
.me-header h1 {
  margin: 0 0 16px;
  font-size: 22px;
}
.me-card {
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}
.me-profile {
  display: flex;
  gap: 12px;
  align-items: center;
}
.me-avatar {
  border-radius: 12px;
  object-fit: cover;
}
.me-avatar-fallback {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  background: #f2f3f5;
  font-weight: 600;
}
.me-account {
  font-weight: 600;
}
.me-hint {
  color: #86909c;
  font-size: 13px;
  margin: 4px 0 8px;
  line-height: 1.4;
}
.me-section-title {
  margin: 0 0 8px;
  font-size: 15px;
}
.me-links {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.me-link {
  display: block;
  text-align: left;
  padding: 10px 0;
  border: none;
  background: transparent;
  color: #165dff;
  cursor: pointer;
  text-decoration: none;
  font: inherit;
}
.me-danger {
  width: 100%;
  border: none;
  background: transparent;
  color: #c45656;
  padding: 12px 0;
  cursor: pointer;
  font: inherit;
}
.mcp-token,
.mcp-snippet {
  display: block;
  width: 100%;
  overflow-x: auto;
  background: #f7f8fa;
  border-radius: 8px;
  padding: 8px;
  font-size: 12px;
  margin: 6px 0;
}
.token-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}
.token-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  border-top: 1px solid #f2f3f5;
  font-size: 13px;
}
.token-revoke {
  border: none;
  background: transparent;
  color: #c45656;
  cursor: pointer;
}
</style>
