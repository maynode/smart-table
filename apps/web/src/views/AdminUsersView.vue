<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { endpoints } from '../api/endpoints';
import { messageOf } from '../api/error-message';
import type { AdminUserDto } from '../api/types';
import AdminMessageDialog from '../components/AdminMessageDialog.vue';
import PageLoading from '../components/PageLoading.vue';
import { auth } from '../stores/auth';
import { confirmDialog } from '../ui/dialog';
import { toast } from '../ui/toast';

const router = useRouter();
const items = ref<AdminUserDto[]>([]);
const loading = ref(true);
const query = ref('');
const busyId = ref<string | null>(null);
const messageTarget = ref<AdminUserDto | null>(null);
const messageBusy = ref(false);

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
    const result = await endpoints.listAdminUsers(query.value.trim() || undefined);
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

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

async function impersonate(row: AdminUserDto): Promise<void> {
  if (row.blacklistedAt) {
    toast('该用户在黑名单中，请先移出');
    return;
  }
  const ok = await confirmDialog(
    `确定以「${row.account}」身份登录？当前管理员会话将被替换。`,
    {
      title: '模拟登录',
      confirmLabel: '进入',
      danger: false,
    },
  );
  if (!ok) return;
  busyId.value = row.id;
  try {
    const result = await endpoints.impersonateAdminUser(row.id);
    auth.startImpersonation(result.accessToken, {
      id: result.user.id,
      account: result.user.account,
      name: result.user.name,
      avatarSeed: result.user.avatarSeed,
      avatarUrl: result.user.avatarUrl,
      installAdmin: result.user.installAdmin,
    });
    toast(`已模拟登录为 ${result.user.account}`);
    void router.replace('/');
  } catch (error) {
    toast(messageOf(error) || '模拟登录失败');
  } finally {
    busyId.value = null;
  }
}

async function toggleBlacklist(row: AdminUserDto): Promise<void> {
  const into = !row.blacklistedAt;
  const ok = await confirmDialog(
    into
      ? `确定将「${row.account}」加入黑名单？加入后无法登录。`
      : `确定将「${row.account}」移出黑名单？`,
    {
      title: into ? '加入黑名单' : '移出黑名单',
      confirmLabel: into ? '加入' : '移出',
      danger: into,
    },
  );
  if (!ok) return;
  busyId.value = row.id;
  try {
    const updated = await endpoints.setAdminUserBlacklist(row.id, into);
    items.value = items.value.map((item) =>
      item.id === updated.id ? updated : item,
    );
    toast(into ? '已加入黑名单' : '已移出黑名单');
  } catch (error) {
    toast(messageOf(error) || '操作失败');
  } finally {
    busyId.value = null;
  }
}

function isLoginLocked(row: AdminUserDto): boolean {
  if (!row.loginLockedUntil) return false;
  return new Date(row.loginLockedUntil).getTime() > Date.now();
}

async function unlockLogin(row: AdminUserDto): Promise<void> {
  if (!isLoginLocked(row)) return;
  const ok = await confirmDialog(`确定解除「${row.account}」的登录锁定？`, {
    title: '解除登录锁定',
    confirmLabel: '解锁',
    danger: false,
  });
  if (!ok) return;
  busyId.value = row.id;
  try {
    const updated = await endpoints.unlockAdminUserLogin(row.id);
    items.value = items.value.map((item) =>
      item.id === updated.id ? { ...item, ...updated } : item,
    );
    toast('已解除登录锁定');
  } catch (error) {
    toast(messageOf(error) || '解锁失败');
  } finally {
    busyId.value = null;
  }
}

function openMessage(row: AdminUserDto): void {
  messageTarget.value = row;
}

function closeMessage(): void {
  if (messageBusy.value) return;
  messageTarget.value = null;
}

async function submitMessage(content: string): Promise<void> {
  const row = messageTarget.value;
  if (!row) return;
  messageBusy.value = true;
  busyId.value = row.id;
  try {
    await endpoints.sendAdminUserMessage(row.id, content);
    toast('已发送');
    messageTarget.value = null;
  } catch (error) {
    toast(messageOf(error) || '发送失败');
  } finally {
    messageBusy.value = false;
    busyId.value = null;
  }
}

