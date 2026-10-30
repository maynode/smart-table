import { computed, reactive } from 'vue';

const state = reactive({
  open: false,
  accountHint: '',
});

export function useLoginModalState() {
  return state;
}

export const loginModalOpen = computed(() => state.open);

export function openLoginModal(accountHint = ''): void {
  if (state.open) return;
  state.accountHint = accountHint;
  state.open = true;
}

export function closeLoginModal(): void {
  state.open = false;
  state.accountHint = '';
}
