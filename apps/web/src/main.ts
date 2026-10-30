import { createApp } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import { openLoginModal, useLoginModalState } from './auth/login-modal';
import { router } from './router';
import { auth } from './stores/auth';
import { bootstrapObjectOutbox } from './sync/object-outbox';
import './styles.css';

registerSW({ immediate: true });
bootstrapObjectOutbox();

window.addEventListener('st:unauthorized', () => {
  // 模拟登录中目标账号失效：尽量回到管理员
  if (auth.state.impersonating && auth.endImpersonation()) {
    void router.replace('/admin/users');
    return;
  }
  // 已在登录页 / 已弹出续登窗：避免重复清会话
  if (router.currentRoute.value.path === '/login') {
    auth.signOut();
    return;
  }
  if (useLoginModalState().open) return;

  // 接口鉴权失效：弹窗续登，不跳转、不刷新页面
  const hint = auth.state.user?.account ?? '';
  auth.signOut();
  openLoginModal(hint);
});

createApp(App).use(router).mount('#app');
