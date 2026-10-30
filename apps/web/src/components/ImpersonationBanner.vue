<script setup lang="ts">
import { useRouter } from 'vue-router';
import { auth } from '../stores/auth';
import { toast } from '../ui/toast';

const router = useRouter();

function exitImpersonation(): void {
  const target = auth.state.user?.account;
  const ok = auth.endImpersonation();
  if (ok) {
    toast(
      target
        ? `已退出模拟（${target}），已回到 ${auth.state.user?.account ?? '原账号'}`
        : '已退出模拟登录',
    );
    void router.replace('/admin/users');
    return;
  }
  toast('原账号会话已失效，请重新登录');
  void router.replace('/login');
}
</script>

<template>
  <div
    v-if="auth.state.impersonating"
    class="impersonation-banner"
    data-testid="impersonation-banner"
  >
    <div class="impersonation-banner-inner">
      <p class="impersonation-banner-text">
        正在模拟登录
        <strong>{{ auth.state.user?.account || '用户' }}</strong>
        <template v-if="auth.state.impersonatorAccount">
          （原账号 {{ auth.state.impersonatorAccount }}）
        </template>
      </p>
      <button
        type="button"
        class="btn impersonation-exit"
        data-testid="impersonation-exit"
        @click="exitImpersonation"
      >
        退出模拟登录
      </button>
    </div>
  </div>
</template>
