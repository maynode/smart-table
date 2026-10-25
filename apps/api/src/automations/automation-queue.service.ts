import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { createRedisConnection } from '../queue/redis-connection';
import {
  AutomationRunnerService,
  type AutomationRunContext,
} from './automation-runner.service';

const QUEUE_NAME = 'automation-runs';

/**
 * Two entry points: inline (default, used by tests and small installs) and
 * BullMQ (`AUTOMATION_QUEUE=bullmq`) for deployments that need retries and
 * backpressure. The worker calls the same runner so behavior is identical.
 */
@Injectable()
export class AutomationQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(AutomationQueueService.name);
  private readonly queue: Queue | null;
  private readonly worker: Worker | null;
  private readonly queueConnection: IORedis | null;
  private readonly workerConnection: IORedis | null;

  constructor(
    config: ConfigService,
    @Inject(forwardRef(() => AutomationRunnerService))
    private readonly runner: AutomationRunnerService,
  ) {
    const enabled = config.get<string>('AUTOMATION_QUEUE') === 'bullmq';
    if (!enabled) {
      this.queue = null;
      this.worker = null;
      this.queueConnection = null;
      this.workerConnection = null;
      return;
    }

    const url = config.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
    this.queueConnection = createRedisConnection(url);
    this.workerConnection = createRedisConnection(url);
    this.queue = new Queue(QUEUE_NAME, { connection: this.queueConnection });
    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const data = job.data as {
          automationId: string;
          context: AutomationRunContext;
        };
        return this.runner.runAutomation(data.automationId, data.context);
      },
      { connection: this.workerConnection },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `automation job ${job?.id ?? 'unknown'} failed: ${error.message}`,
      );
    });
  }

  isQueueEnabled(): boolean {
    return this.queue !== null;
  }

  async enqueue(
    automationId: string,
    context: AutomationRunContext,
  ): Promise<{ queued: boolean; jobId?: string | number; result?: unknown }> {
    if (!this.queue) {
      return {
        queued: false,
        result: await this.runner.runAutomation(automationId, context),
      };
    }
    const job = await this.queue.add(
      'run',
      { automationId, context },
      { removeOnComplete: 1000, attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    );
    return { queued: true, jobId: job.id };
  }

  /** 延迟续跑（BullMQ delayed job）. */
  async enqueueDelayed(
    automationId: string,
    context: AutomationRunContext,
    delayMs: number,
  ): Promise<{ queued: boolean; jobId?: string | number }> {
    if (!this.queue) {
      return { queued: false };
    }
    const job = await this.queue.add(
      'run',
      { automationId, context },
      {
        delay: Math.max(0, Math.floor(delayMs)),
        removeOnComplete: 1000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );
    return { queued: true, jobId: job.id };
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.workerConnection?.quit();
    await this.queueConnection?.quit();
  }
}
