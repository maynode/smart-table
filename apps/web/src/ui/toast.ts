import { reactive } from 'vue';

export interface ToastItem {
  id: number;
  text: string;
}

export const toasts = reactive<ToastItem[]>([]);
let nextId = 1;

export function toast(text: string): void {
  const id = nextId;
  nextId += 1;
  toasts.push({ id, text });
  window.setTimeout(() => {
    const index = toasts.findIndex((item) => item.id === id);
    if (index >= 0) toasts.splice(index, 1);
  }, 2600);
}
