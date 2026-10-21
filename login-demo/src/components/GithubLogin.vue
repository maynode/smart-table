<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, type AppConfig } from '../api'

const emit = defineEmits<{
  (e: 'log', level: 'info' | 'ok' | 'warn' | 'err', text: string): void
}>()

const loaded = ref(false)
const enabled = ref(false)
const config = ref<AppConfig | null>(null)
const callbackUrl = `${window.location.origin}/api/auth/github/callback`

onMounted(async () => {
  try {
    config.value = await api.config()
    enabled.value = config.value.githubEnabled
    if (!enabled.value) emit('log', 'warn', 'GitHub OAuth 未配置：缺 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET')
  } catch (error) {
    emit('log', 'err', `读取配置失败：${(error as Error).message}`)
  } finally {
    loaded.value = true
  }
})

function start() {
  if (!enabled.value) return
  emit('log', 'info', '跳转 GitHub 授权页（GET /api/auth/github）')
  window.location.href = '/api/auth/github'
}
</script>

<template>
  <div class="github">
    <div class="gh-head">
      <span class="gh-mark">
        <svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
          />
        </svg>
      </span>
      <div>
        <h3>GitHub OAuth</h3>
        <p class="muted">真实协议、真实授权页，用来验证你写的回调链路。</p>
      </div>
    </div>

    <ul class="gh-points">
      <li><span>1</span> 发起时下发随机 <code>state</code> 并写入 HttpOnly cookie</li>
      <li><span>2</span> 回调校验 <code>state</code>，失败直接拒绝（防 CSRF）</li>
      <li><span>3</span> 用 <code>code</code> 换 token，再拉 <code>/user</code> 建会话</li>
    </ul>

    <button class="btn dark block" :disabled="!enabled || !loaded" @click="start">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
        />
      </svg>
      使用 GitHub 登录
    </button>

    <p v-if="loaded && !enabled" class="gh-warn">
      未配置 OAuth App。在 <code>login-demo/.env</code> 写入 <code>GITHUB_CLIENT_ID</code> 与
      <code>GITHUB_CLIENT_SECRET</code> 后重启 dev server 即可启用。
    </p>
    <p v-else-if="enabled" class="gh-callback">
      回调地址需与 OAuth App 一致：<code>{{ callbackUrl }}</code>
    </p>
  </div>
</template>

<style scoped>
.github {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 6px 2px;
}

.gh-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.gh-mark {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: #0f172a;
  color: #fff;
  flex-shrink: 0;
}

.gh-head h3 {
  margin: 0 0 2px;
  font-size: 15px;
}

.gh-head p {
  margin: 0;
  font-size: 12px;
}

.gh-points {
  margin: 0;
  padding: 14px 16px;
  list-style: none;
  border-radius: 14px;
  background: var(--bg-soft);
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 12.5px;
  color: var(--text-2);
  line-height: 1.6;
}

.gh-points li {
  display: flex;
  gap: 8px;
}

.gh-points span {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  font-size: 11px;
  color: var(--text-3);
}

.gh-warn {
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
  font-size: 12px;
  line-height: 1.7;
}

.gh-callback {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-3);
  line-height: 1.7;
  word-break: break-all;
}
</style>
