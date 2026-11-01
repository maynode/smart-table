<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import { useViewport } from '../composables/useViewport';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    /** When true, sheet takes nearly full viewport on phone */
    fullscreen?: boolean;
    testId?: string;
  }>(),
  { title: '', fullscreen: true, testId: 'mobile-sheet' },
);

const emit = defineEmits<{ close: [] }>();
const { isPhone } = useViewport();

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape' && props.open) emit('close');
}

watch(
  () => props.open,
  (open) => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = open ? 'hidden' : '';
  },
  { immediate: true },
);

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onKeydown);
}
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeydown);
  }
  if (typeof document !== 'undefined') {
    document.body.style.overflow = '';
  }
});

function onMaskClick() {
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="mobile-sheet-root"
      :class="{ 'is-phone': isPhone, 'is-fullscreen': fullscreen }"
      role="dialog"
      aria-modal="true"
      :aria-label="title || '面板'"
      :data-testid="testId"
    >
      <div
        class="mobile-sheet-mask"
        aria-hidden="true"
        @click="onMaskClick"
      />
      <div class="mobile-sheet-panel">
        <header v-if="title || $slots.header" class="mobile-sheet-header">
          <slot name="header">
            <h2 class="mobile-sheet-title">{{ title }}</h2>
          </slot>
          <button
            type="button"
            class="mobile-sheet-close touch-target"
            data-testid="mobile-sheet-close"
            aria-label="关闭"
            @click="emit('close')"
          >
            ✕
          </button>
        </header>
        <div class="mobile-sheet-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="mobile-sheet-footer">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mobile-sheet-root {
  position: fixed;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.mobile-sheet-root:not(.is-phone) {
  align-items: center;
  padding: 24px;
}

.mobile-sheet-mask {
  position: absolute;
  inset: 0;
  border: 0;
  padding: 0;
  margin: 0;
  background: rgba(15, 20, 25, 0.45);
  cursor: pointer;
}

.mobile-sheet-panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(520px, 100%);
  max-height: min(90vh, 720px);
  background: var(--bg);
  border-radius: 16px 16px 0 0;
  box-shadow: var(--shadow);
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.mobile-sheet-root:not(.is-phone) .mobile-sheet-panel {
  border-radius: var(--radius);
  max-height: min(85vh, 800px);
}

.mobile-sheet-root.is-phone.is-fullscreen .mobile-sheet-panel {
  width: 100%;
  max-height: none;
  height: 100%;
  border-radius: 0;
  padding-top: env(safe-area-inset-top, 0);
}

.mobile-sheet-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.mobile-sheet-title {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.mobile-sheet-close {
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
}

.mobile-sheet-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

.mobile-sheet-footer {
  flex-shrink: 0;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0));
}
</style>
