<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ApiError, api, type SessionUser } from '../api'

type Phase = 'creating' | 'pending' | 'exchanging' | 'success' | 'expired' | 'error'

const props = defineProps<{ envVersion: string; page: string }>()

const emit = defineEmits<{
  (e: 'log', level: 'info' | 'ok' | 'warn' | 'err', text: string): void
  (e: 'success', user: SessionUser): void
}>()

const phase = ref<Phase>('creating')
const image = ref('')
const ticketId = ref('')
const expiresAt = ref(0)
const secondsLeft = ref(0)
const errorText = ref('')

let pollTimer: number | undefined
let tickTimer: number | undefined
let disposed = false

const envLabel = computed(() => {
  if (props.envVersion === 'trial') return '体验版'
  if (props.envVersion === 'release') return '正式版'
  return '开发版'
})

const statusText = computed(() => {
  switch (phase.value) {
    case 'creating':
      return '正在向微信申请小程序码…'
    case 'pending':
      return '等待微信扫码'
    case 'exchanging':
      return '扫码成功，正在兑换会话…'
    case 'success':
      return '登录成功（真实 openid）'
    case 'expired':
      return '小程序码已过期'
    case 'error':
      return errorText.value || '生成失败'
    default:
      return ''
  }
})

const statusDot = computed(() => {
  if (phase.value === 'pending') return 'waiting'
  if (phase.value === 'success') return 'ok'
  if (phase.value === 'expired' || phase.value === 'error') return 'bad'
  return 'idle'
})

function log(level: 'info' | 'ok' | 'warn' | 'err', text: string) {
  emit('log', level, text)
}

function stopTimers() {
  if (pollTimer) window.clearTimeout(pollTimer)
  if (tickTimer) window.clearInterval(tickTimer)
  pollTimer = undefined
  tickTimer = undefined
}

function startTick() {
  if (tickTimer) window.clearInterval(tickTimer)
  tickTimer = window.setInterval(() => {
    if (!expiresAt.value) return
    const left = Math.max(0, Math.ceil((expiresAt.value - Date.now()) / 1000))
    secondsLeft.value = left
    if (left === 0 && phase.value === 'pending') {
      phase.value = 'expired'
      stopTimers()
      log('warn', '小程序码过期')
    }
  }, 400)
}

function schedulePoll(delay: number) {
  if (pollTimer) window.clearTimeout(pollTimer)
  pollTimer = window.setTimeout(() => {
    void poll()
  }, delay)
}

async function create() {
  stopTimers()
  phase.value = 'creating'
  image.value = ''
  errorText.value = ''
  secondsLeft.value = 0
  try {
    const created = await api.createMiniTicket()
    ticketId.value = created.id
    image.value = created.image
    expiresAt.value = created.expiresAt
    phase.value = 'pending'
    startTick()
    schedulePoll(1000)
    log('info', `POST /api/login/mini/ticket → 小程序码就绪（${created.envVersion} / ${created.page}）`)
  } catch (error) {
    phase.value = 'error'
    errorText.value = (error as Error).message
    log('err', `生成小程序码失败：${(error as Error).message}`)
  }
}

async function poll() {
  if (disposed || !ticketId.value) return
  if (phase.value === 'success' || phase.value === 'expired') return

  try {
    const res = await api.pollMiniTicket(ticketId.value)
    if (res.status === 'confirmed') {
      if (res.code) {
        await exchange(res.code)
        return
      }
      log('warn', '已扫码，但 code 已被消费，请刷新')
      phase.value = 'expired'
      stopTimers()
      return
    }
    if (res.status === 'expired') {
      phase.value = 'expired'
      stopTimers()
      log('warn', '轮询 → expired')
      return
    }
    if (res.status === 'scanned') {
      phase.value = 'pending'
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      phase.value = 'expired'
      stopTimers()
      log('err', '票据不存在（服务重启会清空内存状态）')
      return
    }
    log('err', `轮询失败：${(error as Error).message}`)
  }

  if (phase.value === 'pending') schedulePoll(1200)
}

