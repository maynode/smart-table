import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isInstallAdmin } from '../auth/install-admin';
import { PrismaService } from '../prisma/prisma.service';
import {
  activityLogCutoff,
  cleanupDeleteBefore,
  nextCleanupRunAt,
  shouldRunCleanupNow,
} from './activity-retention';

export const ACTIVITY_CLEANUP_SETTING_KEY = 'activity_log.cleanup';

export type ActivityCleanupSettings = {
  enabled: boolean;
  /** 每月几号执行（1–28） */
  dayOfMonth: number;
  /** 开始时间：时（0–23），上海时区 */
  hour: number;
  /** 开始时间：分（0–59） */
  minute: number;
  /** 开始时间：秒（0–59，展示用；调度按分钟对齐） */
  second: number;
  /** 保留自然月数（含当月）；2 = 本月+上月 */
  retentionMonths: number;
  lastRunAt: string | null;
  lastDeleted: number;
  lastCutoff: string | null;
};

const DEFAULTS: ActivityCleanupSettings = {
  enabled: true,
  dayOfMonth: 1,
  hour: 2,
  minute: 0,
  second: 0,
  retentionMonths: 2,
  lastRunAt: null,
  lastDeleted: 0,
  lastCutoff: null,
};

@Injectable()
export class ActivityCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ActivityCleanupService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env.ACTIVITY_LOG_CLEANUP_SCHEDULER === 'false') {
      this.logger.log('activity log cleanup scheduler disabled');
      return;
    }
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        this.logger.warn(`activity cleanup tick failed: ${String(error)}`);
      });
    }, 60_000);
    this.timer.unref?.();
    this.logger.log('activity log cleanup scheduler started (60s poll)');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async getSettings(): Promise<ActivityCleanupSettings> {
    const env = envOverrides();
    const row = await this.prisma.appSetting.findUnique({
      where: { key: ACTIVITY_CLEANUP_SETTING_KEY },
    });
    return mergeSettings(row?.value, env);
  }

  async getSettingsForAdmin(
    adminUserId: string,
    override?: Partial<{
      dayOfMonth: number;
      hour: number;
      minute: number;
      second: number;
      time: string;
      retentionMonths: number;
    }>,
  ): Promise<{
    settings: ActivityCleanupSettings;
    /** 下一次定时清理时间 */
    nextRunAt: string;
    /** 届时将删除该时刻之前的日志 */
    deleteBefore: string;
  }> {
    await this.assertAdmin(adminUserId);
    const settings = applyPreviewOverride(await this.getSettings(), override);
    const nextRun = nextCleanupRunAt(new Date(), {
      dayOfMonth: settings.dayOfMonth,
      hour: settings.hour,
      minute: settings.minute,
      second: settings.second,
      lastRunAt: settings.lastRunAt ? new Date(settings.lastRunAt) : null,
    });
    const deleteBefore = cleanupDeleteBefore(
      nextRun,
      settings.retentionMonths,
    );
    return {
      settings,
      nextRunAt: nextRun.toISOString(),
      deleteBefore: deleteBefore.toISOString(),
    };
  }

  async updateSettingsForAdmin(
    adminUserId: string,
    patch: Partial<{
      enabled: boolean;
      dayOfMonth: number;
      hour: number;
      minute: number;
      second: number;
      /** HH:mm:ss 或 HH:mm */
      time?: string;
      retentionMonths: number;
    }>,
  ): Promise<ActivityCleanupSettings> {
    await this.assertAdmin(adminUserId);
    const current = await this.getSettings();
    const fromTime = patch.time ? parseTime(patch.time) : null;
    const next: ActivityCleanupSettings = {
      ...current,
      ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
      ...(patch.dayOfMonth != null
        ? {
            dayOfMonth: Math.min(Math.max(Number(patch.dayOfMonth) || 1, 1), 28),
          }
        : {}),
      ...(fromTime
        ? fromTime
        : {
            ...(patch.hour != null
              ? { hour: clamp(Number(patch.hour) || 0, 0, 23) }
              : {}),
            ...(patch.minute != null
              ? { minute: clamp(Number(patch.minute) || 0, 0, 59) }
              : {}),
            ...(patch.second != null
              ? { second: clamp(Number(patch.second) || 0, 0, 59) }
              : {}),
          }),
      ...(patch.retentionMonths != null
        ? {
            retentionMonths: Math.min(
              Math.max(Number(patch.retentionMonths) || 2, 1),
              120,
            ),
          }
        : {}),
    };
    await this.prisma.appSetting.upsert({
      where: { key: ACTIVITY_CLEANUP_SETTING_KEY },
      create: {
        key: ACTIVITY_CLEANUP_SETTING_KEY,
        value: next as unknown as Prisma.InputJsonValue,
      },
      update: { value: next as unknown as Prisma.InputJsonValue },
    });
    return next;
  }

  async runNowForAdmin(adminUserId: string): Promise<{
    deleted: number;
    cutoff: string;
  }> {
    await this.assertAdmin(adminUserId);
    const settings = await this.getSettings();
    return this.executeCleanup(settings, { force: true });
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const settings = await this.getSettings();
      if (!settings.enabled) return;
      const now = new Date();
      if (
        !shouldRunCleanupNow(now, {
          dayOfMonth: settings.dayOfMonth,
          hour: settings.hour,
          minute: settings.minute,
          lastRunAt: settings.lastRunAt
            ? new Date(settings.lastRunAt)
            : null,
        })
      ) {
        return;
      }
      await this.executeCleanup(settings, { force: false });
    } finally {
      this.ticking = false;
    }
  }

  private async executeCleanup(
    settings: ActivityCleanupSettings,
    opts: { force: boolean },
  ): Promise<{ deleted: number; cutoff: string }> {
    const now = new Date();
    const cutoff = activityLogCutoff(now, settings.retentionMonths);
    const result = await this.prisma.activityLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    const next: ActivityCleanupSettings = {
      ...settings,
      lastRunAt: now.toISOString(),
      lastDeleted: result.count,
      lastCutoff: cutoff.toISOString(),
    };
    await this.prisma.appSetting.upsert({
      where: { key: ACTIVITY_CLEANUP_SETTING_KEY },
      create: {
        key: ACTIVITY_CLEANUP_SETTING_KEY,
        value: next as unknown as Prisma.InputJsonValue,
      },
      update: { value: next as unknown as Prisma.InputJsonValue },
    });
    this.logger.log(
      `activity cleanup${opts.force ? ' (manual)' : ''}: deleted=${result.count} cutoff=${cutoff.toISOString()}`,
    );
    return { deleted: result.count, cutoff: cutoff.toISOString() };
  }

  private async assertAdmin(userId: string): Promise<void> {
    if (!(await isInstallAdmin(this.prisma, userId))) {
      throw new ForbiddenException('仅系统管理员可管理操作日志清理');
    }
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function parseTime(
  raw: string,
): { hour: number; minute: number; second: number } | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  return {
    hour: clamp(Number(m[1]), 0, 23),
    minute: clamp(Number(m[2]), 0, 59),
    second: clamp(Number(m[3] ?? 0), 0, 59),
  };
}

