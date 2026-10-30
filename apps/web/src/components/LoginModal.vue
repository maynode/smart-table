<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { validateAccount, validatePassword } from 'shared';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import {
  closeLoginModal,
  useLoginModalState,
} from '../auth/login-modal';
import { resolvePostLoginPath } from '../auth/post-login-path';
import { auth } from '../stores/auth';
import { toast } from '../ui/toast';

const router = useRouter();
const state = useLoginModalState();
const account = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);
const passwordEl = ref<HTMLInputElement | null>(null);

watch(
  () => state.open,
  (open) => {
    if (!open) return;
    account.value = state.accountHint || auth.state.user?.account || '';
    password.value = '';
    error.value = '';
    busy.value = false;
    void nextTick(() => {
      passwordEl.value?.focus();
    });
  },
);

async function submit(): Promise<void> {
  if (busy.value) return;
  error.value = '';
  const accountError = validateAccount(account.value);
  if (accountError) {
    error.value = accountError;
    return;
  }
  const passwordError = validatePassword(password.value);
  if (passwordError) {
    error.value = passwordError;
    return;
  }
  busy.value = true;
  try {
    const result = await endpoints.login(account.value, password.value);
    auth.signIn(result.accessToken, {
      id: result.user.id,
      account: result.user.account,
      avatarSeed: result.user.avatarSeed,
      avatarUrl: result.user.avatarUrl,
      installAdmin: result.user.installAdmin,
    });
    closeLoginModal();
    toast('登录成功');
    // 无权限时才离开当前页；有权限则留在原页，不刷新
    const current = router.currentRoute.value.fullPath;
    const next = resolvePostLoginPath(current, result.user);
    if (next !== current) {
      await router.replace(next);
    }
  } catch (caught) {
    error.value =
      caught instanceof ApiError ? caught.message : '网络错误，请稍后重试';
  } finally {
    busy.value = false;
  }
}

function goFullLogin(): void {
  const redirect = router.currentRoute.value.fullPath;
  closeLoginModal();
  void router.replace({
    path: '/login',
    query: redirect && redirect !== '/login' ? { redirect } : undefined,
  });
}

function onKeydown(event: KeyboardEvent): void {
  if (!state.open || busy.value) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    void submit();
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.open"
      class="login-modal-mask"
      data-testid="login-modal"
      @keydown="onKeydown"
    >
      <section
        class="login-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-modal-title"
        @click.stop
      >
        <header class="login-modal-head">
          <h3 id="login-modal-title">登录已失效</h3>
          <p class="login-modal-sub">请重新登录后继续，页面不会刷新</p>
        </header>

        <label class="login-modal-field">
          用户名
          <input
            v-model="account"
            type="text"
            autocomplete="username"
            data-testid="login-modal-account"
            :disabled="busy"
          />
        </label>
        <label class="login-modal-field">
          密码
          <input
            ref="passwordEl"
            v-model="password"
            type="password"
            autocomplete="current-password"
            data-testid="login-modal-password"
            :disabled="busy"
          />
        </label>

        <p v-if="error" class="login-modal-error" role="alert">{{ error }}</p>

        <footer class="login-modal-foot">
          <button
            type="button"
            class="btn"
            :disabled="busy"
            @click="goFullLogin"
          >
            去登录页
          </button>
          <button
            type="button"
            class="btn btn-primary"
            data-testid="login-modal-submit"
            :disabled="busy"
            @click="submit"
          >
            {{ busy ? '登录中…' : '登录' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.login-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 1400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.45);
}

.login-modal {
  width: min(400px, 100%);
  border-radius: 12px;
  border: 1px solid var(--border, #e5e6eb);
  background: #fff;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.2);
  padding: 20px;
}

.login-modal-head {
  margin-bottom: 14px;
}

.login-modal-head h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.login-modal-sub {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-secondary, #646a73);
}

.login-modal-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--text-secondary, #646a73);
}

.login-modal-field input {
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border, #e5e6eb);
  border-radius: 8px;
  background: #fff;
  color: var(--text, #1f2329);
  font-size: 14px;
}

.login-modal-field input:focus {
  outline: none;
  border-color: var(--brand, #2d8cf0);
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.2);
}

.login-modal-error {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--danger, #d4380d);
}

.login-modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
