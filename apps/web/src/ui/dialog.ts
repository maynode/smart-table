import { reactive } from 'vue';

export type DialogMode = 'prompt' | 'confirm';

export interface DialogState {
  open: boolean;
  mode: DialogMode;
  title: string;
  message: string;
  defaultValue: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  value: string;
}

type Resolver = ((value: string | null) => void) | ((value: boolean) => void);

const state = reactive<DialogState>({
  open: false,
  mode: 'prompt',
  title: '',
  message: '',
  defaultValue: '',
  confirmLabel: '确定',
  cancelLabel: '取消',
  danger: false,
  value: '',
});

let resolveFn: Resolver | null = null;

function close(): void {
  state.open = false;
  resolveFn = null;
}

export function useAppDialogState() {
  return state;
}

export function promptDialog(
  title: string,
  defaultValue = '',
  options?: { confirmLabel?: string; cancelLabel?: string },
): Promise<string | null> {
  return new Promise((resolve) => {
    if (resolveFn) {
      (resolveFn as (value: string | null) => void)(null);
    }
    resolveFn = resolve as (value: string | null) => void;
    state.mode = 'prompt';
    state.title = title;
    state.message = '';
    state.defaultValue = defaultValue;
    state.value = defaultValue;
    state.confirmLabel = options?.confirmLabel ?? '确定';
    state.cancelLabel = options?.cancelLabel ?? '取消';
    state.danger = false;
    state.open = true;
  });
}

export function confirmDialog(
  message: string,
  options?: {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  },
): Promise<boolean> {
  return new Promise((resolve) => {
    if (resolveFn) {
      (resolveFn as (value: boolean) => void)(false);
    }
    resolveFn = resolve as (value: boolean) => void;
    state.mode = 'confirm';
    state.title = options?.title ?? '确认';
    state.message = message;
    state.defaultValue = '';
    state.value = '';
    state.confirmLabel = options?.confirmLabel ?? '确定';
    state.cancelLabel = options?.cancelLabel ?? '取消';
    state.danger = options?.danger ?? true;
    state.open = true;
  });
}

export function resolveDialog(confirmed: boolean): void {
  const resolver = resolveFn;
  const mode = state.mode;
  const value = state.value;
  close();
  if (!resolver) return;
  if (mode === 'prompt') {
    if (!confirmed) {
      (resolver as (value: string | null) => void)(null);
      return;
    }
    (resolver as (value: string | null) => void)(value);
    return;
  }
  (resolver as (value: boolean) => void)(confirmed);
}
