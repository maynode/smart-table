import { endpoints } from '../api/endpoints';

/** 前端埋点：失败静默，不阻断业务 */
export function trackActivity(
  event: 'page.view' | 'panel.open',
  payload: { path?: string; title?: string; meta?: Record<string, unknown> } = {},
): void {
  const path = payload.path ?? '';
  if (path.startsWith('/admin')) return;
  void endpoints.trackActivity({ event, ...payload }).catch(() => undefined);
}
