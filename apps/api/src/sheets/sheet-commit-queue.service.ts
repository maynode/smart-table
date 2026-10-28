import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type IORedis from 'ioredis';
import type { CommitChangesResponse } from 'shared';
import { MetricsService } from '../metrics/metrics.service';
import { createRedisConnection } from '../queue/redis-connection';
import type { CommitChangesDto } from './dto/commit-changes.dto';
import { CommitChangesService } from './commit-changes.service';

const QUEUE_NAME = 'sheet-commits';
const LOCK_PREFIX = 'st:sheet-actor:';
const LOCK_TTL_MS = 60_000;
const WAIT_MS = 30_000;

export type SheetCommitJob = {
  sheetId: string;
  userId: string;
  dto: CommitChangesDto;
  clientIp: string;
  expectedSheetRev?: number;
};

/**
 * Per-sheet serial actor (COLLAB-SCALE S2/S4).
 * - memory（默认）：进程内 promise 链
 * - bullmq（COLLAB_SHEET_ACTOR=bullmq）：外置队列；杀副本后 job 可重试；
 *   worker 内 Redis 锁保证同表跨副本单写者
 */
@Injectable()
export class SheetCommitQueue implements OnModuleDestroy {
  private readonly logger = new Logger(SheetCommitQueue.name);
  private readonly queues = new Map<
    string,
    { chain: Promise<unknown>; depth: number }
  >();
  private readonly mode: 'memory' | 'bullmq';
  private readonly queue: Queue | null;
  private readonly worker: Worker | null;
  private readonly queueEvents: QueueEvents | null;
  private readonly queueConnection: IORedis | null;
  private readonly workerConnection: IORedis | null;
  private readonly eventsConnection: IORedis | null;
  private readonly lockRedis: IORedis | null;

  constructor(
    private readonly metrics: MetricsService,
    config: ConfigService,
    @Inject(forwardRef(() => CommitChangesService))
    private readonly commits: CommitChangesService,
  ) {
    this.mode =
      config.get<string>('COLLAB_SHEET_ACTOR', 'memory') === 'bullmq'
        ? 'bullmq'
        : 'memory';
    if (this.mode !== 'bullmq') {
      this.queue = null;
      this.worker = null;
      this.queueEvents = null;
      this.queueConnection = null;
      this.workerConnection = null;
      this.eventsConnection = null;
      this.lockRedis = null;
      return;
    }

    const url = config.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
    this.queueConnection = createRedisConnection(url);
    this.workerConnection = createRedisConnection(url);
    this.eventsConnection = createRedisConnection(url);
    this.lockRedis = createRedisConnection(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeoutMs: 3_000,
    });
    this.queue = new Queue(QUEUE_NAME, { connection: this.queueConnection });
    this.queueEvents = new QueueEvents(QUEUE_NAME, {
      connection: this.eventsConnection,
    });
    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const data = job.data as SheetCommitJob;
        return this.runWithSheetLock(data.sheetId, () =>
          this.commits.executeCommitJob(data),
        );
      },
      { connection: this.workerConnection, concurrency: 8 },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `sheet-commit job ${job?.id ?? 'unknown'} failed: ${error.message}`,
      );
    });
    this.logger.log('SheetCommitQueue using BullMQ actor');
  }

  isBullmq(): boolean {
    return this.mode === 'bullmq' && this.queue !== null;
  }

  depth(sheetId: string): number {
    return this.queues.get(sheetId)?.depth ?? 0;
  }

  async enqueue(job: SheetCommitJob): Promise<CommitChangesResponse> {
    if (this.queue && this.queueEvents) {
      this.metrics.increment('collab_sheet_actor_enqueue_total', {
        mode: 'bullmq',
      });
      const queued = await this.queue.add('commit', job, {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 2,
        backoff: { type: 'fixed', delay: 50 },
      });
      return (await queued.waitUntilFinished(
        this.queueEvents,
        WAIT_MS,
      )) as CommitChangesResponse;
    }
    this.metrics.increment('collab_sheet_actor_enqueue_total', {
      mode: 'memory',
    });
    return this.run(job.sheetId, () => this.commits.executeCommitJob(job));
  }

  /** In-process serial chain (S2 / memory fallback). */
  async run<T>(sheetId: string, task: () => Promise<T>): Promise<T> {
    let q = this.queues.get(sheetId);
    if (!q) {
      q = { chain: Promise.resolve(), depth: 0 };
      this.queues.set(sheetId, q);
    }
    q.depth += 1;
    this.metrics.setGauge('collab_sheet_queue_depth', q.depth, {
      sheet_id: sheetId,
    });

    const run = q.chain.then(task, task);
    q.chain = run.then(
      () => undefined,
      () => undefined,
    );

    try {
      return await run;
    } finally {
      q.depth -= 1;
      this.metrics.setGauge('collab_sheet_queue_depth', q.depth, {
        sheet_id: sheetId,
      });
      if (q.depth === 0 && this.queues.get(sheetId) === q) {
        this.queues.delete(sheetId);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queueEvents?.close();
    await this.queue?.close();
    await this.workerConnection?.quit().catch(() => undefined);
    await this.eventsConnection?.quit().catch(() => undefined);
    await this.queueConnection?.quit().catch(() => undefined);
    await this.lockRedis?.quit().catch(() => undefined);
  }

  private async runWithSheetLock<T>(
    sheetId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    if (!this.lockRedis) return task();
    const token = randomUUID();
    const key = `${LOCK_PREFIX}${sheetId}`;
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      const ok = await this.lockRedis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
      if (ok === 'OK') {
        try {
          return await task();
        } finally {
          const current = await this.lockRedis.get(key);
          if (current === token) await this.lockRedis.del(key);
        }
      }
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error(`sheet actor lock timeout: ${sheetId}`);
  }
}
