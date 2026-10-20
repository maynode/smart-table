<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { auth } from '../stores/auth';

const router = useRouter();
const mode = ref<'login' | 'register'>('login');
const email = ref('');
const password = ref('');
const name = ref('');
const error = ref('');
const busy = ref(false);

async function submit(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result =
      mode.value === 'login'
        ? await endpoints.login(email.value, password.value)
        : await endpoints.register(email.value, password.value, name.value);
    auth.signIn(result.accessToken, result.user);
    await router.push('/');
  } catch (caught) {
    error.value =
      caught instanceof ApiError ? caught.message : '网络错误，请稍后重试';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-brand">
        <span class="brand-mark">▦</span>
        <div>
          <h1>智能表格</h1>
          <p>企业私有化部署 · 序列号领取与仪表盘</p>
        </div>
      </div>

      <div class="auth-tabs">
        <button
          class="auth-tab"
          :class="{ active: mode === 'login' }"
          @click="mode = 'login'"
        >
          登录
        </button>
        <button
          class="auth-tab"
          :class="{ active: mode === 'register' }"
          data-testid="register-tab"
          @click="mode = 'register'"
        >
          注册
        </button>
      </div>

      <form class="auth-form" @submit.prevent="submit">
        <label v-if="mode === 'register'" class="field">
          <span>姓名</span>
          <input
            v-model="name"
            data-testid="name-input"
            required
            maxlength="50"
            placeholder="请输入姓名"
          />
        </label>
        <label class="field">
          <span>邮箱</span>
          <input
            v-model="email"
            type="email"
            data-testid="email-input"
            required
            placeholder="name@company.com"
          />
        </label>
        <label class="field">
          <span>密码</span>
          <input
            v-model="password"
            type="password"
            data-testid="password-input"
            required
            minlength="8"
            placeholder="至少 8 位，含字母与数字"
          />
        </label>

        <p v-if="error" class="auth-error" data-testid="auth-error">{{ error }}</p>

        <button class="btn btn-primary auth-submit" data-testid="auth-submit" :disabled="busy">
          {{ busy ? '处理中…' : mode === 'login' ? '登录' : '注册并登录' }}
        </button>
      </form>

      <p class="auth-footnote">私有化部署 · 数据保存在你自己的 PostgreSQL 中</p>
    </div>
  </div>
</template>
