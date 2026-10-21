<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ApiError, api, type SessionUser } from '../api'

type Phase = 'idle' | 'creating' | 'pending' | 'scanned' | 'exchanging' | 'success' | 'expired' | 'cancelled' | 'error'

const emit = defineEmits<{
  (e: 'log', level: 'info' | 'ok' | 'warn' | 'err', text: string): void
  (e: 'success', user: SessionUser): void
}>()

const phase = ref<Phase>('idle')
const svg = ref('')
const ticketId = ref('')
const authorizeUrl = ref('')
const expiresAt = ref(0)
const secondsLeft = ref(0)
const errorText = ref('')
const busy = ref(false)

let pollTimer: number | undefined
let tickTimer: number | undefined
let disposed = false

const POLL_INTERVAL = 1200

const statusText = computed(() => {
  switch (phase.value) {
    case 'idle':
    case 'creating':
      return '正在生成二维码…'
    case 'pending':
      return '等待扫码'
    case 'scanned':
      return '已扫码，等待手机确认'
    case 'exchanging':
      return '正在用 code 换取会话…'
    case 'success':
      return '登录成功'
    case 'expired':
      return '二维码已过期'
    case 'cancelled':
      return '登录已取消'
    case 'error':
      return errorText.value || '出错了'
    default:
      return ''
  }
})

const statusDot = computed(() => {
  if (phase.value === 'pending') return 'waiting'
  if (phase.value === 'scanned') return 'scanned'
  if (phase.value === 'success') return 'ok'
  if (phase.value === 'expired' || phase.value === 'cancelled' || phase.value === 'error') return 'bad'
  return 'idle'
})

const canSimulate = computed(() => phase.value === 'pending' || phase.value === 'scanned')
const showQr = computed(() => ['pending', 'scanned', 'exchanging'].includes(phase.value))

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
    if (left === 0 && (phase.value === 'pending' || phase.value === 'scanned')) {
      phase.value = 'expired'
      stopTimers()
      log('warn', '倒计时结束：二维码过期')
    }
  }, 400)
}

function schedulePoll(delay = POLL_INTERVAL) {
  if (pollTimer) window.clearTimeout(pollTimer)
  pollTimer = window.setTimeout(() => {
    void poll()
  }, delay)
}

async function createQr() {
  stopTimers()
  resetTicket()
  phase.value = 'creating'
  svg.value = ''
  authorizeUrl.value = ''
  errorText.value = ''
  secondsLeft.value = 0
  try {
    const created = await api.createQr()
    ticketId.value = created.id
    svg.value = created.qrSvg
    authorizeUrl.value = created.authorizeUrl
    expiresAt.value = created.expiresAt
    phase.value = 'pending'
    startTick()
    schedulePoll(400)
    log('info', `POST /api/login/qr → 票据 ${created.id}（有效期 120 秒）`)
  } catch (error) {
    fail(error)
  }
}

function resetTicket() {
  ticketId.value = ''
  expiresAt.value = 0
}

async function poll() {
  if (disposed) return
  if (!ticketId.value) return
  if (phase.value === 'success' || phase.value === 'expired' || phase.value === 'cancelled') return

  try {
    const res = await api.pollQr(ticketId.value)

    if (res.status === 'scanned' && phase.value === 'pending') {
      phase.value = 'scanned'
      log('info', '轮询 → scanned：手机已扫码')
    }

    if (res.status === 'confirmed') {
      if (res.code) {
        await exchange(res.code)
        return
      }
      if (phase.value !== 'success') {
        log('warn', '票据已确认，但 code 已被消费，请刷新二维码')
        phase.value = 'expired'
        stopTimers()
      }
      return
    }

    if (res.status === 'cancelled') {
      phase.value = 'cancelled'
      stopTimers()
      log('warn', '轮询 → cancelled：手机端取消了登录')
      return
    }

    if (res.status === 'expired') {
      phase.value = 'expired'
      stopTimers()
      log('warn', '轮询 → expired：二维码过期')
      return
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      phase.value = 'expired'
      stopTimers()
      log('err', '轮询 404：票据不存在（dev server 重启会清空内存状态）')
      return
    }
    log('err', `轮询失败：${(error as Error).message}`)
  }

  if (phase.value === 'pending' || phase.value === 'scanned') schedulePoll()
}

async function exchange(code: string) {
  phase.value = 'exchanging'
  stopTimers()
  log('info', '拿到一次性 code → POST /api/login/exchange')
  try {
    const { user } = await api.exchange(code)
    phase.value = 'success'
    log('ok', `会话签发成功：${user.nickname}（${user.provider}）`)
    emit('success', user)
  } catch (error) {
    phase.value = 'error'
    errorText.value = (error as Error).message
    log('err', `兑换失败：${(error as Error).message}`)
  }
}

function fail(error: unknown) {
  phase.value = 'error'
  errorText.value = (error as Error).message
  log('err', `请求失败：${(error as Error).message}`)
}

