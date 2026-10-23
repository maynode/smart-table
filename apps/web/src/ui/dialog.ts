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
  inputType: 'text' | 'password';
  placeholder: string;
  value: string;
  busy: boolean;
}

type Resolver = ((value: string | null) => void) | ((value: boolean) => void);
type PromptSubmit = (value: string) => void | Promise<void>;

const state = reactive<DialogState>({
  open: false,
  mode: 'prompt',
  title: '',
  message: '',
  defaultValue: '',
  confirmLabel: '确定',
  cancelLabel: '取消',
  danger: false,
  inputType: 'text',
  placeholder: '',
  value: '',
  busy: false,
});

let resolveFn: Resolver | null = null;
let promptSubmit: PromptSubmit | null = null;

function close(): void {
  state.open = false;
  state.busy = false;
  resolveFn = null;
  promptSubmit = null;
}

export function useAppDialogState() {
  return state;
}

export function promptDialog(
  title: string,
  defaultValue = '',
  options?: {
    confirmLabel?: string;
    cancelLabel?: string;
    message?: string;
    inputType?: 'text' | 'password';
    placeholder?: string;
    danger?: boolean;
    /**
     * 点确定时调用。成功才关弹窗；抛错则保持弹窗不动（由调用方 toast）。
     */
    onConfirm?: PromptSubmit;
  },
): Promise<string | null> {
  return new Promise((resolve) => {
    if (resolveFn) {
      (resolveFn as (value: string | null) => void)(null);
    }
    resolveFn = resolve as (value: string | null) => void;
    promptSubmit = options?.onConfirm ?? null;
    state.mode = 'prompt';
    state.title = title;
    state.message = options?.message ?? '';
    state.defaultValue = defaultValue;
    state.value = defaultValue;
    state.confirmLabel = options?.confirmLabel ?? '确定';
    state.cancelLabel = options?.cancelLabel ?? '取消';
    state.danger = options?.danger ?? false;
    state.inputType = options?.inputType ?? 'text';
    state.placeholder = options?.placeholder ?? '';
    state.busy = false;
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
    promptSubmit = null;
    state.mode = 'confirm';
    state.title = options?.title ?? '确认';
    state.message = message;
    state.defaultValue = '';
    state.value = '';
    state.confirmLabel = options?.confirmLabel ?? '确定';
    state.cancelLabel = options?.cancelLabel ?? '取消';
    state.danger = options?.danger ?? true;
    state.inputType = 'text';
    state.placeholder = '';
    state.busy = false;
    state.open = true;
  });
}

export function resolveDialog(confirmed: boolean): void {
  if (state.busy) return;

  if (
    confirmed &&
    state.mode === 'prompt' &&
    promptSubmit
  ) {
    void submitPrompt();
    return;
  }

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

async function submitPrompt(): Promise<void> {
  const submit = promptSubmit;
  const resolver = resolveFn;
  if (!submit || !resolver) return;
  const value = state.value;
  state.busy = true;
  try {
    await submit(value);
    close();
    (resolver as (value: string | null) => void)(value);
  } catch {
    // 失败时弹窗不动，错误由 onConfirm 内自行提示
    state.busy = false;
  }
}
