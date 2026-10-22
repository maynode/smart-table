<script setup lang="ts">
import { nextTick, watch } from 'vue';
import { resolveDialog, useAppDialogState } from '../ui/dialog';

const state = useAppDialogState();
const inputRef = (el: unknown) => {
  if (el && state.open && state.mode === 'prompt') {
    void nextTick(() => {
      const node = el as HTMLInputElement;
      node.focus();
      node.select();
    });
  }
};

watch(
  () => state.open,
  (open) => {
    if (!open) return;
    if (state.mode === 'prompt') {
      state.value = state.defaultValue;
    }
  },
);

function onKeydown(event: KeyboardEvent): void {
  if (!state.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    resolveDialog(false);
  } else if (event.key === 'Enter' && state.mode === 'prompt') {
    event.preventDefault();
    resolveDialog(true);
  }
}
</script>

<template>
  <div
    v-if="state.open"
    class="app-dialog-mask"
    data-testid="app-dialog"
    @click.self="resolveDialog(false)"
    @keydown="onKeydown"
  >
    <section class="app-dialog" role="dialog" aria-modal="true">
      <header>
        <h3>{{ state.title }}</h3>
      </header>
      <p v-if="state.mode === 'confirm'" class="app-dialog-message">
        {{ state.message }}
      </p>
      <input
        v-if="state.mode === 'prompt'"
        :ref="inputRef"
        v-model="state.value"
        class="app-dialog-input"
        data-testid="app-dialog-input"
        @keydown="onKeydown"
      />
      <footer>
        <button
          type="button"
          class="btn"
          data-testid="app-dialog-cancel"
          @click="resolveDialog(false)"
        >
          {{ state.cancelLabel }}
        </button>
        <button
          type="button"
          class="btn"
          :class="state.danger ? 'btn-danger' : 'btn-primary'"
          data-testid="app-dialog-confirm"
          @click="resolveDialog(true)"
        >
          {{ state.confirmLabel }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.app-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.34);
}
.app-dialog {
  width: min(400px, 92vw);
  padding: 18px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 24px 72px rgba(15, 23, 42, 0.24);
}
.app-dialog header h3 {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
}
.app-dialog-message {
  margin: 0 0 16px;
  color: #4e5969;
  font-size: 14px;
  line-height: 1.5;
}
.app-dialog-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  height: 36px;
  margin-bottom: 16px;
  padding: 0 10px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
  font-size: 14px;
}
.app-dialog-input:focus {
  outline: none;
  border-color: #2d8cf0;
}
.app-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.app-dialog .btn-danger {
  background: #d92d20;
  border-color: #d92d20;
  color: #fff;
}
.app-dialog .btn-primary {
  background: #2d8cf0;
  border-color: #2d8cf0;
  color: #fff;
}
</style>
