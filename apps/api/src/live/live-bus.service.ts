import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type IORedis from 'ioredis';
import type { LiveEvent, LiveEventKind } from 'shared';
import { PrismaService } from '../prisma/prisma.service';
import { createRedisConnection } from '../queue/redis-connection';
import { waitForRedisReady } from '../queue/redis-ready';

const HISTORY_LIMIT = 500;
const CHANNEL_BASE = 'live:base:';
const CHANNEL_WS = 'live:workspace:';
const CHANNEL_USER = 'live:user:';
const SEQ_PREFIX = 'live:seq:';
const HISTORY_PREFIX = 'live:hist:';

export type LiveEmitInput = {
  baseId?: string | null;
  workspaceId?: string | null;
  actorId?: string | null;
  kind: LiveEventKind | string;
  entityId?: string;
  meta?: Record<string, unknown>;
  /** 用户级推送（通知） */
  userId?: string;
};

type LocalFanout = (event: LiveEvent) => void;

@Injectable()
export class LiveBusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveBusService.name);
  private pub: IORedis | null = null;
  private sub: IORedis | null = null;
  private redisOk = false;
  private localFanout: LocalFanout | null = null;
  private readonly memSeq = new Map<string, number>();
  private readonly memHistory = new Map<string, LiveEvent[]>();
  private readonly recentLocalIds = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    const enabled =
      this.config.get<string>('LIVE_REDIS', '1') !== '0' &&
      this.config.get<string>('REDIS_URL') !== 'off';
    if (!enabled) {
      this.logger.log('LiveBus memory-only (LIVE_REDIS=0)');
      return;
    }
    const url = this.config.get<string>(
      'REDIS_URL',
      'redis://127.0.0.1:6379',
    );
    try {
      this.pub = createRedisConnection(url, {
        connectTimeoutMs: 1500,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      this.sub = createRedisConnection(url, {
        connectTimeoutMs: 1500,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      this.pub.on('error', (error) => {
        this.redisOk = false;
        this.logger.warn(`LiveBus Redis pub error: ${String(error)}`);
      });
      this.sub.on('error', (error) => {
        this.redisOk = false;
        this.logger.warn(`LiveBus Redis sub error: ${String(error)}`);
      });
      this.sub.on('pmessage', (_pattern, _channel, payload) => {
        this.onRedisMessage(payload);
      });
      void this.armSubscribe();
    } catch (error) {
      this.logger.warn(
        `LiveBus Redis unavailable, memory-only: ${String(error)}`,
      );
      void this.tearDownRedis();
    }
  }

  private async armSubscribe(): Promise<void> {
    if (!this.pub || !this.sub) return;
    try {
      await Promise.all([
        waitForRedisReady(this.pub),
        waitForRedisReady(this.sub),
      ]);
      await this.sub.psubscribe(
        `${CHANNEL_BASE}*`,
        `${CHANNEL_WS}*`,
        `${CHANNEL_USER}*`,
      );
      this.redisOk = true;
      this.logger.log('LiveBus Redis pub/sub ready');
    } catch (error) {
      this.logger.warn(
        `LiveBus Redis subscribe failed, memory-only: ${String(error)}`,
      );
      this.redisOk = false;
      await this.tearDownRedis();
    }
  }

  isRedisReady(): boolean {
    return this.redisOk;
  }

  private async tearDownRedis(): Promise<void> {
    const pub = this.pub;
    const sub = this.sub;
    this.pub = null;
    this.sub = null;
    this.redisOk = false;
    try {
      await sub?.quit();
    } catch {
      try {
        sub?.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      await pub?.quit();
    } catch {
      try {
        pub?.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.tearDownRedis();
  }

  setLocalFanout(fn: LocalFanout): void {
    this.localFanout = fn;
  }

  async emit(input: LiveEmitInput): Promise<LiveEvent> {
    let baseId = input.baseId ?? null;
    let workspaceId =
      input.workspaceId ??
      (typeof input.meta?.workspaceId === 'string'
        ? input.meta.workspaceId
        : null);

    if (baseId && !workspaceId) {
      try {
        const base = await this.prisma.base.findUnique({
          where: { id: baseId },
          select: { workspaceId: true },
        });
        workspaceId = base?.workspaceId ?? null;
      } catch {
        /* ignore lookup failure */
      }
    }

    const seqKey = baseId
      ? `base:${baseId}`
      : workspaceId
        ? `ws:${workspaceId}`
        : input.userId
          ? `user:${input.userId}`
          : 'global';
    const seq = await this.nextSeq(seqKey);
    const meta = {
      ...(input.meta ?? {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(workspaceId && !input.meta?.workspaceId
        ? { workspaceId }
        : {}),
    };
    const event: LiveEvent = {
      type: 'live_event',
      eventId: randomUUID(),
      seq,
      baseId,
      workspaceId,
      at: new Date().toISOString(),
      actorId: input.actorId ?? null,
      kind: input.kind,
      ...(input.entityId ? { entityId: input.entityId } : {}),
      ...(Object.keys(meta).length ? { meta } : {}),
    };

    // 每个 scope 历史流使用独立 seq，避免 base 序号污染 workspace/user 补洞游标
    this.pushHistory(seqKey, event);
    this.markLocal(event.eventId);
    this.localFanout?.(event);

    if (this.redisOk && this.pub) {
      try {
        if (baseId) {
          await this.publishScoped(
            `base:${baseId}`,
            CHANNEL_BASE + baseId,
            event,
          );
        } else if (workspaceId) {
          await this.publishScoped(
            `ws:${workspaceId}`,
            CHANNEL_WS + workspaceId,
            event,
          );
        } else if (input.userId) {
          await this.publishScoped(
            `user:${input.userId}`,
            CHANNEL_USER + input.userId,
            event,
          );
        }
      } catch (error) {
        this.logger.warn(`LiveBus publish failed: ${String(error)}`);
      }
    }

    if (workspaceId && seqKey !== `ws:${workspaceId}`) {
      await this.mirrorToScope(
        `ws:${workspaceId}`,
        CHANNEL_WS + workspaceId,
        event,
      );
    }
    if (input.userId && seqKey !== `user:${input.userId}`) {
      await this.mirrorToScope(
        `user:${input.userId}`,
        CHANNEL_USER + input.userId,
        event,
      );
    }

    return event;
  }

  /** 次级房历史：同 eventId，独立 seq，供该 scope 的 since/catchup */
  private async mirrorToScope(
    scopeKey: string,
    channel: string,
    primary: LiveEvent,
  ): Promise<void> {
    const seq = await this.nextSeq(scopeKey);
    const copy: LiveEvent = { ...primary, seq };
    this.pushHistory(scopeKey, copy);
    if (this.redisOk && this.pub) {
      try {
        await this.publishScoped(scopeKey, channel, copy);
      } catch (error) {
        this.logger.warn(
          `LiveBus mirror ${scopeKey} failed: ${String(error)}`,
        );
      }
    }
  }

  async latestSeq(scopeKey: string): Promise<number> {
    const key = scopeKey.includes(':') ? scopeKey : `base:${scopeKey}`;
    if (this.redisOk && this.pub) {
      try {
        const raw = await this.pub.get(`${SEQ_PREFIX}${key}`);
        if (raw) return Number(raw) || 0;
      } catch {
        /* fall through */
      }
    }
    return this.memSeq.get(key) ?? 0;
  }

  async eventsSince(scopeKey: string, fromSeq: number): Promise<LiveEvent[]> {
    const key = scopeKey.includes(':') ? scopeKey : `base:${scopeKey}`;
    const all = await this.readHistory(key);
    return all.filter((e) => e.seq > fromSeq).sort((a, b) => a.seq - b.seq);
  }

  private async publishScoped(
    histKey: string,
    channel: string,
    event: LiveEvent,
  ): Promise<void> {
    if (!this.pub) return;
    await this.pub.publish(channel, JSON.stringify(event));
    await this.pub.lpush(`${HISTORY_PREFIX}${histKey}`, JSON.stringify(event));
    await this.pub.ltrim(
      `${HISTORY_PREFIX}${histKey}`,
      0,
      HISTORY_LIMIT - 1,
    );
  }

  private async readHistory(seqKey: string): Promise<LiveEvent[]> {
    if (this.redisOk && this.pub) {
      try {
        const rows = await this.pub.lrange(
          `${HISTORY_PREFIX}${seqKey}`,
          0,
          HISTORY_LIMIT - 1,
        );
        if (rows.length) {
          return rows
            .map((row) => {
              try {
                return JSON.parse(row) as LiveEvent;
              } catch {
                return null;
              }
            })
            .filter((e): e is LiveEvent => Boolean(e));
        }
      } catch {
        /* fall through */
      }
    }
    return [...(this.memHistory.get(seqKey) ?? [])];
  }

  private pushHistory(seqKey: string, event: LiveEvent): void {
    const list = this.memHistory.get(seqKey) ?? [];
    list.push(event);
    while (list.length > HISTORY_LIMIT) list.shift();
    this.memHistory.set(seqKey, list);
  }

  private async nextSeq(seqKey: string): Promise<number> {
    if (this.redisOk && this.pub) {
      try {
        return await this.pub.incr(`${SEQ_PREFIX}${seqKey}`);
      } catch {
        /* fall through */
      }
    }
    const next = (this.memSeq.get(seqKey) ?? 0) + 1;
    this.memSeq.set(seqKey, next);
    return next;
  }

  private onRedisMessage(payload: string): void {
    let event: LiveEvent;
    try {
      event = JSON.parse(payload) as LiveEvent;
    } catch {
      return;
    }
    if (this.recentLocalIds.has(event.eventId)) return;
    this.localFanout?.(event);
  }

  private markLocal(eventId: string): void {
    this.recentLocalIds.add(eventId);
    setTimeout(() => this.recentLocalIds.delete(eventId), 5_000);
  }
}
