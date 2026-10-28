import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type IORedis from 'ioredis';
import { createRedisConnection } from '../queue/redis-connection';
import type { CollabServerMsg } from './collab.types';

const CHANNEL_PREFIX = 'collab:sheet:';

type LocalHandler = (sheetId: string, msg: CollabServerMsg) => void;

type FanoutEnvelope = {
  origin: string;
  sheetId: string;
  msg: CollabServerMsg;
};

/**
 * Cross-replica collab fanout (COLLAB-SCALE S3).
 * Publishes room broadcasts so other API pods can deliver to their sockets.
 */
@Injectable()
export class CollabFanoutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CollabFanoutService.name);
  private readonly originId = randomUUID();
  private pub: IORedis | null = null;
  private sub: IORedis | null = null;
  private redisOk = false;
  private localHandler: LocalHandler | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const enabled =
      this.config.get<string>('COLLAB_REDIS', '1') !== '0' &&
      this.config.get<string>('REDIS_URL') !== 'off';
    if (!enabled) {
      this.logger.log('CollabFanout memory-only (COLLAB_REDIS=0)');
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
        this.logger.warn(`CollabFanout Redis pub error: ${String(error)}`);
      });
      this.sub.on('error', (error) => {
        this.redisOk = false;
        this.logger.warn(`CollabFanout Redis sub error: ${String(error)}`);
      });
      this.sub.on('pmessage', (_pattern, _channel, payload) => {
        this.onRedisMessage(payload);
      });
      void this.sub
        .psubscribe(`${CHANNEL_PREFIX}*`)
        .then(() => {
          this.redisOk = true;
          this.logger.log('CollabFanout Redis pub/sub ready');
        })
        .catch((error) => {
          this.logger.warn(
            `CollabFanout Redis subscribe failed, memory-only: ${String(error)}`,
          );
          this.redisOk = false;
          void this.tearDownRedis();
        });
    } catch (error) {
      this.logger.warn(
        `CollabFanout Redis unavailable, memory-only: ${String(error)}`,
      );
      void this.tearDownRedis();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.tearDownRedis();
  }

  setLocalHandler(handler: LocalHandler): void {
    this.localHandler = handler;
  }

  /** Publish to other replicas. No-op when Redis off or publish fails. */
  async publish(sheetId: string, msg: CollabServerMsg): Promise<void> {
    if (!this.pub || !this.redisOk) return;
    const envelope: FanoutEnvelope = {
      origin: this.originId,
      sheetId,
      msg,
    };
    try {
      await this.pub.publish(
        `${CHANNEL_PREFIX}${sheetId}`,
        JSON.stringify(envelope),
      );
    } catch (error) {
      this.logger.warn(`CollabFanout publish failed: ${String(error)}`);
    }
  }

  private onRedisMessage(payload: string): void {
    let envelope: FanoutEnvelope;
    try {
      envelope = JSON.parse(payload) as FanoutEnvelope;
    } catch {
      return;
    }
    if (!envelope?.sheetId || !envelope.msg) return;
    if (envelope.origin === this.originId) return;
    this.localHandler?.(envelope.sheetId, envelope.msg);
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
}
