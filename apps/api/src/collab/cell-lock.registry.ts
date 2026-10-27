import type IORedis from 'ioredis';
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

const REDIS_CELL_PREFIX = 'st:cellock:cell:';
const REDIS_USER_PREFIX = 'st:cellock:user:';

function redisCellKey(sheetId: string, recordId: string, fieldId: string): string {
  return `${REDIS_CELL_PREFIX}${sheetId}:${recordId}:${fieldId}`;
}

function redisUserKey(sheetId: string, userId: string): string {
  return `${REDIS_USER_PREFIX}${sheetId}:${userId}`;
}

function parseHolder(raw: string | null): CellLockHolder | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CellLockHolder;
  } catch {
    return null;
  }
}

/**
 * Cell edit leases. In-memory by default; when Redis is provided, leases are
 * shared across API replicas (SET NX + TTL + per-user single lease).
 */
export class CellLockRegistry {
  private readonly locks = new Map<string, CellLockHolder>();

  constructor(private readonly redis: IORedis | null = null) {}

  async tryAcquire(params: {
    sheetId: string;
    recordId: string;
    fieldId: string;
    userId: string;
    account: string;
    name: string;
    color: string;
    now?: number;
    ttlMs?: number;
  }): Promise<AcquireResult> {
    if (this.redis) return this.tryAcquireRedis(params);
    return this.tryAcquireMemory(params);
  }

  async release(
    sheetId: string,
    recordId: string,
    fieldId: string,
    userId: string,
    now = Date.now(),
  ): Promise<CellLockHolder | null> {
    if (this.redis) {
      return this.releaseRedis(sheetId, recordId, fieldId, userId, now);
    }
    return this.releaseMemory(sheetId, recordId, fieldId, userId, now);
  }

  async renewForUser(
    sheetId: string,
    userId: string,
    now = Date.now(),
  ): Promise<void> {
    if (this.redis) {
      await this.renewForUserRedis(sheetId, userId, now);
      return;
    }
    this.renewForUserMemory(sheetId, userId, now);
  }

  async releaseAllForUser(
    sheetId: string,
    userId: string,
  ): Promise<CellLockHolder[]> {
    if (this.redis) return this.releaseAllForUserRedis(sheetId, userId);
    return this.releaseAllForUserMemory(sheetId, userId);
  }

  async listForSheet(
    sheetId: string,
    now = Date.now(),
  ): Promise<CellLockHolder[]> {
    if (this.redis) return this.listForSheetRedis(sheetId, now);
    return this.listForSheetMemory(sheetId, now);
  }

  // --- memory -----------------------------------------------------------

