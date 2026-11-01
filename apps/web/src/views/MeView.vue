<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { resolveAvatarSrc } from '../utils/avatar';
import { auth } from '../stores/auth';
import { confirmDialog } from '../ui/dialog';

const router = useRouter();

const user = computed(() => auth.state.user);
const avatarSrc = computed(() =>
  resolveAvatarSrc({
    avatarUrl: user.value?.avatarUrl,
    avatarSeed: user.value?.avatarSeed,
  }),
);
const isInstallAdmin = computed(() => Boolean(user.value?.installAdmin));

async function signOut(): Promise<void> {
  const ok = await confirmDialog('确定退出当前账号？', {
    title: '退出登录',
    confirmLabel: '退出',
  });
  if (!ok) return;
  auth.signOut();
  await router.push('/login');
}
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
  padding: 16px 16px calc(24px + var(--safe-bottom));
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.me-header h1 {
  margin: 0;
  font-size: 22px;
}

.me-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
}

.me-profile {
  display: flex;
  align-items: center;
  gap: 12px;
}

.me-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.me-avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-muted);
  color: var(--text-secondary);
  font-weight: 600;
}

.me-account {
  font-weight: 600;
  font-size: 16px;
}

.me-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.me-section-title {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 600;
}

.me-links {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.me-link {
  color: var(--text);
  text-decoration: none;
  padding: 10px 8px;
  border-radius: 6px;
  justify-content: flex-start;
}

.me-link:hover {
  background: var(--bg-hover);
}

.me-danger {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--danger);
  font-size: 15px;
  cursor: pointer;
  justify-content: center;
}
</style>
