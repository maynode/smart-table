/**
 * Large-sheet window planning (WeCom-aligned row windows).
 * Blocks mirror opendoc startrow/endrow + chunk pages: fetch aligned pages,
 * prefetch ahead of scroll direction, jump without waiting for settle.
 */

export const WINDOW_SIZE = 2000;
/** Start edge prefetch before viewport hits the loaded span. */
export const PREFETCH_EDGE = 600;
/** Keep ~6 blocks in memory (WeCom multi-chunk feel without local DB). */
export const MAX_INDEX_CACHE = 12_000;
export const LARGE_SHEET_THRESHOLD = 2000;

/** Align offset down to a WINDOW_SIZE block boundary. */
export function alignBlock(offset: number, blockSize = WINDOW_SIZE): number {
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  return Math.floor(offset / blockSize) * blockSize;
}

export function clampWindowOffset(
  total: number,
  preferred: number,
  blockSize = WINDOW_SIZE,
): number {
  const maxOffset = Math.max(0, total - blockSize);
  return Math.max(0, Math.min(maxOffset, preferred));
}

export type ScrollDirection = -1 | 0 | 1;

export function detectScrollDirection(
  mid: number,
  prevMid: number | null,
): ScrollDirection {
  if (prevMid == null) return 0;
  if (mid > prevMid) return 1;
  if (mid < prevMid) return -1;
  return 0;
}

/**
 * Ordered block offsets to fetch for a viewport.
 * Jump: primary covering mid + neighbors.
 * Continuous: 2 blocks ahead of scroll, 1 behind.
 */
export function planWindowFetches(input: {
  viewStart: number;
  viewEnd: number;
  total: number;
  haveStart: number;
  haveEnd: number;
  direction: ScrollDirection;
  blockSize?: number;
  prefetchEdge?: number;
}): number[] {
  const block = input.blockSize ?? WINDOW_SIZE;
  const edge = input.prefetchEdge ?? PREFETCH_EDGE;
  const { viewStart, viewEnd, total, haveStart, haveEnd, direction } = input;
  const mid = Math.floor((viewStart + viewEnd) / 2);
  const covered =
    haveEnd > haveStart && viewStart >= haveStart && viewEnd <= haveEnd;
  const gapAhead = viewStart > haveEnd + block;
  const gapBehind = viewEnd < haveStart - block;

  const out: number[] = [];
  const pushAligned = (raw: number) => {
    const offset = clampWindowOffset(total, alignBlock(raw, block), block);
    if (!out.includes(offset)) out.push(offset);
  };
  /** Contiguous extension keeps exact haveEnd (keyset); do not snap down. */
  const pushExact = (raw: number) => {
    if (raw < 0 || raw >= total) return;
    const offset = Math.min(raw, Math.max(0, total - 1));
    if (!out.includes(offset)) out.push(offset);
  };

  // Big scrollbar jump → load block under mid immediately (+ neighbors).
  if (
    gapAhead ||
    gapBehind ||
    (!covered && (viewStart >= haveEnd || viewEnd <= haveStart))
  ) {
    const primary = clampWindowOffset(
      total,
      alignBlock(mid - Math.floor(block / 2), block),
      block,
    );
    pushAligned(primary);
    pushAligned(primary + block);
    pushAligned(primary - block);
    return out;
  }

  const dir: ScrollDirection = direction === 0 ? 1 : direction;

  if (viewEnd + edge >= haveEnd || !covered) {
    const ahead0 =
      haveEnd > haveStart ? haveEnd : alignBlock(viewEnd, block);
    pushExact(ahead0);
    if (dir >= 0) {
      pushAligned(ahead0 + block);
      pushAligned(ahead0 + block * 2);
    } else {
      pushAligned(ahead0 + block);
    }
  }

  if (viewStart - edge <= haveStart || !covered) {
    const backBase =
      haveEnd > haveStart
        ? haveStart - block
        : alignBlock(viewStart, block) - block;
    pushExact(backBase);
    if (dir <= 0) {
      pushAligned(backBase - block);
      pushAligned(backBase - block * 2);
    }
  }

  return out;
}

/** Probe whether a page starting at offset is already warm in the index map. */
export function pageAlreadyCached(
  hasRow: (row: number) => boolean,
  offset: number,
  blockSize = WINDOW_SIZE,
): boolean {
  const probe = Math.min(48, blockSize);
  let hit = 0;
  for (let i = 0; i < probe; i += 1) {
    if (hasRow(offset + i)) hit += 1;
  }
  return hit >= probe - 2;
}
