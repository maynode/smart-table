import { computed, reactive } from 'vue';
import {
  clearSession,
  getStoredUser,
  getToken,
  setSession,
  type StoredUser,
} from '../api/client';

const state = reactive<{ token: string | null; user: StoredUser | null }>({
  token: getToken(),
  user: getStoredUser(),
});

export const auth = {
  state,
  isAuthenticated: computed(() => Boolean(state.token)),
  signIn(token: string, user: StoredUser): void {
    setSession(token, user);
    state.token = token;
    state.user = user;
  },
  signOut(): void {
    clearSession();
    state.token = null;
    state.user = null;
  },
};