async function exchange(code: string) {
  phase.value = 'exchanging'
  stopTimers()
  log('info', '扫码确认成功 → POST /api/login/mini/exchange')
  try {
    const { user } = await api.exchangeMini(code)
    phase.value = 'success'
    log('ok', `真实微信身份登录成功：openid=${user.openid.slice(0, 12)}…`)
    emit('success', user)
  } catch (error) {
    phase.value = 'error'
    errorText.value = (error as Error).message
    log('err', `兑换失败：${(error as Error).message}`)
  }
}

async function copyTicket() {
  if (!ticketId.value) return
  try {
    await navigator.clipboard.writeText(ticketId.value)
    log('ok', `票据已复制：scene=${ticketId.value}`)
  } catch {
    log('warn', '复制失败，手动选中票据 id 复制')
  }
}

onMounted(() => {
  void create()
})

onBeforeUnmount(() => {
  disposed = true
  stopTimers()
})
</script>

<template>
  <div class="mini">
    <div class="mini-frame" :class="{ dimmed: phase === 'success' || !image }">
      <img v-if="image && phase !== 'success'" class="mini-img" :src="image" alt="微信小程序码" />

      <div v-if="phase === 'creating'" class="overlay">
        <span class="spinner" />
        <p>正在生成…</p>
      </div>

      <div v-else-if="phase === 'expired'" class="overlay">
        <p class="overlay-title">小程序码已过期</p>
        <button class="btn primary sm" @click="create">刷新</button>
      </div>

      <div v-else-if="phase === 'error'" class="overlay">
        <p class="overlay-title">{{ errorText || '生成失败' }}</p>
        <button class="btn primary sm" @click="create">重试</button>
      </div>

      <div v-else-if="phase === 'success'" class="overlay ok">
        <span class="check">✓</span>
        <p class="overlay-title">登录成功</p>
      </div>

      <span class="env-badge">{{ envLabel }}</span>
    </div>

    <div class="scan-status">
      <span class="status-dot" :class="statusDot" />
      <span>{{ statusText }}</span>
      <span v-if="secondsLeft > 0 && phase === 'pending'" class="countdown">{{ secondsLeft }}s</span>
    </div>

    <p class="mini-hint">
      用自己的微信扫码。开发版需先在微信开发者工具里「上传」，且你本人是小程序项目成员；真机扫码时手机要能访问本机地址（同一局域网，并在小程序里打开调试模式）。
    </p>

    <p class="mini-page">落点页面：<code>{{ page }}</code></p>

    <div class="ticket-row">
      <span class="ticket-label">票据</span>
      <code class="ticket-id">{{ ticketId || '—' }}</code>
      <button class="link" :disabled="!ticketId" @click="copyTicket">复制</button>
    </div>

    <p class="mini-dev-hint">
      开发者工具里调试：编译模式 → 启动参数填 <code>scene={{ ticketId || '票据id' }}</code>，模拟器就能直接跑，
      不用先改 config.js、也不用手机。
    </p>
  </div>
</template>

<style scoped>
.mini {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 8px 0 4px;
}

.mini-frame {
  position: relative;
  width: 232px;
  height: 232px;
  padding: 12px;
  border-radius: 18px;
  background: #fff;
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sm);
}

.mini-frame.dimmed {
  display: grid;
  place-items: center;
  background: var(--bg-soft);
}

.mini-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 10px;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.93);
  padding: 16px;
  text-align: center;
}

.overlay.ok {
  background: linear-gradient(160deg, #f0fdf4, #ffffff);
}

.overlay-title {
  margin: 0;
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.6;
}

.check {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--green);
  color: #fff;
  font-size: 30px;
}

.env-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.78);
  color: #fff;
  font-size: 11px;
}

.scan-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-2);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #cbd5e1;
}

.status-dot.waiting {
  background: #f59e0b;
  animation: blink 1.4s infinite;
}

.status-dot.ok {
  background: var(--green);
}

.status-dot.bad {
  background: #ef4444;
}

@keyframes blink {
  50% {
    opacity: 0.35;
  }
}

.countdown {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-soft);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.mini-hint {
  margin: 0;
  max-width: 360px;
  text-align: center;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-3);
}

.mini-page {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-3);
}

.ticket-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--bg-soft);
  font-size: 11.5px;
}

.ticket-label {
  color: var(--text-3);
}

.ticket-id {
  flex: 1;
  font-family: var(--mono);
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mini-dev-hint {
  margin: 0;
  max-width: 360px;
  text-align: center;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-3);
}
</style>
