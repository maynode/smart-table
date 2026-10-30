import {
  activityLogCutoff,
  cleanupDeleteBefore,
  nextCleanupRunAt,
  shouldRunCleanupNow,
  shanghaiMonthStart,
  wallClockParts,
} from './activity-retention';

describe('activity-retention', () => {
  it('Oct 1 keeps Sep+Oct: cutoff is Sep 1 Shanghai', () => {
    // 2026-10-01 04:00 CST = 2026-09-30 20:00 UTC
    const now = new Date(Date.UTC(2026, 8, 30, 20, 0, 0));
    const parts = wallClockParts(now);
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(10);
    expect(parts.day).toBe(1);

    const cutoff = activityLogCutoff(now, 2);
    expect(cutoff.toISOString()).toBe(shanghaiMonthStart(2026, 9).toISOString());
    // 8 月日志应被删：Aug 15 CST < Sep 1 CST
    const aug = new Date(Date.UTC(2026, 7, 15, 4, 0, 0)); // Aug 15 12:00 CST
    expect(aug.getTime()).toBeLessThan(cutoff.getTime());
    // 9 月日志保留
    const sep = shanghaiMonthStart(2026, 9);
    expect(sep.getTime()).toBe(cutoff.getTime());
  });

  it('runs once on configured day and time', () => {
    // Oct 1 02:00 CST = Sep 30 18:00 UTC
    const now = new Date(Date.UTC(2026, 8, 30, 18, 0, 0));
    expect(
      shouldRunCleanupNow(now, {
        dayOfMonth: 1,
        hour: 2,
        minute: 0,
        lastRunAt: null,
      }),
    ).toBe(true);
    expect(
      shouldRunCleanupNow(now, {
        dayOfMonth: 1,
        hour: 2,
        minute: 0,
        lastRunAt: now,
      }),
    ).toBe(false);
    expect(
      shouldRunCleanupNow(now, {
        dayOfMonth: 1,
        hour: 3,
        minute: 0,
        lastRunAt: null,
      }),
    ).toBe(false);
  });

  it('next run and deleteBefore are readable', () => {
    // 2026-10-15 12:00 CST
    const now = new Date(Date.UTC(2026, 9, 15, 4, 0, 0));
    const next = nextCleanupRunAt(now, {
      dayOfMonth: 1,
      hour: 2,
      minute: 0,
      second: 0,
      lastRunAt: null,
    });
    // 本月 1 号已过 → 下月 11/1 02:00
    expect(wallClockParts(next)).toMatchObject({
      year: 2026,
      month: 11,
      day: 1,
      hour: 2,
      minute: 0,
    });
    const before = cleanupDeleteBefore(next, 2);
    // 11 月跑 → 保留 10+11 月 → 删 9/1 之前
    expect(before.toISOString()).toBe(shanghaiMonthStart(2026, 10).toISOString());
  });
});
