import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  offlineBlockMessage,
  offlineDecision,
} from './offline-capability';

describe('offline-capability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows everything while online', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(offlineDecision('automation.run')).toBe('allow');
    expect(offlineDecision('dashboard.ai')).toBe('allow');
  });

  it('queues grid edits and blocks AI/run offline', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(offlineDecision('grid.editCell')).toBe('queue');
    expect(offlineDecision('grid.browse')).toBe('allow');
    expect(offlineDecision('automation.run')).toBe('block');
    expect(offlineDecision('dashboard.ai')).toBe('block');
    expect(offlineDecision('acl.write')).toBe('block');
    expect(offlineBlockMessage('automation.run')).toMatch(/自动化/);
  });
});
