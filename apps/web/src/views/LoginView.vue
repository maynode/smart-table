<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  ACCOUNT_HINT,
  ACCOUNT_MAX_LENGTH,
  ACCOUNT_MIN_LENGTH,
  PASSWORD_HINT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SECURITY_QUESTION_PRESETS,
  validateAccount,
  validatePassword,
  validateSecurityAnswer,
  validateSecurityQuestion,
} from 'shared';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { auth } from '../stores/auth';
import authLoginMid from '../assets/auth-login-mid.svg';

type Mode = 'login' | 'register' | 'recover';
type RecoverStep = 'account' | 'reset';

const router = useRouter();
const mode = ref<Mode>('login');
const recoverStep = ref<RecoverStep>('account');
const account = ref('');
const password = ref('');
const passwordConfirm = ref('');
const securityQuestion = ref<string>(SECURITY_QUESTION_PRESETS[0]);
const customQuestion = ref('');
const securityAnswer = ref('');
const recoveryQuestion = ref('');
const error = ref('');
const busy = ref(false);
const successTip = ref('');

const useCustomQuestion = ref(false);
const questionMenuOpen = ref(false);

watch(mode, () => {
  error.value = '';
  successTip.value = '';
  recoverStep.value = 'account';
  recoveryQuestion.value = '';
  securityAnswer.value = '';
  passwordConfirm.value = '';
  questionMenuOpen.value = false;
});

watch(useCustomQuestion, () => {
  questionMenuOpen.value = false;
});

function toggleQuestionMenu(event: Event): void {
  event.stopPropagation();
  if (useCustomQuestion.value) return;
  questionMenuOpen.value = !questionMenuOpen.value;
}

function pickQuestion(item: string): void {
  securityQuestion.value = item;
  questionMenuOpen.value = false;
}

function onDocumentClick(): void {
  questionMenuOpen.value = false;
}

onMounted(() => {
  document.documentElement.classList.add('auth-screen');
  document.addEventListener('click', onDocumentClick);
});

onUnmounted(() => {
  document.documentElement.classList.remove('auth-screen');
  document.removeEventListener('click', onDocumentClick);
});

function resolvedQuestion(): string {
  return useCustomQuestion.value
    ? customQuestion.value.trim()
    : securityQuestion.value.trim();
}

async function submit(): Promise<void> {
  if (busy.value) return;
  error.value = '';
  successTip.value = '';

  if (mode.value === 'recover') {
    await submitRecover();
    return;
  }

  if (mode.value === 'register') {
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
    if (password.value !== passwordConfirm.value) {
      error.value = '两次输入的密码不一致';
      return;
    }
    const qError = validateSecurityQuestion(resolvedQuestion());
    if (qError) {
      error.value = qError;
      return;
    }
    const aError = validateSecurityAnswer(securityAnswer.value);
    if (aError) {
      error.value = aError;
      return;
    }
  }

  busy.value = true;
  try {
    const result =
      mode.value === 'login'
        ? await endpoints.login(account.value, password.value)
        : await endpoints.register({
            account: account.value,
            password: password.value,
            securityQuestion: resolvedQuestion(),
            securityAnswer: securityAnswer.value,
          });
    auth.signIn(result.accessToken, result.user);
    await router.push('/');
  } catch (caught) {
    error.value =
      caught instanceof ApiError ? caught.message : '网络错误，请稍后重试';
  } finally {
    busy.value = false;
  }
}

