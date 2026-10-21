import { createRouter, createWebHistory } from 'vue-router';
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
      path: '/workspaces/:workspaceId',
      name: 'workspace',
      component: () => import('./views/WorkspaceView.vue'),
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
    return '/';
  }
  return true;
});