async function simulateScan() {
  if (!ticketId.value || busy.value) return
  busy.value = true
  try {
    await api.scanQr(ticketId.value)
    log('info', '模拟：POST /scan（手机扫码）')
    schedulePoll(100)
  } catch (error) {
    log('err', `模拟扫码失败：${(error as Error).message}`)
  } finally {
    busy.value = false
  }
}

async function simulateConfirm() {
  if (!ticketId.value || busy.value) return
  busy.value = true
  try {
    await api.confirmQr(ticketId.value)
    log('info', '模拟：POST /confirm（手机确认）')
    schedulePoll(100)
  } catch (error) {
    log('err', `模拟确认失败：${(error as Error).message}`)
  } finally {
    busy.value = false
  }
}

async function simulateCancel() {
  if (!ticketId.value || busy.value) return
  busy.value = true
  try {
    await api.cancelQr(ticketId.value)
    log('info', '模拟：POST /cancel（手机取消）')
    schedulePoll(100)
  } catch (error) {
    log('err', `模拟取消失败：${(error as Error).message}`)
  } finally {
    busy.value = false
  }
}

function openPhone() {
  if (authorizeUrl.value) window.open(authorizeUrl.value, '_blank', 'noopener')
}

onMounted(() => {
  void createQr()
})

onBeforeUnmount(() => {
  disposed = true
  stopTimers()
})
</script>

<template>
  <div class="scan">
    <div class="qr-frame" :class="{ dimmed: !showQr }">
      <div v-if="showQr" class="qr-code" v-html="svg" />

      <div v-else-if="phase === 'creating' || phase === 'idle'" class="qr-overlay">
        <span class="spinner" />
        <p>生成中…</p>
      </div>

      <div v-else-if="phase === 'expired'" class="qr-overlay">
        <p class="overlay-title">二维码已过期</p>
        <button class="btn primary sm" @click="createQr">刷新二维码</button>
      </div>

      <div v-else-if="phase === 'cancelled'" class="qr-overlay">
        <p class="overlay-title">已取消登录</p>
        <button class="btn primary sm" @click="createQr">重新发起</button>
      </div>

      <div v-else-if="phase === 'error'" class="qr-overlay">
        <p class="overlay-title">出错了</p>
        <button class="btn primary sm" @click="createQr">重试</button>
      </div>

      <div v-else class="qr-overlay ok">
        <span class="check">✓</span>
        <p class="overlay-title">登录成功</p>
      </div>

      <div v-if="phase === 'scanned'" class="qr-badge">已扫码，请在手机上确认</div>
      <div v-if="phase === 'exchanging'" class="qr-badge">正在换取会话…</div>
    </div>

    <div class="scan-status">
      <span class="status-dot" :class="statusDot" />
      <span class="status-text">{{ statusText }}</span>
      <span v-if="secondsLeft > 0 && (phase === 'pending' || phase === 'scanned')" class="countdown">
        {{ secondsLeft }}s
      </span>
    </div>

    <div class="simulate">
      <p class="simulate-title">没有第二台设备？用按钮驱动状态机：</p>
      <div class="simulate-actions">
        <button class="btn ghost sm" :disabled="!canSimulate || busy" @click="simulateScan">模拟扫码</button>
        <button class="btn ghost sm" :disabled="!canSimulate || busy" @click="simulateConfirm">模拟确认</button>
        <button class="btn ghost sm" :disabled="!canSimulate || busy" @click="simulateCancel">模拟取消</button>
        <button class="btn ghost sm" :disabled="!authorizeUrl" @click="openPhone">打开手机页</button>
      </div>
    </div>

    <p class="scan-hint">
      用手机或另一个浏览器打开二维码里的地址，会看到一个仿微信的确认页；确认后电脑端靠轮询自动完成登录。
    </p>
  </div>
</template>

<style scoped>
.scan {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding: 8px 0 4px;
}

.qr-frame {
  position: relative;
  width: 232px;
  height: 232px;
  padding: 12px;
  border-radius: 18px;
  background: #fff;
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sm);
}

.qr-frame.dimmed {
  display: grid;
  place-items: center;
  background: var(--bg-soft);
}

.qr-code {
  width: 100%;
  height: 100%;
}

.qr-code :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 10px;
}

.qr-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(2px);
}

.qr-overlay.ok {
  background: linear-gradient(160deg, #f0fdf4, #ffffff);
}

.overlay-title {
  margin: 0;
  font-size: 14px;
  color: var(--text-2);
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
  animation: pop 0.28s ease-out;
}

@keyframes pop {
  from {
    transform: scale(0.6);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

.qr-badge {
  position: absolute;
  left: 50%;
  bottom: -14px;
  transform: translateX(-50%);
  white-space: nowrap;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--text-1);
  color: #fff;
  font-size: 12px;
  box-shadow: var(--shadow-sm);
}

.scan-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-2);
  min-height: 20px;
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

.status-dot.scanned {
  background: #3b82f6;
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
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.simulate {
  width: 100%;
  border-top: 1px dashed var(--line);
  padding-top: 14px;
}

.simulate-title {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--text-3);
}

.simulate-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.scan-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-3);
  text-align: center;
  max-width: 340px;
}
</style>