async function submitRecover(): Promise<void> {
  if (recoverStep.value === 'account') {
    const accountError = validateAccount(account.value);
    if (accountError) {
      error.value = accountError;
      return;
    }
    busy.value = true;
    try {
      const res = await endpoints.recoveryQuestion(account.value);
      recoveryQuestion.value = res.question;
      recoverStep.value = 'reset';
      securityAnswer.value = '';
      password.value = '';
      passwordConfirm.value = '';
    } catch (caught) {
      error.value =
        caught instanceof ApiError ? caught.message : '网络错误，请稍后重试';
    } finally {
      busy.value = false;
    }
    return;
  }

  const aError = validateSecurityAnswer(securityAnswer.value);
  if (aError) {
    error.value = aError;
    return;
  }
  const passwordError = validatePassword(password.value);
  if (passwordError) {
    error.value = passwordError;
    return;
  }
  if (password.value !== passwordConfirm.value) {
    error.value = '两次输入的密码不一致';
    return;
  }

  busy.value = true;
  try {
    await endpoints.recoveryReset({
      account: account.value,
      securityAnswer: securityAnswer.value,
      password: password.value,
    });
    successTip.value = '密码已重置，请使用新密码登录';
    mode.value = 'login';
    recoverStep.value = 'account';
    password.value = '';
    passwordConfirm.value = '';
    securityAnswer.value = '';
    recoveryQuestion.value = '';
  } catch (caught) {
    error.value =
      caught instanceof ApiError ? caught.message : '网络错误，请稍后重试';
  } finally {
    busy.value = false;
  }
}

function backToLogin(): void {
  mode.value = 'login';
}

