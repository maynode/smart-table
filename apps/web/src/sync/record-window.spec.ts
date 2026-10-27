import { describe, expect, it } from 'vitest';
import {
  WINDOW_SIZE,
  alignBlock,
  clampWindowOffset,
  detectScrollDirection,
  pageAlreadyCached,
  planWindowFetches,
} from './record-window';

describe('record-window', () => {
  it('aligns offsets to block boundaries', () => {
    expect(alignBlock(0)).toBe(0);
    expect(alignBlock(1)).toBe(0);
    expect(alignBlock(1999)).toBe(0);
    expect(alignBlock(2000)).toBe(2000);
    expect(alignBlock(4500)).toBe(4000);
  });

  it('clamps preferred offset within total', () => {
    expect(clampWindowOffset(10_000, -100)).toBe(0);
    expect(clampWindowOffset(10_000, 5000)).toBe(5000);
    expect(clampWindowOffset(500, 0)).toBe(0);
    expect(clampWindowOffset(5000, 9000)).toBe(3000);
  });

  it('detects scroll direction from mid movement', () => {
    expect(detectScrollDirection(100, null)).toBe(0);
    expect(detectScrollDirection(200, 100)).toBe(1);
    expect(detectScrollDirection(50, 100)).toBe(-1);
    expect(detectScrollDirection(100, 100)).toBe(0);
  });

  it('plans jump fetches for the block under mid without settle wait', () => {
    const plan = planWindowFetches({
      viewStart: 500_000,
      viewEnd: 500_040,
      total: 10_000_000,
      haveStart: 0,
      haveEnd: 2000,
      direction: 1,
    });
    expect(plan[0]).toBe(alignBlock(500_000 - WINDOW_SIZE / 2));
    expect(plan.length).toBeGreaterThanOrEqual(2);
    expect(plan).toContain(plan[0]! + WINDOW_SIZE);
  });

  it('prefetches two blocks ahead when scrolling down near edge', () => {
    const plan = planWindowFetches({
      viewStart: 1600,
      viewEnd: 1640,
      total: 100_000,
      haveStart: 0,
      haveEnd: 2000,
      direction: 1,
    });
    expect(plan).toContain(2000);
    expect(plan).toContain(4000);
    expect(plan).toContain(6000);
  });

  it('prefetches behind when scrolling up near start edge', () => {
    const plan = planWindowFetches({
      viewStart: 2100,
      viewEnd: 2140,
      total: 100_000,
      haveStart: 2000,
      haveEnd: 4000,
      direction: -1,
    });
    expect(plan).toContain(0);
    expect(plan.some((o) => o < 2000)).toBe(true);
  });

  it('pageAlreadyCached probes warm pages', () => {
    const warm = new Set([0, 1, 2, 3, 4, 5]);
    for (let i = 0; i < 48; i += 1) warm.add(1000 + i);
    expect(pageAlreadyCached((r) => warm.has(r), 1000)).toBe(true);
    expect(pageAlreadyCached((r) => warm.has(r), 5000)).toBe(false);
  });
});
