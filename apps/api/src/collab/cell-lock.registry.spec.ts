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

  it('grants first acquire and denies second user', async () => {
    const reg = new CellLockRegistry();
    const t0 = 1_000_000;
    const a = await reg.tryAcquire({ ...base, userId: 'u1', now: t0 });
    expect(a.ok).toBe(true);
    const b = await reg.tryAcquire({
      ...base,
      userId: 'u2',
      name: 'Bob',
      now: t0 + 1000,
    });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.lock.userId).toBe('u1');
  });

  it('allows same user to re-acquire and renew', async () => {
    const reg = new CellLockRegistry();
    const t0 = 1_000_000;
    expect(
      (await reg.tryAcquire({ ...base, userId: 'u1', now: t0 })).ok,
    ).toBe(true);
    expect(
      (await reg.tryAcquire({ ...base, userId: 'u1', now: t0 + 5000 })).ok,
    ).toBe(true);
    await reg.renewForUser('sheet-1', 'u1', t0 + 10_000);
    const denied = await reg.tryAcquire({
      ...base,
      userId: 'u2',
      now: t0 + 20_000,
    });
    expect(denied.ok).toBe(false);
  });

  it('expires and frees the cell', async () => {
    const reg = new CellLockRegistry();
    const t0 = 1_000_000;
    await reg.tryAcquire({ ...base, userId: 'u1', now: t0, ttlMs: 1000 });
    const next = await reg.tryAcquire({
      ...base,
      userId: 'u2',
      now: t0 + 2000,
      ttlMs: 1000,
    });
    expect(next.ok).toBe(true);
  });

  it('switching cells releases the previous lease for that user', async () => {
    const reg = new CellLockRegistry();
    const first = await reg.tryAcquire({ ...base, userId: 'u1', fieldId: 'f1' });
    expect(first.ok).toBe(true);
    const second = await reg.tryAcquire({
      ...base,
      userId: 'u1',
      fieldId: 'f2',
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.released).toHaveLength(1);
      expect(second.released[0]?.fieldId).toBe('f1');
    }
    const listed = await reg.listForSheet('sheet-1');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.fieldId).toBe('f2');
  });

  it('releaseAllForUser clears every lock on the sheet', async () => {
    const reg = new CellLockRegistry();
    await reg.tryAcquire({ ...base, userId: 'u1', fieldId: 'f1' });
    await reg.tryAcquire({
      ...base,
      userId: 'u2',
      name: 'Bob',
      fieldId: 'f2',
    });
    const freed = await reg.releaseAllForUser('sheet-1', 'u1');
    expect(freed).toHaveLength(1);
    expect((await reg.listForSheet('sheet-1')).map((l) => l.userId)).toEqual([
      'u2',
    ]);
  });

  it('redis-backed acquire denies second user via mock', async () => {
    const store = new Map<string, string>();
    const redis = {
      eval: jest.fn(async (_script: string, _n: number, ...args: string[]) => {
        const cellKey = args[0]!;
        const userKey = args[1]!;
        const userId = args[2]!;
        const ttl = Number(args[3]);
        const payload = args[4]!;
        const now = Number(args[5]);
        const existing = store.get(cellKey);
        if (existing) {
          const holder = JSON.parse(existing) as { expiresAt: number; userId: string };
          if (holder.expiresAt > now && holder.userId !== userId) {
            return [0, existing, ''];
          }
        }
        let released = '';
        const prev = store.get(userKey);
        if (prev && prev !== cellKey) {
          released = store.get(prev) ?? '';
          store.delete(prev);
        }
        store.set(cellKey, payload);
        store.set(userKey, cellKey);
        void ttl;
        return [1, payload, released];
      }),
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      del: jest.fn(async (key: string) => {
        store.delete(key);
        return 1;
      }),
      mget: jest.fn(async (...keys: string[]) =>
        keys.map((k) => store.get(k) ?? null),
      ),
      scan: jest.fn(async () => ['0', [...store.keys()].filter((k) => k.includes('cell:'))]),
    };
    const reg = new CellLockRegistry(redis as never);
    const t0 = 1_000_000;
    expect(
      (await reg.tryAcquire({ ...base, userId: 'u1', now: t0 })).ok,
    ).toBe(true);
    const denied = await reg.tryAcquire({
      ...base,
      userId: 'u2',
      name: 'Bob',
      now: t0 + 100,
    });
    expect(denied.ok).toBe(false);
  });
});