function openRecover(): void {
  mode.value = 'recover';
  recoverStep.value = 'account';
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-brand">
        <span class="brand-mark">▦</span>
        <div>
          <h1>智能表格</h1>
        </div>
      </div>

      <div v-if="mode !== 'recover'" class="auth-tabs">
        <button
          class="auth-tab"
          :class="{ active: mode === 'login' }"
          type="button"
          @click="mode = 'login'"
        >
          登录
        </button>
        <button
          class="auth-tab"
          :class="{ active: mode === 'register' }"
          data-testid="register-tab"
          type="button"
          @click="mode = 'register'"
        >
          注册
        </button>
      </div>
      <div v-else class="recover-head">
        <h2>找回密码</h2>
        <button class="link-btn" type="button" @click="backToLogin">返回登录</button>
      </div>

      <form class="auth-form" @submit.prevent="submit">
        <label
          v-if="mode !== 'recover' || recoverStep === 'account'"
          class="field"
        >
          <span class="field-title">
            用户名
            <span
              v-if="mode === 'register'"
              class="field-help"
              tabindex="0"
              :data-tip="ACCOUNT_HINT"
              aria-label="用户名说明"
            >?</span>
          </span>
          <input
            v-model="account"
            data-testid="account-input"
            required
            :minlength="ACCOUNT_MIN_LENGTH"
            :maxlength="ACCOUNT_MAX_LENGTH"
            autocomplete="username"
            placeholder="请输入用户名"
            :disabled="mode === 'recover' && recoverStep === 'reset'"
          />
        </label>

        <label
          v-if="mode === 'login' || mode === 'register'"
          class="field"
        >
          <span class="field-title">
            密码
            <span
              v-if="mode === 'register'"
              class="field-help"
              tabindex="0"
              :data-tip="PASSWORD_HINT"
              aria-label="密码说明"
            >?</span>
          </span>
          <input
            v-model="password"
            type="password"
            data-testid="password-input"
            required
            :minlength="PASSWORD_MIN_LENGTH"
            :maxlength="PASSWORD_MAX_LENGTH"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
            :placeholder="mode === 'register' ? '设置登录密码' : '请输入密码'"
          />
        </label>

        <label
          v-if="mode === 'register'"
          class="field"
        >
          <span class="field-title">确认密码</span>
          <input
            v-model="passwordConfirm"
            type="password"
            data-testid="password-confirm-input"
            required
            :minlength="PASSWORD_MIN_LENGTH"
            :maxlength="PASSWORD_MAX_LENGTH"
            autocomplete="new-password"
            placeholder="再次输入密码"
          />
        </label>

        <div
          v-if="mode === 'login' || mode === 'register'"
          class="auth-mid-stack"
        >
          <div
            class="auth-mid-panel auth-mid-art"
            :class="{ active: mode === 'login' }"
            :aria-hidden="mode !== 'login'"
          >
            <img
              class="auth-mid-image"
              :src="authLoginMid"
              alt=""
              draggable="false"
            />
          </div>
          <div
            class="auth-mid-panel"
            :class="{ active: mode === 'register' }"
            :aria-hidden="mode !== 'register'"
          >
            <div class="field">
              <span class="field-title">密保问题</span>
              <div class="security-q-row" @click.stop>
                <div v-if="!useCustomQuestion" class="security-dropdown">
                  <button
                    type="button"
                    class="security-trigger"
                    data-testid="security-question"
                    :aria-expanded="questionMenuOpen"
                    :tabindex="mode === 'register' ? 0 : -1"
                    @click="toggleQuestionMenu"
                  >
                    <span class="security-trigger-text">{{ securityQuestion }}</span>
                    <span class="security-caret" :class="{ open: questionMenuOpen }" />
                  </button>
                  <ul
                    v-if="questionMenuOpen && mode === 'register'"
                    class="security-menu"
                    data-testid="security-question-menu"
                  >
                    <li
                      v-for="item in SECURITY_QUESTION_PRESETS"
                      :key="item"
                    >
                      <button
                        type="button"
                        class="security-option"
                        :class="{ active: item === securityQuestion }"
                        @click="pickQuestion(item)"
                      >
                        {{ item }}
                      </button>
                    </li>
                  </ul>
                </div>
                <input
                  v-else
                  v-model="customQuestion"
                  class="security-input"
                  data-testid="security-question-custom"
                  maxlength="100"
                  placeholder="请输入自定义密保问题"
                  :required="mode === 'register'"
                  :tabindex="mode === 'register' ? 0 : -1"
                />
                <button
                  class="security-toggle"
                  type="button"
                  :tabindex="mode === 'register' ? 0 : -1"
                  @click="useCustomQuestion = !useCustomQuestion"
                >
                  {{ useCustomQuestion ? '用预设' : '自定义' }}
                </button>
              </div>
            </div>
            <label class="field">
              <span class="field-title">密保答案</span>
              <input
                v-model="securityAnswer"
                data-testid="security-answer"
                :required="mode === 'register'"
                maxlength="64"
                placeholder="请输入答案"
                :tabindex="mode === 'register' ? 0 : -1"
              />
            </label>
          </div>
        </div>

        <template v-if="mode === 'recover' && recoverStep === 'reset'">
          <label class="field">
            <span class="field-title">用户名</span>
            <input :value="account" disabled />
          </label>
          <label class="field">
            <span class="field-title">密保问题</span>
            <input :value="recoveryQuestion" disabled data-testid="recovery-question" />
          </label>
          <label class="field">
            <span class="field-title">密保答案</span>
            <input
              v-model="securityAnswer"
              data-testid="recovery-answer"
              required
              maxlength="64"
              placeholder="请输入密保答案"
            />
          </label>
          <label class="field">
            <span class="field-title">
              新密码
              <span
                class="field-help"
                tabindex="0"
                :data-tip="PASSWORD_HINT"
                aria-label="密码说明"
              >?</span>
            </span>
            <input
              v-model="password"
              type="password"
              data-testid="recovery-password"
              required
              :minlength="PASSWORD_MIN_LENGTH"
              :maxlength="PASSWORD_MAX_LENGTH"
              placeholder="设置新密码"
            />
          </label>
          <label class="field">
            <span class="field-title">确认新密码</span>
            <input
              v-model="passwordConfirm"
              type="password"
              data-testid="recovery-password-confirm"
              required
              :minlength="PASSWORD_MIN_LENGTH"
              :maxlength="PASSWORD_MAX_LENGTH"
              placeholder="再次输入新密码"
            />
          </label>
        </template>

        <p v-if="successTip" class="auth-success" data-testid="auth-success">
          {{ successTip }}
        </p>
        <p v-if="error" class="auth-error" data-testid="auth-error">{{ error }}</p>

        <button
          class="btn btn-primary auth-submit"
          data-testid="auth-submit"
          :disabled="busy"
        >
          {{
            busy
              ? '处理中…'
              : mode === 'login'
                ? '登录'
                : mode === 'register'
                  ? '注册并登录'
                  : recoverStep === 'account'
                    ? '下一步'
                    : '重置密码'
          }}
        </button>

        <div
          v-if="mode === 'login' || mode === 'register'"
          class="auth-footer-stack"
        >
          <p
            class="auth-extra auth-footer-panel"
            :class="{ active: mode === 'login' }"
            :aria-hidden="mode !== 'login'"
          >
            <button
              class="link-btn"
              type="button"
              data-testid="forgot-password"
              :tabindex="mode === 'login' ? 0 : -1"
              @click="openRecover"
            >
              忘记密码？
            </button>
          </p>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.recover-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.recover-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.link-btn {
  border: none;
  background: transparent;
  color: var(--brand, #2d8cf0);
  cursor: pointer;
  font-size: 13px;
  padding: 0;
}
.auth-extra {
  margin: 0;
  text-align: right;
}
.auth-success {
  margin: 0;
  padding: 8px 10px;
  border-radius: 7px;
  background: #f0fff4;
  color: #237804;
  font-size: 12px;
  line-height: 1.45;
}
.field input:disabled {
  background: #f5f6f8;
  color: #646a73;
}

.field-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.field-help {
  position: relative;
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e8eaed;
  color: #8f959e;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  cursor: help;
  flex: none;
}

.field-help:hover,
.field-help:focus {
  background: #d6e8fc;
  color: var(--brand, #2d8cf0);
  outline: none;
}

.field-help::after {
  content: attr(data-tip);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  width: max-content;
  max-width: 360px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(31, 35, 41, 0.92);
  color: #fff;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.45;
  white-space: normal;
  text-align: left;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.12s ease;
  z-index: 5;
}

.field-help::before {
  content: '';
  position: absolute;
  left: 50%;
  bottom: calc(100% + 2px);
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: rgba(31, 35, 41, 0.92);
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.12s ease;
  z-index: 5;
}

.field-help:hover::after,
.field-help:hover::before,
.field-help:focus::after,
.field-help:focus::before {
  opacity: 1;
  visibility: visible;
}

.security-q-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.security-dropdown {
  position: relative;
  flex: 1;
  min-width: 0;
}

.security-trigger {
  width: 100%;
  height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--border-strong, #d0d3d9);
  border-radius: 8px;
  background: #fff;
  color: var(--text, #1f2329);
  font-size: 14px;
  font-weight: 400;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}

.security-trigger:hover {
  border-color: #b7bec7;
}

.security-trigger:focus,
.security-dropdown:has(.security-menu) .security-trigger {
  outline: none;
  border-color: var(--brand, #2d8cf0);
  box-shadow: 0 0 0 3px rgba(45, 140, 240, 0.14);
}

.security-trigger-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.security-caret {
  width: 10px;
  height: 10px;
  flex: none;
  border-right: 1.5px solid #8f959e;
  border-bottom: 1.5px solid #8f959e;
  transform: rotate(45deg) translateY(-2px);
  transition: transform 0.14s ease;
}

.security-caret.open {
  transform: rotate(-135deg) translateY(-2px);
}

.security-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 20;
  margin: 0;
  padding: 6px;
  list-style: none;
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(31, 35, 41, 0.14);
  max-height: 220px;
  overflow: auto;
}

.security-option {
  width: 100%;
  display: block;
  padding: 9px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text, #1f2329);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  line-height: 1.4;
}

.security-option:hover {
  background: #f5f6f8;
}

.security-option.active {
  background: #e8f3ff;
  color: var(--brand-strong, #1a6dcc);
  font-weight: 550;
}

.security-input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--border-strong, #d0d3d9);
  border-radius: 8px;
  background: #fff;
  color: var(--text, #1f2329);
  font-size: 14px;
  font-weight: 400;
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}

.security-input:focus {
  outline: none;
  border-color: var(--brand, #2d8cf0);
  box-shadow: 0 0 0 3px rgba(45, 140, 240, 0.14);
}

.security-toggle {
  flex: none;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--border-strong, #d0d3d9);
  border-radius: 8px;
  background: #f7f8fa;
  color: var(--text-secondary, #646a73);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}

.security-toggle:hover {
  background: #eef5ff;
  border-color: #91c0f8;
  color: var(--brand, #2d8cf0);
}
</style>
