<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, type AppConfig, type SessionUser } from './api'
import type { LogEvent, LogLevel } from './types'
import ScanLogin from './components/ScanLogin.vue'
import MiniQrLogin from './components/MiniQrLogin.vue'
import GithubLogin from './components/GithubLogin.vue'
import SessionPanel from './components/SessionPanel.vue'
import EventLog from './components/EventLog.vue'

const tab = ref<'wechat' | 'github'>('wechat')
const user = ref<SessionUser | null>(null)
const config = ref<AppConfig | null>(null)
const events = ref<LogEvent[]>([])
let seq = 0

function log(level: LogLevel, text: string) {
  events.value.push({
    id: ++seq,
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    level,
    text,
  })
  if (events.value.length > 80) events.value.splice(0, events.value.length - 80)
}

function onLogin(next: SessionUser) {
  user.value = next
}

async function logout() {
  try {
    await api.logout()
    user.value = null
    log('info', '已退出，会话 cookie 已清除')
  } catch (error) {
    log('err', `退出失败：${(error as Error).message}`)
  }
}

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  const login = params.get('login')
  if (login) {
    if (login.endsWith('-ok')) log('ok', `回跳完成：${login}`)
    else log('err', `回跳失败：${login}（${params.get('reason') ?? 'unknown'}）`)
    window.history.replaceState({}, '', window.location.pathname)
  }

  try {
    const res = await api.me()
    user.value = res.user
    if (res.user) log('info', `恢复既有会话：${res.user.nickname}`)
  } catch (error) {
    log('err', `读取会话失败：${(error as Error).message}`)
  }

  try {
    config.value = await api.config()
    log('info', config.value.miniEnabled ? '检测到小程序配置：微信标签页使用真实小程序码登录' : '未配置小程序：微信标签页为模拟模式')
  } catch (error) {
    log('err', `读取配置失败：${(error as Error).message}`)
  }
})
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-logo">S</span>
        <div class="brand-text">
          <h1>smart-table</h1>
          <p>扫码登录实验场</p>
        </div>
      </div>
      <span class="tag">mock 微信 · 真实 GitHub OAuth</span>
    </header>

    <main class="layout">
      <section class="card panel">
        <nav class="tabs" role="tablist">
          <button
            role="tab"
            :aria-selected="tab === 'wechat'"
            :class="{ active: tab === 'wechat' }"
            @click="tab = 'wechat'"
          >
            微信扫码（模拟）
          </button>
          <button
            role="tab"
            :aria-selected="tab === 'github'"
            :class="{ active: tab === 'github' }"
            @click="tab = 'github'"
          >
            GitHub OAuth
          </button>
        </nav>

        <template v-if="tab === 'wechat'">
          <MiniQrLogin
            v-if="config?.miniEnabled"
            :env-version="config.miniEnv"
            :page="config.miniPage"
            @log="log"
            @success="onLogin"
          />
          <template v-else>
            <div class="mode-banner">
              <span class="chip warn">模拟模式</span>
              <span>未配置小程序，当前二维码不会连微信。按下面步骤填好 AppID 后自动切换成真微信。</span>
            </div>
            <details class="setup">
              <summary>4 步接入真微信（个人主体小程序即可）</summary>
              <ol>
                <li>到 mp.weixin.qq.com 注册个人主体小程序，免费，身份证 + 邮箱即可</li>
                <li>小程序后台 → 开发管理 → 开发设置，复制 AppID / AppSecret</li>
                <li>
                  写进 <code>login-demo/.env</code>：<code>WX_MINI_APPID</code>、<code>WX_MINI_APPSECRET</code>
                  （参考 <code>.env.example</code>）
                </li>
                <li>重启 <code>pnpm dev</code>，刷新本页</li>
              </ol>
              <p>
                小程序前端代码在 <code>login-demo/miniprogram/</code>，用微信开发者工具导入、上传一次即可扫码。
              </p>
            </details>
            <ScanLogin @log="log" @success="onLogin" />
          </template>
        </template>
        <GithubLogin v-else @log="log" />
      </section>

      <aside class="side">
        <SessionPanel :user="user" @logout="logout" />
        <EventLog :events="events" @clear="events = []" />
      </aside>
    </main>

    <footer class="foot">
      <p>
        服务端内存存储：重启 dev server 会清空票据与登录态。接口形状对齐
        <code>open.weixin.qq.com/connect/qrconnect</code> 与
        <code>api.weixin.qq.com/sns/oauth2/access_token</code>。
      </p>
      <p class="muted">只用于本地练手，不要直接部署成生产登录。</p>
    </footer>
  </div>
</template>
