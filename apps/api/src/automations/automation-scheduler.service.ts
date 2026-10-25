import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { nextCronDate, type ScheduleTrigger } from 'shared';
import { PrismaService } from '../prisma/prisma.service';
import { QuotasService } from '../quotas/quotas.service';
import { AutomationRunnerService } from './automation-runner.service';
import { RecordTimerService } from './record-timer.service';

/**
 * Polls due schedule automations. Every replica can run this: the conditional
 * `updateMany` on `nextRunAt` acts as an atomic claim, so only one replica gets
 * a given occurrence. Execution itself still uses the same Runner as record
 * triggers and the manual "run" button. Also drives recordTimer（到达时间）.
 */
@Injectable()
export class AutomationSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AutomationSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AutomationRunnerService,
    private readonly quotas: QuotasService,
    private readonly recordTimers: RecordTimerService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.AUTOMATION_SCHEDULER_ENABLED === 'false') {
      this.logger.log('automation scheduler disabled by env');
      return;
    }
    await this.backfillNextRuns();
    this.timer = setInterval(() => {
      void this.runDueSchedules().catch((error: unknown) => {
        this.logger.warn(`automation scheduler failed: ${String(error)}`);
      });
      void this.recordTimers.runDueTimers().catch((error: unknown) => {
        this.logger.warn(`record timer poll failed: ${String(error)}`);
      });
      void this.runner.runDueDelayedRuns().catch((error: unknown) => {
        this.logger.warn(`automation delay resume failed: ${String(error)}`);
      });
    }, 15_000);
    this.timer.unref?.();
    this.logger.log('automation scheduler started (15s poll, delays+cron+timers)');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Public for tests and operational manual draining. */
  async runDueSchedules(limit = 20): Promise<
    Array<{ automationId: string; runId: string; status: string }>
  > {
    if (this.ticking) return [];
    this.ticking = true;
    const results: Array<{
      automationId: string;
      runId: string;
      status: string;
    }> = [];
    try {
      const due = await this.prisma.automation.findMany({
        where: {
          enabled: true,
          nextRunAt: { lte: new Date() },
        },
        include: { base: true },
        orderBy: { nextRunAt: 'asc' },
        take: Math.min(Math.max(limit, 1), 100),
      });

      for (const automation of due) {
        const trigger = automation.trigger as unknown as ScheduleTrigger;
        if (trigger?.type !== 'schedule' || !trigger.cron) continue;
        let next: Date;
        try {
          next = nextCronDate(trigger.cron, {
            from: new Date(),
            timezone: trigger.timezone,
          });
        } catch (error) {
          this.logger.error(
            `invalid cron for automation ${automation.id}: ${String(error)}`,
          );
          await this.prisma.automation.update({
            where: { id: automation.id },
            data: { enabled: false, nextRunAt: null },
          });
          continue;
        }

        const claimed = await this.prisma.automation.updateMany({
          where: {
            id: automation.id,
            enabled: true,
            nextRunAt: automation.nextRunAt,
          },
          data: { nextRunAt: next, lastRunAt: new Date() },
        });
        if (claimed.count === 0) continue;

        try {
          await this.quotas.assertAutomationRun(automation.base.workspaceId);
          const result = await this.runner.runAutomation(automation.id, {});
          results.push({
            automationId: automation.id,
            runId: result.runId,
            status: result.status,
          });
          this.logger.log(
            `scheduled automation ${automation.id} -> ${result.status}`,
          );
        } catch (error) {
          this.logger.warn(
            `scheduled automation ${automation.id} failed: ${String(error)}`,
          );
          await this.prisma.automationRun.create({
            data: {
              automationId: automation.id,
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
              finishedAt: new Date(),
              outputs: {} as Prisma.InputJsonValue,
            },
          });
        }
      }
      return results;
    } finally {
      this.ticking = false;
    }
  }

  /** On startup, schedule triggers created before this feature get a next run. */
  private async backfillNextRuns(): Promise<void> {
    const rows = await this.prisma.automation.findMany({
      where: { enabled: true, nextRunAt: null },
      select: { id: true, trigger: true },
    });
    for (const row of rows) {
      const trigger = row.trigger as unknown as ScheduleTrigger;
      if (trigger?.type !== 'schedule' || !trigger.cron) continue;
      try {
        const next = nextCronDate(trigger.cron, {
          timezone: trigger.timezone,
        });
        await this.prisma.automation.update({
          where: { id: row.id },
          data: { nextRunAt: next },
        });
      } catch {
        // Invalid legacy schedules are ignored until edited in the UI.
      }
    }
  }
}
