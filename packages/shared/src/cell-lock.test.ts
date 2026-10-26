import { CELL_LOCK_TTL_MS, cellLockKey } from './cell-lock';

describe('cellLockKey', () => {
  it('joins sheet/record/field', () => {
    expect(cellLockKey('s', 'r', 'f')).toBe('s\u0000r\u0000f');
  });
});

describe('CELL_LOCK_TTL_MS', () => {
  it('is a short lease suitable for edit sessions', () => {
    expect(CELL_LOCK_TTL_MS).toBeGreaterThanOrEqual(15_000);
    expect(CELL_LOCK_TTL_MS).toBeLessThanOrEqual(120_000);
  });
});
