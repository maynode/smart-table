<script setup lang="ts">
import { computed } from 'vue'
import type { SessionUser } from '../api'

const props = defineProps<{ user: SessionUser | null }>()
const emit = defineEmits<{ (e: 'logout'): void }>()

const providerLabel = computed(() => {
  if (props.user?.provider === 'github') return 'GitHub OAuth'
  if (props.user?.provider === 'wechat-mini') return '微信小程序 · 真'
  return '微信扫码（mock）'
})

function short(value?: string): string {
  if (!value) return '—'
  if (value.length <= 18) return value
  return `${value.slice(0, 10)}…${value.slice(-6)}`
}

function expiry(value?: number): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <section class="card session">
    <header class="card-head">
      <h2>当前会话</h2>
      <span v-if="user" class="chip ok">{{ providerLabel }}</span>
      <span v-else class="chip">未登录</span>
    </header>

    <div v-if="user" class="user">
      <img v-if="user.avatar" class="avatar" :src="user.avatar" :alt="user.nickname" />
      <div v-else class="avatar fallback">{{ user.nickname.slice(0, 1) }}</div>
      <div class="who">
        <p class="name">{{ user.nickname }}</p>
        <p class="sub">uid · {{ short(user.uid) }}</p>
      </div>
    </div>

    <dl v-if="user" class="kv">
      <div><dt>openid</dt><dd>{{ short(user.openid) }}</dd></div>
      <div><dt>unionid</dt><dd>{{ short(user.unionid) }}</dd></div>
      <div><dt>会话到期</dt><dd>{{ expiry(user.expiresAt) }}</dd></div>
    </dl>

    <p v-if="!user" class="empty">
      扫码或走 GitHub 授权后，这里会显示服务端签发的会话信息。刷新页面仍保持登录态（HttpOnly cookie）。
    </p>

    <button v-if="user" class="btn ghost block" @click="emit('logout')">退出登录</button>
  </section>
</template>

<style scoped>
.session {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.card-head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.user {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  object-fit: cover;
  background: var(--bg-soft);
}

.avatar.fallback {
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, #10b981, #059669);
}

.who .name {
  margin: 0 0 2px;
  font-size: 14px;
  font-weight: 600;
}

.who .sub {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-3);
  font-family: var(--mono);
}

.kv {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  background: var(--bg-soft);
  font-size: 12px;
}

.kv div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.kv dt {
  color: var(--text-3);
}

.kv dd {
  margin: 0;
  font-family: var(--mono);
  color: var(--text-2);
}

.empty {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--text-3);
}
</style>
