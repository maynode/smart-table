import { CELL_LOCK_TTL_MS, cellLockKey } from 'shared';

export type CellLockHolder = {
  recordId: string;
  fieldId: string;
  userId: string;
  account: string;
  name: string;
  color: string;
  expiresAt: number;
};

export type AcquireResult =
  | { ok: true; lock: CellLockHolder; released: CellLockHolder[] }
  | { ok: false; lock: CellLockHolder; released: [] };

/**
 * In-process cell edit leases for one API instance.
 * Multi-instance deploy needs a shared store later; semantics stay the same.
 */
export class CellLockRegistry {
  private readonly locks = new Map<string, CellLockHolder>();

  tryAcquire(params: {
    sheetId: string;
    recordId: string;
    fieldId: string;
    userId: string;
    account: string;
    name: string;
    color: string;
    now?: number;
    ttlMs?: number;
  }): AcquireResult {
    const now = params.now ?? Date.now();
    const ttl = params.ttlMs ?? CELL_LOCK_TTL_MS;
    this.purgeExpired(params.sheetId, now);
    const key = cellLockKey(params.sheetId, params.recordId, params.fieldId);
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > now && existing.userId !== params.userId) {
      return { ok: false, lock: existing, released: [] };
    }
    // One active edit lease per user per sheet: drop other cells they hold.
    const prefix = `${params.sheetId}\u0000`;
    const released: CellLockHolder[] = [];
    for (const [k, held] of this.locks) {
      if (!k.startsWith(prefix)) continue;
      if (held.userId !== params.userId) continue;
      if (k === key) continue;
      this.locks.delete(k);
      released.push(held);
    }
    const lock: CellLockHolder = {
      recordId: params.recordId,
      fieldId: params.fieldId,
      userId: params.userId,
      account: params.account,
      name: params.name,
      color: params.color,
      expiresAt: now + ttl,
    };
    this.locks.set(key, lock);
    return { ok: true, lock, released };
  }

  release(
    sheetId: string,
    recordId: string,
    fieldId: string,
    userId: string,
    now = Date.now(),
  ): CellLockHolder | null {
    const key = cellLockKey(sheetId, recordId, fieldId);
    const existing = this.locks.get(key);
    if (!existing) return null;
    if (existing.userId !== userId) return null;
    if (existing.expiresAt <= now) {
      this.locks.delete(key);
      return null;
    }
    this.locks.delete(key);
    return existing;
  }

  renewForUser(sheetId: string, userId: string, now = Date.now()): void {
    const prefix = `${sheetId}\u0000`;
    for (const [key, lock] of this.locks) {
      if (!key.startsWith(prefix)) continue;
      if (lock.userId !== userId) continue;
      if (lock.expiresAt <= now) {
        this.locks.delete(key);
        continue;
      }
      lock.expiresAt = now + CELL_LOCK_TTL_MS;
    }
  }

  releaseAllForUser(sheetId: string, userId: string): CellLockHolder[] {
    const prefix = `${sheetId}\u0000`;
    const freed: CellLockHolder[] = [];
    for (const [key, lock] of this.locks) {
      if (!key.startsWith(prefix)) continue;
      if (lock.userId !== userId) continue;
      this.locks.delete(key);
      freed.push(lock);
    }
    return freed;
  }

  listForSheet(sheetId: string, now = Date.now()): CellLockHolder[] {
    this.purgeExpired(sheetId, now);
    const prefix = `${sheetId}\u0000`;
    const out: CellLockHolder[] = [];
    for (const [key, lock] of this.locks) {
      if (!key.startsWith(prefix)) continue;
      out.push(lock);
    }
    return out;
  }

  purgeExpired(sheetId: string, now = Date.now()): void {
    const prefix = `${sheetId}\u0000`;
    for (const [key, lock] of this.locks) {
      if (!key.startsWith(prefix)) continue;
      if (lock.expiresAt <= now) this.locks.delete(key);
    }
  }
}
