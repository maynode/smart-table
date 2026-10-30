import { createRouter, createWebHistory } from 'vue-router';
import { resolvePostLoginPath } from './auth/post-login-path';
import { auth } from './stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('./views/LoginView.vue'),
    },
    {
      path: '/',
      name: 'home',
      component: () => import('./views/HomeView.vue'),
    },
    {
      path: '/notifications',
      name: 'notifications',
      component: () => import('./views/NotificationsView.vue'),
    },
    {
      path: '/admin/feedback',
      name: 'admin-feedback',
      component: () => import('./views/AdminFeedbackView.vue'),
    },
    {
      path: '/admin/users',
      name: 'admin-users',
      component: () => import('./views/AdminUsersView.vue'),
    },
    {
      path: '/admin/activity',
      name: 'admin-activity',
      component: () => import('./views/AdminActivityView.vue'),
    },
    {
      path: '/workspaces/:workspaceId',
      redirect: (to) => ({
        path: '/',
        query: { ws: String(to.params.workspaceId) },
      }),
    },
    {
      path: '/workspaces/:workspaceId/bases/:baseId',
      name: 'base',
      component: () => import('./views/BaseShellView.vue'),
    },
    {
      path: '/fill/:token',
      name: 'form-fill',
      component: () => import('./views/FormFillView.vue'),
    },
    {
      path: '/view/:token',
      name: 'public-view',
      component: () => import('./views/PublicViewView.vue'),
    },
    {
      path: '/dev/grid-bench',
      name: 'grid-bench',
      component: () => import('./views/GridBenchView.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach((to) => {
  const hasToken = Boolean(auth.state.token);
  const isPublic =
    to.path === '/login' ||
    to.path.startsWith('/dev/') ||
    to.path.startsWith('/fill/') ||
    to.path.startsWith('/view/');
  if (!isPublic && !hasToken) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.path === '/login' && hasToken) {
    return resolvePostLoginPath(to.query.redirect, auth.state.user);
  }
  return true;
});

router.afterEach((to) => {
  if (!auth.state.token) return;
  if (to.path.startsWith('/admin') || to.path === '/login') return;
  if (to.path.startsWith('/dev/')) return;
  void import('./activity/track').then(({ trackActivity }) => {
    const title =
      typeof to.name === 'string'
        ? (
            {
              home: '首页',
              notifications: '消息中心',
              base: '智能表',
              'form-fill': '填写表单',
              'public-view': '公开视图',
            } as Record<string, string>
          )[to.name] || to.name
        : undefined;
    trackActivity('page.view', { path: to.fullPath, title });
  });
});
