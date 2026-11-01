import { describe, expect, it } from 'vitest';
import {
  shouldShowStationNav,
  viewportModeFromWidth,
} from './viewport';

describe('viewportModeFromWidth', () => {
  it('maps phone / tablet / desktop bands', () => {
    expect(viewportModeFromWidth(390)).toBe('phone');
    expect(viewportModeFromWidth(767)).toBe('phone');
    expect(viewportModeFromWidth(768)).toBe('tablet');
    expect(viewportModeFromWidth(800)).toBe('tablet');
    expect(viewportModeFromWidth(1099)).toBe('tablet');
    expect(viewportModeFromWidth(1100)).toBe('desktop');
    expect(viewportModeFromWidth(1200)).toBe('desktop');
  });
});

describe('shouldShowStationNav', () => {
  it('hides when logged out or on public/base routes', () => {
    expect(shouldShowStationNav({ authed: false, path: '/' })).toBe(false);
    expect(
      shouldShowStationNav({ authed: true, path: '/login' }),
    ).toBe(false);
    expect(
      shouldShowStationNav({ authed: true, path: '/fill/tok' }),
    ).toBe(false);
    expect(
      shouldShowStationNav({ authed: true, path: '/view/tok' }),
    ).toBe(false);
    expect(
      shouldShowStationNav({ authed: true, path: '/dev/grid-bench' }),
    ).toBe(false);
    expect(
      shouldShowStationNav({
        authed: true,
        path: '/workspaces/w1/bases/b1',
      }),
    ).toBe(false);
    expect(
      shouldShowStationNav({
        authed: true,
        path: '/workspaces/w1/bases/b1?face=data',
      }),
    ).toBe(false);
  });

  it('shows on station routes including admin', () => {
    expect(shouldShowStationNav({ authed: true, path: '/' })).toBe(true);
    expect(
      shouldShowStationNav({ authed: true, path: '/notifications' }),
    ).toBe(true);
    expect(shouldShowStationNav({ authed: true, path: '/me' })).toBe(true);
    expect(
      shouldShowStationNav({ authed: true, path: '/admin/users' }),
    ).toBe(true);
  });
});
