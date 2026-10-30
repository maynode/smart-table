const ZONE = 'Asia/Shanghai';
/** 上海相对 UTC 的固定偏移（无夏令时） */
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

export type WallClockParts = {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/** 上海墙钟拆分（清理日/cutoff 都按此时区的自然月）。 */
export function wallClockParts(
  now: Date,
  timeZone = ZONE,
): WallClockParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function clampRetention(retentionMonths: number): number {
  return Math.min(Math.max(Math.floor(retentionMonths) || 2, 1), 120);
}

/**
 * 上海自然月某日 00:00:00 的绝对时刻。
 * month 为 1–12。
 */
export function shanghaiMonthStart(year: number, month: number): Date {
  let y = year;
  let m = month;
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  // 该日 00:00 CST = 前一日 16:00 UTC
  return new Date(Date.UTC(y, m - 1, 1, 0, 0, 0) - SHANGHAI_OFFSET_MS);
}

/**
 * 保留窗口 cutoff：删除 createdAt < cutoff 的日志。
 *
 * retentionMonths=2 → 保留「本月 + 上月」；
 * 10 月 1 日清理 → cutoff = 9 月 1 日 00:00（上海）→ 清掉 8 月及更早（上上个月及更早）。
 */
export function activityLogCutoff(
  now: Date,
  retentionMonths = 2,
  timeZone = ZONE,
): Date {
  const months = clampRetention(retentionMonths);
  const parts = wallClockParts(now, timeZone);
  return shanghaiMonthStart(parts.year, parts.month - (months - 1));
}

export function shouldRunCleanupNow(
  now: Date,
  opts: {
    dayOfMonth: number;
    hour: number;
    minute?: number;
    lastRunAt?: Date | null;
    timeZone?: string;
  },
): boolean {
  const tz = opts.timeZone ?? ZONE;
  const parts = wallClockParts(now, tz);
  const day = Math.min(Math.max(opts.dayOfMonth || 1, 1), 28);
  const hour = Math.min(Math.max(opts.hour ?? 2, 0), 23);
  const minute = Math.min(Math.max(opts.minute ?? 0, 0), 59);
  // 60s 轮询：落在目标分钟内即可触发
  if (parts.day !== day || parts.hour !== hour || parts.minute !== minute) {
    return false;
  }
  if (!opts.lastRunAt) return true;
  const last = wallClockParts(opts.lastRunAt, tz);
  if (last.year === parts.year && last.month === parts.month) return false;
  return true;
}

/** 上海墙钟 y-m-d h:m:s → 绝对时刻 */
export function shanghaiDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date {
  let y = year;
  let m = month;
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return new Date(
    Date.UTC(y, m - 1, day, hour, minute, second) - SHANGHAI_OFFSET_MS,
  );
}

/**
 * 下一次定时清理时刻（上海）。
 * 若本月目标日时刻已过，或本月已跑过（lastRunAt 同月），则顺延到下月。
 */
export function nextCleanupRunAt(
  now: Date,
  opts: {
    dayOfMonth: number;
    hour: number;
    minute?: number;
    second?: number;
    lastRunAt?: Date | null;
    timeZone?: string;
  },
): Date {
  const tz = opts.timeZone ?? ZONE;
  const parts = wallClockParts(now, tz);
  const day = Math.min(Math.max(opts.dayOfMonth || 1, 1), 28);
  const hour = Math.min(Math.max(opts.hour ?? 2, 0), 23);
  const minute = Math.min(Math.max(opts.minute ?? 0, 0), 59);
  const second = Math.min(Math.max(opts.second ?? 0, 0), 59);

  const last = opts.lastRunAt ? wallClockParts(opts.lastRunAt, tz) : null;
  const ranThisMonth =
    last != null && last.year === parts.year && last.month === parts.month;

  const candidateThisMonth = shanghaiDateTime(
    parts.year,
    parts.month,
    day,
    hour,
    minute,
    second,
  );
  if (!ranThisMonth && candidateThisMonth.getTime() > now.getTime()) {
    return candidateThisMonth;
  }

  let y = parts.year;
  let m = parts.month + 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return shanghaiDateTime(y, m, day, hour, minute, second);
}

/** 在「下次清理时刻」将删除 createdAt < 该时刻 的日志 */
export function cleanupDeleteBefore(
  nextRunAt: Date,
  retentionMonths = 2,
): Date {
  return activityLogCutoff(nextRunAt, retentionMonths);
}
