/**
 * Row/column geometry for the multi-layer canvas grid.
 *
 * Uniform axes stay O(1) even for 10M rows (no per-row allocation), while
 * variable-size axes use Float64Array prefix sums + binary search so a
 * 100k-row sheet never scans linearly to find the visible window.
 */
export interface Axis {
  readonly count: number;
  readonly totalSize: number;
  offset(index: number): number;
  size(index: number): number;
  /** Index of the item containing `position` (clamped to the axis). */
  indexAt(position: number): number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export class UniformAxis implements Axis {
  readonly totalSize: number;

  constructor(
    readonly count: number,
    private readonly cellSize: number,
  ) {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError('count must be a non-negative integer');
    }
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError('cellSize must be a positive number');
    }
    this.totalSize = count * cellSize;
  }

  offset(index: number): number {
    return clamp(index, 0, this.count) * this.cellSize;
  }

  size(index: number): number {
    return index >= 0 && index < this.count ? this.cellSize : 0;
  }

  indexAt(position: number): number {
    if (this.count === 0) return -1;
    const index = Math.floor(Math.max(0, position) / this.cellSize);
    return Math.min(this.count - 1, index);
  }
}

export class AxisLayout implements Axis {
  private readonly sizes: Float64Array;
  private readonly offsets: Float64Array;

  constructor(sizes: ArrayLike<number>) {
    this.sizes = Float64Array.from(sizes);
    this.offsets = new Float64Array(this.sizes.length + 1);
    for (let i = 0; i < this.sizes.length; i += 1) {
      this.offsets[i + 1] = this.offsets[i] + this.sizes[i];
    }
  }

  get count(): number {
    return this.sizes.length;
  }

  get totalSize(): number {
    return this.offsets[this.sizes.length];
  }

  offset(index: number): number {
    return this.offsets[clamp(Math.trunc(index), 0, this.sizes.length)];
  }

  size(index: number): number {
    return index >= 0 && index < this.sizes.length ? this.sizes[index] : 0;
  }

  indexAt(position: number): number {
    if (this.sizes.length === 0) return -1;
    const target = Math.max(0, Math.min(position, this.totalSize - 1));
    let low = 0;
    let high = this.sizes.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.offsets[mid] <= target) low = mid;
      else high = mid - 1;
    }
    return low;
  }
}

export function buildUniformLayout(count: number, size: number): Axis {
  return new UniformAxis(count, size);
}

export interface VisibleRange {
  start: number;
  /** Exclusive. */
  end: number;
}

/**
 * Visible window + overscan. Rendering is bounded by viewport, never by row
 * count: a 100k-row sheet still draws only the rows on screen.
 */
export function computeVisibleRange(
  axis: Axis,
  scroll: number,
  viewport: number,
  overscan = 2,
): VisibleRange {
  if (axis.count === 0) return { start: 0, end: 0 };

  const maxScroll = Math.max(0, axis.totalSize - 1);
  const safeScroll = Math.min(Math.max(0, scroll), maxScroll);
  const startIndex = axis.indexAt(safeScroll);
  const endIndex = axis.indexAt(safeScroll + Math.max(0, viewport - 1));

  return {
    start: Math.max(0, startIndex - overscan),
    end: Math.min(axis.count, endIndex + 1 + overscan),
  };
}
