import { describe, expect, it } from 'vitest';
import {
  AxisLayout,
  UniformAxis,
  buildUniformLayout,
  computeVisibleRange,
} from './layout';

describe('AxisLayout (prefix sums in Float64Array)', () => {
  it('answers offsets and reverse lookups for 100k rows', () => {
    const layout = buildUniformLayout(100_000, 32);

    expect(layout.count).toBe(100_000);
    expect(layout.totalSize).toBe(3_200_000);
    expect(layout.offset(0)).toBe(0);
    expect(layout.offset(10)).toBe(320);
    expect(layout.indexAt(0)).toBe(0);
    expect(layout.indexAt(3_199_999)).toBe(99_999);
    expect(layout.indexAt(319)).toBe(9);
  });

  it('handles variable heights', () => {
    const layout = new AxisLayout([40, 20, 60]);

    expect(layout.totalSize).toBe(120);
    expect(layout.offset(2)).toBe(60);
    expect(layout.indexAt(59)).toBe(1);
    expect(layout.indexAt(60)).toBe(2);
  });
});

describe('UniformAxis (O(1), equivalent layout for 10M rows)', () => {
  it('never allocates per-row storage', () => {
    const axis = new UniformAxis(10_000_000, 32);

    expect(axis.totalSize).toBe(320_000_000);
    expect(axis.offset(9_999_999)).toBe(319_999_968);
    expect(axis.indexAt(319_999_999)).toBe(9_999_999);
  });
});

describe('computeVisibleRange', () => {
  it('only covers viewport + overscan for 100k rows', () => {
    const axis = buildUniformLayout(100_000, 32);
    const range = computeVisibleRange(axis, 0, 600, 4);

    expect(range.start).toBe(0);
    expect(range.end).toBeLessThanOrEqual(32);
    expect(range.end - range.start).toBeLessThan(40);
  });

  it('clamps at the end of the sheet', () => {
    const axis = buildUniformLayout(100_000, 32);
    const range = computeVisibleRange(axis, axis.totalSize - 100, 600, 4);

    expect(range.end).toBe(100_000);
    expect(range.start).toBeGreaterThanOrEqual(100_000 - 40);
  });
});
