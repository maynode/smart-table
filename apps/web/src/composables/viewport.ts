export type ViewportMode = 'phone' | 'tablet' | 'desktop';

/** Spec §4: phone <768, tablet 768–1099, desktop ≥1100 */
export const BP_PHONE_MAX = 767;
export const BP_TABLET_MAX = 1099;

export function viewportModeFromWidth(width: number): ViewportMode {
  if (width <= BP_PHONE_MAX) return 'phone';
  if (width <= BP_TABLET_MAX) return 'tablet';
  return 'desktop';
}

export function shouldShowStationNav(opts: {
  authed: boolean;
  path: string;
}): boolean {
  if (!opts.authed) return false;
  const p = opts.path;
  if (p === '/login' || p.startsWith('/login/')) return false;
  if (p.startsWith('/fill/')) return false;
  if (p.startsWith('/view/')) return false;
  if (p.startsWith('/dev/')) return false;
  // Base shell: /workspaces/:ws/bases/:baseId
  if (/^\/workspaces\/[^/]+\/bases\/[^/]+/.test(p)) return false;
  return true;
}
