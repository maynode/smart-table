<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { LogEvent } from '../types'

const props = defineProps<{ events: LogEvent[] }>()
const emit = defineEmits<{ (e: 'clear'): void }>()

const box = ref<HTMLElement | null>(null)

watch(
  () => props.events.length,
  async () => {
    await nextTick()
    if (box.value) box.value.scrollTop = box.value.scrollHeight
  },
)
</script>

<template>
  <section class="card log">
    <header class="card-head">
      <h2>事件流</h2>
      <button class="link" @click="emit('clear')">清空</button>
    </header>

    <div ref="box" class="log-box">
      <p v-if="!events.length" class="log-empty">还没有事件。扫码、确认、兑换都会记录在这里。</p>
      <p v-for="event in events" :key="event.id" class="log-line" :class="event.level">
        <span class="log-time">{{ event.time }}</span>
        <span class="log-level">{{ event.level }}</span>
        <span class="log-text">{{ event.text }}</span>
      </p>
    </div>
  </section>
</template>

<style scoped>
.log {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.log-box {
  height: 260px;
  overflow-y: auto;
  border-radius: 12px;
  background: #0b1220;
  padding: 10px 12px;
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.7;
  color: #cbd5e1;
  scrollbar-width: thin;
}

.log-empty {
  margin: 0;
  color: #64748b;
}

.log-line {
  margin: 0 0 2px;
  display: flex;
  gap: 8px;
  align-items: baseline;
  word-break: break-word;
}

.log-time {
  color: #64748b;
  flex-shrink: 0;
}

.log-level {
  flex-shrink: 0;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.04em;
  width: 34px;
}

.log-line.info .log-level {
  color: #7dd3fc;
}

.log-line.ok .log-level {
  color: #34d399;
}

.log-line.warn .log-level {
  color: #fbbf24;
}

.log-line.err .log-level {
  color: #f87171;
}

.log-line.ok .log-text {
  color: #a7f3d0;
}
</style>
