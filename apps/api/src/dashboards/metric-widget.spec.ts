import {
  formatMetricDelta,
  matchConditionalColor,
  resolveCompareWindows,
} from './metric-widget';

describe('metric-widget helpers', () => {
  it('resolves mom windows of equal length', () => {
    const now = new Date('2026-10-22T12:00:00.000Z');
    const windows = resolveCompareWindows('mom', 30, now);
    expect(windows).not.toBeNull();
    expect(windows!.currentTo.toISOString()).toBe(now.toISOString());
    expect(
      windows!.currentTo.getTime() - windows!.currentFrom.getTime(),
    ).toBe(30 * 24 * 60 * 60 * 1000);
    expect(
      windows!.previousTo.getTime() - windows!.previousFrom.getTime(),
    ).toBe(30 * 24 * 60 * 60 * 1000);
    expect(windows!.previousTo.getTime()).toBe(windows!.currentFrom.getTime());
  });

  it('resolves yoy windows shifted by 365 days', () => {
    const now = new Date('2026-10-22T12:00:00.000Z');
    const windows = resolveCompareWindows('yoy', 30, now)!;
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    expect(windows.previousFrom.getTime()).toBe(
      windows.currentFrom.getTime() - yearMs,
    );
    expect(windows.previousTo.getTime()).toBe(
      windows.currentTo.getTime() - yearMs,
    );
  });

  it('matches conditional format rules in order', () => {
    const color = matchConditionalColor(120, [
      { op: 'lt', value: 50, color: '#d4380d' },
      { op: 'gte', value: 100, color: '#0f9d58' },
      { op: 'gt', value: 0, color: '#2d8cf0' },
    ]);
    expect(color).toBe('#0f9d58');
  });

  it('formats delta and percent', () => {
    expect(formatMetricDelta(120, 100)).toEqual({
      delta: 20,
      deltaPercent: 20,
    });
    expect(formatMetricDelta(10, 0)).toEqual({
      delta: 10,
      deltaPercent: null,
    });
  });
});