  private tryAcquireMemory(params: {
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

  private releaseMemory(
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

  private renewForUserMemory(
    sheetId: string,
    userId: string,
    now = Date.now(),
  ): void {
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

  private releaseAllForUserMemory(
    sheetId: string,
    userId: string,
  ): CellLockHolder[] {
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

  private listForSheetMemory(
    sheetId: string,
    now = Date.now(),
  ): CellLockHolder[] {
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

  // --- redis ------------------------------------------------------------

  private async tryAcquireRedis(params: {
    sheetId: string;
    recordId: string;
    fieldId: string;
    userId: string;
    account: string;
    name: string;
    color: string;
    now?: number;
    ttlMs?: number;
  }): Promise<AcquireResult> {
    const redis = this.redis!;
    const now = params.now ?? Date.now();
    const ttl = params.ttlMs ?? CELL_LOCK_TTL_MS;
    const cellKey = redisCellKey(
      params.sheetId,
      params.recordId,
      params.fieldId,
    );
    const userKey = redisUserKey(params.sheetId, params.userId);
    const lock: CellLockHolder = {
      recordId: params.recordId,
      fieldId: params.fieldId,
      userId: params.userId,
      account: params.account,
      name: params.name,
      color: params.color,
      expiresAt: now + ttl,
    };
    const payload = JSON.stringify(lock);
    // Atomic: deny if other holder; else release prior user lease + set
    const result = (await redis.eval(
      `
      local cellKey = KEYS[1]
      local userKey = KEYS[2]
      local userId = ARGV[1]
      local ttl = tonumber(ARGV[2])
      local payload = ARGV[3]
      local now = tonumber(ARGV[4])
      local existing = redis.call('GET', cellKey)
      if existing then
        local holder = cjson.decode(existing)
        if holder.expiresAt > now and holder.userId ~= userId then
          return {0, existing, ''}
        end
      end
      local released = ''
      local prev = redis.call('GET', userKey)
      if prev and prev ~= cellKey then
        local prevData = redis.call('GET', prev)
        if prevData then released = prevData end
        redis.call('DEL', prev)
      end
      redis.call('SET', cellKey, payload, 'PX', ttl)
      redis.call('SET', userKey, cellKey, 'PX', ttl)
      return {1, payload, released}
      `,
      2,
      cellKey,
      userKey,
      params.userId,
      String(ttl),
      payload,
      String(now),
    )) as [number | string, string, string];

    const ok = Number(result[0]) === 1;
    if (!ok) {
      const holder = parseHolder(result[1]) ?? lock;
      return { ok: false, lock: holder, released: [] };
    }
    const releasedRaw = result[2];
    const released = releasedRaw ? [parseHolder(releasedRaw)].filter(Boolean) as CellLockHolder[] : [];
    return { ok: true, lock, released };
  }

  private async releaseRedis(
    sheetId: string,
    recordId: string,
    fieldId: string,
    userId: string,
    now = Date.now(),
  ): Promise<CellLockHolder | null> {
    const redis = this.redis!;
    const cellKey = redisCellKey(sheetId, recordId, fieldId);
    const existing = parseHolder(await redis.get(cellKey));
    if (!existing) return null;
    if (existing.userId !== userId) return null;
    if (existing.expiresAt <= now) {
      await redis.del(cellKey);
      return null;
    }
    await redis.del(cellKey);
    const userKey = redisUserKey(sheetId, userId);
    const mapped = await redis.get(userKey);
    if (mapped === cellKey) await redis.del(userKey);
    return existing;
  }

  private async renewForUserRedis(
    sheetId: string,
    userId: string,
    now = Date.now(),
  ): Promise<void> {
    const redis = this.redis!;
    const userKey = redisUserKey(sheetId, userId);
    const cellKey = await redis.get(userKey);
    if (!cellKey) return;
    const lock = parseHolder(await redis.get(cellKey));
    if (!lock || lock.userId !== userId) {
      await redis.del(userKey);
      return;
    }
    if (lock.expiresAt <= now) {
      await redis.del(cellKey);
      await redis.del(userKey);
      return;
    }
    lock.expiresAt = now + CELL_LOCK_TTL_MS;
    await redis.set(cellKey, JSON.stringify(lock), 'PX', CELL_LOCK_TTL_MS);
    await redis.set(userKey, cellKey, 'PX', CELL_LOCK_TTL_MS);
  }

  private async releaseAllForUserRedis(
    sheetId: string,
    userId: string,
  ): Promise<CellLockHolder[]> {
    const redis = this.redis!;
    const userKey = redisUserKey(sheetId, userId);
    const cellKey = await redis.get(userKey);
    const freed: CellLockHolder[] = [];
    if (cellKey) {
      const lock = parseHolder(await redis.get(cellKey));
      if (lock) freed.push(lock);
      await redis.del(cellKey);
    }
    await redis.del(userKey);
    return freed;
  }

  private async listForSheetRedis(
    sheetId: string,
    now = Date.now(),
  ): Promise<CellLockHolder[]> {
    const redis = this.redis!;
    const pattern = `${REDIS_CELL_PREFIX}${sheetId}:*`;
    const out: CellLockHolder[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = next;
      if (keys.length) {
        const values = await redis.mget(...keys);
        for (let i = 0; i < keys.length; i += 1) {
          const lock = parseHolder(values[i] ?? null);
          if (!lock) continue;
          if (lock.expiresAt <= now) {
            await redis.del(keys[i]!);
            continue;
          }
          out.push(lock);
        }
      }
    } while (cursor !== '0');
    return out;
  }
}
