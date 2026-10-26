import { CellLockRegistry } from './cell-lock.registry';

describe('CellLockRegistry', () => {
  const base = {
    sheetId: 'sheet-1',
    recordId: 'rec-1',
    fieldId: 'fld-1',
    account: 'a',
    name: 'Alice',
    color: '#f00',
  };

  it('grants first acquire and denies second user', () => {
    const reg = new CellLockRegistry();
    const t0 = 1_000_000;
    const a = reg.tryAcquire({ ...base, userId: 'u1', now: t0 });
    expect(a.ok).toBe(true);
    const b = reg.tryAcquire({ ...base, userId: 'u2', name: 'Bob', now: t0 + 1000 });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.lock.userId).toBe('u1');
  });

  it('allows same user to re-acquire and renew', () => {
    const reg = new CellLockRegistry();
    const t0 = 1_000_000;
    expect(reg.tryAcquire({ ...base, userId: 'u1', now: t0 }).ok).toBe(true);
    expect(reg.tryAcquire({ ...base, userId: 'u1', now: t0 + 5000 }).ok).toBe(
      true,
    );
    reg.renewForUser('sheet-1', 'u1', t0 + 10_000);
    const denied = reg.tryAcquire({
      ...base,
      userId: 'u2',
      now: t0 + 20_000,
    });
    expect(denied.ok).toBe(false);
  });

  it('expires and frees the cell', () => {
    const reg = new CellLockRegistry();
    const t0 = 1_000_000;
    reg.tryAcquire({ ...base, userId: 'u1', now: t0, ttlMs: 1000 });
    const next = reg.tryAcquire({
      ...base,
      userId: 'u2',
      now: t0 + 2000,
      ttlMs: 1000,
    });
    expect(next.ok).toBe(true);
  });

  it('switching cells releases the previous lease for that user', () => {
    const reg = new CellLockRegistry();
    const first = reg.tryAcquire({ ...base, userId: 'u1', fieldId: 'f1' });
    expect(first.ok).toBe(true);
    const second = reg.tryAcquire({ ...base, userId: 'u1', fieldId: 'f2' });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.released).toHaveLength(1);
      expect(second.released[0]?.fieldId).toBe('f1');
    }
    const listed = reg.listForSheet('sheet-1');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.fieldId).toBe('f2');
  });

  it('releaseAllForUser clears every lock on the sheet', () => {
    const reg = new CellLockRegistry();
    reg.tryAcquire({ ...base, userId: 'u1', fieldId: 'f1' });
    // Simulate two locks via direct path: second user keeps another cell.
    reg.tryAcquire({
      ...base,
      userId: 'u2',
      name: 'Bob',
      fieldId: 'f2',
    });
    // Force-hold a second lock for u1 by acquiring then manually... one-lease
    // rule means u1 only has f1; releaseAll still clears that one.
    const freed = reg.releaseAllForUser('sheet-1', 'u1');
    expect(freed).toHaveLength(1);
    expect(reg.listForSheet('sheet-1').map((l) => l.userId)).toEqual(['u2']);
  });
});