onMounted(async () => {
  if (!(await ensureAdmin())) return;
  await load();
});
</script>

<template>
  <div class="admin-page" data-testid="admin-users-page">
    <div class="admin-page-inner">
      <header class="admin-page-head">
        <div class="admin-page-head-main">
          <h1 class="admin-page-title">系统后台</h1>
          <p class="admin-page-desc">用户管理 · 仅系统管理员可见</p>
        </div>
        <div class="admin-page-head-actions">
          <button type="button" class="btn btn-ghost" @click="router.push('/')">
            返回首页
          </button>
        </div>
      </header>

      <nav class="admin-tabs" aria-label="后台导航">
        <button type="button" class="admin-tab is-active">用户管理</button>
        <button
          type="button"
          class="admin-tab"
          @click="router.push('/admin/feedback')"
        >
          反馈后台
        </button>
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
          搜索用户
          <input
            v-model="query"
            type="search"
            placeholder="输入用户名后回车"
            data-testid="admin-users-search"
            @keydown.enter="load"
          />
        </label>
        <button type="button" class="btn" :disabled="loading" @click="load">
          查询
        </button>
        <span v-if="!loading" class="admin-toolbar-meta">
          共 {{ items.length }} 人
        </span>
      </div>

      <PageLoading v-if="loading" label="加载用户…" />
      <p v-else-if="!items.length" class="admin-empty">暂无用户</p>
      <div v-else class="admin-users-table-wrap">
        <table class="admin-users-table" data-testid="admin-users-table">
          <thead>
            <tr>
              <th class="col-index">序号</th>
              <th>用户名</th>
              <th>注册时间</th>
              <th class="col-num">工作区</th>
              <th class="col-num">智能表</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, index) in items"
              :key="row.id"
              :data-blacklisted="Boolean(row.blacklistedAt)"
            >
              <td class="col-index">{{ index + 1 }}</td>
              <td>
                <div class="admin-users-name">
                  <strong>{{ row.account }}</strong>
                  <span v-if="row.blacklistedAt" class="admin-users-tag">黑名单</span>
                  <span
                    v-if="isLoginLocked(row)"
                    class="admin-users-tag"
                  >登录锁定</span>
                  <span
                    v-if="row.installAdmin"
                    class="admin-users-tag admin"
                  >系统管理员</span>
                </div>
              </td>
              <td class="col-time">{{ formatTime(row.createdAt) }}</td>
              <td class="col-num">{{ row.workspaceCount }}</td>
              <td class="col-num">{{ row.baseCount }}</td>
              <td>
                <div class="admin-users-actions">
                  <button
                    type="button"
                    class="btn"
                    :disabled="busyId === row.id || Boolean(row.blacklistedAt)"
                    @click="impersonate(row)"
                  >
                    模拟登录
                  </button>
                  <button
                    type="button"
                    class="btn"
                    :disabled="busyId === row.id"
                    @click="openMessage(row)"
                  >
                    发消息
                  </button>
                  <button
                    v-if="isLoginLocked(row)"
                    type="button"
                    class="btn"
                    :disabled="busyId === row.id"
                    data-testid="admin-users-unlock"
                    @click="unlockLogin(row)"
                  >
                    解锁登录
                  </button>
                  <button
                    type="button"
                    class="btn"
                    :class="row.blacklistedAt ? 'btn-ghost' : 'btn-danger'"
                    :disabled="busyId === row.id || row.installAdmin"
                    @click="toggleBlacklist(row)"
                  >
                    {{ row.blacklistedAt ? '移出黑名单' : '加入黑名单' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <AdminMessageDialog
        :open="Boolean(messageTarget)"
        :account="messageTarget?.account ?? ''"
        :busy="messageBusy"
        @close="closeMessage"
        @send="submitMessage"
      />
    </div>
  </div>
</template>