function applyPreviewOverride(
  settings: ActivityCleanupSettings,
  override?: Partial<{
    dayOfMonth: number;
    hour: number;
    minute: number;
    second: number;
    time: string;
    retentionMonths: number;
  }>,
): ActivityCleanupSettings {
  if (!override) return settings;
  const fromTime = override.time ? parseTime(override.time) : null;
  return {
    ...settings,
    ...(override.dayOfMonth != null
      ? {
          dayOfMonth: clamp(Number(override.dayOfMonth) || 1, 1, 28),
        }
      : {}),
    ...(fromTime
      ? fromTime
      : {
          ...(override.hour != null
            ? { hour: clamp(Number(override.hour) || 0, 0, 23) }
            : {}),
          ...(override.minute != null
            ? { minute: clamp(Number(override.minute) || 0, 0, 59) }
            : {}),
          ...(override.second != null
            ? { second: clamp(Number(override.second) || 0, 0, 59) }
            : {}),
        }),
    ...(override.retentionMonths != null
      ? {
          retentionMonths: Math.min(
            Math.max(Number(override.retentionMonths) || 2, 1),
            120,
          ),
        }
      : {}),
  };
}

function envOverrides(): Partial<ActivityCleanupSettings> {
  const out: Partial<ActivityCleanupSettings> = {};
  if (process.env.ACTIVITY_LOG_CLEANUP_ENABLED === 'false') {
    out.enabled = false;
  }
  if (process.env.ACTIVITY_LOG_CLEANUP_ENABLED === 'true') {
    out.enabled = true;
  }
  const day = Number(process.env.ACTIVITY_LOG_CLEANUP_DAY);
  if (Number.isFinite(day) && day >= 1 && day <= 28) out.dayOfMonth = day;
  const time = process.env.ACTIVITY_LOG_CLEANUP_TIME;
  if (time) {
    const parsed = parseTime(time);
    if (parsed) Object.assign(out, parsed);
  } else {
    const hour = Number(process.env.ACTIVITY_LOG_CLEANUP_HOUR);
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) out.hour = hour;
  }
  const months = Number(process.env.ACTIVITY_LOG_RETENTION_MONTHS);
  if (Number.isFinite(months) && months >= 1) out.retentionMonths = months;
  return out;
}

function mergeSettings(
  raw: unknown,
  env: Partial<ActivityCleanupSettings>,
): ActivityCleanupSettings {
  const base = { ...DEFAULTS };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (typeof o.enabled === 'boolean') base.enabled = o.enabled;
    if (typeof o.dayOfMonth === 'number') {
      base.dayOfMonth = clamp(o.dayOfMonth, 1, 28);
    }
    if (typeof o.hour === 'number') base.hour = clamp(o.hour, 0, 23);
    if (typeof o.minute === 'number') base.minute = clamp(o.minute, 0, 59);
    if (typeof o.second === 'number') base.second = clamp(o.second, 0, 59);
    if (typeof o.retentionMonths === 'number') {
      base.retentionMonths = Math.min(Math.max(o.retentionMonths, 1), 120);
    }
    if (typeof o.lastRunAt === 'string' || o.lastRunAt === null) {
      base.lastRunAt = o.lastRunAt as string | null;
    }
    if (typeof o.lastDeleted === 'number') base.lastDeleted = o.lastDeleted;
    if (typeof o.lastCutoff === 'string' || o.lastCutoff === null) {
      base.lastCutoff = o.lastCutoff as string | null;
    }
  }
  return {
    ...base,
    ...env,
    lastRunAt: base.lastRunAt,
    lastDeleted: base.lastDeleted,
    lastCutoff: base.lastCutoff,
  };
}
