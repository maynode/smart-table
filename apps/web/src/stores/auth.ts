import { computed, reactive } from 'vue';
import {
  clearImpersonatorSession,
  clearSession,
  getImpersonatorSession,
  getStoredUser,
  getToken,
  setImpersonatorSession,
  setSession,
  type StoredUser,
} from '../api/client';

const state = reactive<{
  token: string | null;
  user: StoredUser | null;
  impersonating: boolean;
  impersonatorAccount: string | null;
}>({
  token: getToken(),
  user: getStoredUser(),
  impersonating: false,
  impersonatorAccount: null,
});

function syncImpersonationFlag(): void {
  const stash = getImpersonatorSession();
  state.impersonating = Boolean(stash);
  state.impersonatorAccount = stash?.user.account ?? null;
}

syncImpersonationFlag();

export const auth = {
  state,
  isAuthenticated: computed(() => Boolean(state.token)),
  isImpersonating: computed(() => state.impersonating),
  signIn(token: string, user: StoredUser): void {
    setSession(token, user);
    state.token = token;
    state.user = user;
    syncImpersonationFlag();
  },
  updateUser(user: StoredUser): void {
    if (!state.token) return;
    setSession(state.token, user);
    state.user = user;
  },
  /**
   * 模拟登录：先把当前（管理员）会话存起来，再切到目标用户。
   * 若已在模拟中，保留最初管理员会话，不层层覆盖。
   */
  startImpersonation(token: string, user: StoredUser): void {
    if (!state.token || !state.user) {
      throw new Error('当前未登录，无法模拟');
    }
    if (!getImpersonatorSession()) {
      setImpersonatorSession({ token: state.token, user: { ...state.user } });
    }
    setSession(token, user);
    state.token = token;
    state.user = user;
    syncImpersonationFlag();
  },
  /** 退出模拟，恢复管理员会话；无存档则仅清除当前会话 */
  endImpersonation(): boolean {
    const stash = getImpersonatorSession();
    clearImpersonatorSession();
    if (!stash) {
      clearSession();
      state.token = null;
      state.user = null;
      syncImpersonationFlag();
      return false;
    }
    setSession(stash.token, stash.user);
    state.token = stash.token;
    state.user = stash.user;
    syncImpersonationFlag();
    return true;
  },
  signOut(): void {
    clearSession();
    state.token = null;
    state.user = null;
    syncImpersonationFlag();
  },
};
