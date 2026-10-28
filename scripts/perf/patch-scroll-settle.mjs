/**
 * Fast-scroll UX: settle debounce + cursor prefetch + keep cache.
 * ASCII-safe edits on BaseShellView.vue (CRLF aware).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'apps/web/src/views/BaseShellView.vue';
let s = readFileSync(path, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';

// Bump cache / edge constants
s = s.replace('const WINDOW_SIZE = 800;', 'const WINDOW_SIZE = 1000;');
s = s.replace('const PREFETCH_EDGE = 280;', 'const PREFETCH_EDGE = 400;');
s = s.replace('const MAX_INDEX_CACHE = 4000;', 'const MAX_INDEX_CACHE = 8000;');

if (!s.includes('SCROLL_SETTLE_MS')) {
  s = s.replace(
    'let lastWindowStats: { rows: { start: number; end: number } } | null = null;',
    [
      'let lastWindowStats: { rows: { start: number; end: number } } | null = null;',
      'const SCROLL_SETTLE_MS = 90;',
      'let scrollSettleTimer: ReturnType<typeof setTimeout> | null = null;',
    ].join(nl),
  );
}

const oldFetch = `function fetchRecordWindow(sheetId: string, offset: number, anchor: number): Promise<void> {
  const existing = windowFetchesInFlight.get(offset);
  if (existing) return existing;
  const gen = recordsLoadGen.value;
  const task = (async () => {
    try {
      const page = await endpoints.listRecords(sheetId, null, WINDOW_SIZE, offset);
      if (gen !== recordsLoadGen.value || activeSheet.value?.id !== sheetId) return;
      putRecordWindow(page.offset ?? offset, page.records, anchor);
      const stats = lastWindowStats;
      if (stats) materializeRecordWindow(stats.rows.start, stats.rows.end);
      else materializeRecordWindow(anchor, anchor + 1);
    } catch {
      /* keep cache */
    } finally {
      windowFetchesInFlight.delete(offset);
    }
  })();
  windowFetchesInFlight.set(offset, task);
  return task;
}`;

const newFetch = `function pageAlreadyCached(offset: number): boolean {
  let hit = 0;
  const probe = Math.min(40, WINDOW_SIZE);
  for (let i = 0; i < probe; i += 1) {
    if (recordIndexCache.has(offset + i)) hit += 1;
  }
  return hit >= probe - 2;
}

function fetchRecordWindow(sheetId: string, offset: number, anchor: number): Promise<void> {
  if (pageAlreadyCached(offset)) return Promise.resolve();
  const existing = windowFetchesInFlight.get(offset);
  if (existing) return existing;
  const gen = recordsLoadGen.value;
  const task = (async () => {
    try {
      // Prefer keyset (cursor) when we already hold the row just before offset —
      // deep OFFSET is slow; sequential scroll must stay O(limit).
      const prev = offset > 0 ? recordIndexCache.get(offset - 1) : undefined;
      const page = prev
        ? await endpoints.listRecords(sheetId, prev.id, WINDOW_SIZE)
        : await endpoints.listRecords(sheetId, null, WINDOW_SIZE, offset);
      if (gen !== recordsLoadGen.value || activeSheet.value?.id !== sheetId) return;
      const appliedOffset = prev ? offset : (page.offset ?? offset);
      putRecordWindow(appliedOffset, page.records, anchor);
      const stats = lastWindowStats;
      if (stats) materializeRecordWindow(stats.rows.start, stats.rows.end);
      else materializeRecordWindow(anchor, anchor + 1);
    } catch {
      /* keep cache */
    } finally {
      windowFetchesInFlight.delete(offset);
    }
  })();
  windowFetchesInFlight.set(offset, task);
  return task;
}`;

const oldFetchCrlf = oldFetch.replace(/\n/g, '\r\n');
const newFetchJoined = newFetch.replace(/\n/g, nl);
if (s.includes('pageAlreadyCached')) {
  console.log('fetch already patched');
} else if (s.includes(oldFetchCrlf) || s.includes(oldFetch)) {
  s = s.includes(oldFetchCrlf)
    ? s.replace(oldFetchCrlf, newFetchJoined)
    : s.replace(oldFetch, newFetchJoined);
} else {
  console.error('fetchRecordWindow not found');
  process.exit(1);
}

const oldEnsure = `async function ensureRecordWindow(stats: { rows: { start: number; end: number } }): Promise<void> {
  if (totalRecordCount.value == null || !activeSheet.value) return;
  const total = totalRecordCount.value;
  const sheetId = activeSheet.value.id;
  lastWindowStats = stats;
  materializeRecordWindow(stats.rows.start, stats.rows.end);

  const haveStart = recordOffset.value;
  const haveEnd = recordOffset.value + records.value.length;
  const viewStart = stats.rows.start;
  const viewEnd = stats.rows.end;
  const covered =
    haveEnd > haveStart && viewStart >= haveStart && viewEnd <= haveEnd;
  const nearLow = !covered || viewStart < haveStart + PREFETCH_EDGE;
  const nearHigh = !covered || viewEnd > haveEnd - PREFETCH_EDGE;

  const mid = Math.floor((viewStart + viewEnd) / 2);
  const wanted = new Set<number>();
  if (!covered) {
    wanted.add(clampWindowOffset(total, mid - Math.floor(WINDOW_SIZE / 2)));
  }
  if (nearLow) {
    wanted.add(clampWindowOffset(total, haveStart - WINDOW_SIZE + WINDOW_PAD));
    wanted.add(clampWindowOffset(total, viewStart - Math.floor(WINDOW_SIZE / 2)));
  }
  if (nearHigh) {
    wanted.add(clampWindowOffset(total, haveEnd - WINDOW_PAD));
    wanted.add(clampWindowOffset(total, viewEnd - Math.floor(WINDOW_SIZE / 4)));
  }

  const needFetch: number[] = [];
  for (const offset of wanted) {
    let hit = 0;
    for (let i = 0; i < Math.min(32, WINDOW_SIZE); i += 1) {
      if (recordIndexCache.has(offset + i)) hit += 1;
    }
    if (hit >= 30) continue;
    needFetch.push(offset);
  }
  if (needFetch.length === 0) return;

  const primary = clampWindowOffset(total, mid - Math.floor(WINDOW_SIZE / 2));
  if (!covered) {
    await fetchRecordWindow(sheetId, primary, mid);
    materializeRecordWindow(viewStart, viewEnd);
  }
  for (const offset of needFetch) {
    if (!covered && offset === primary) continue;
    void fetchRecordWindow(sheetId, offset, mid);
  }
}`;

const newEnsure = `function scheduleSettledWindowFetch(
  sheetId: string,
  total: number,
  viewStart: number,
  viewEnd: number,
): void {
  if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
  scrollSettleTimer = setTimeout(() => {
    scrollSettleTimer = null;
    if (totalRecordCount.value == null || activeSheet.value?.id !== sheetId) return;
    const mid = Math.floor((viewStart + viewEnd) / 2);
    const primary = clampWindowOffset(total, mid - Math.floor(WINDOW_SIZE / 2));
    void fetchRecordWindow(sheetId, primary, mid).then(() => {
      const stats = lastWindowStats;
      if (stats) materializeRecordWindow(stats.rows.start, stats.rows.end);
    });
    // Neighbor pages after settle (cursor-fast when contiguous).
    void fetchRecordWindow(
      sheetId,
      clampWindowOffset(total, primary + WINDOW_SIZE - WINDOW_PAD),
      mid,
    );
    void fetchRecordWindow(
      sheetId,
      clampWindowOffset(total, primary - WINDOW_SIZE + WINDOW_PAD),
      mid,
    );
  }, SCROLL_SETTLE_MS);
}

async function ensureRecordWindow(stats: { rows: { start: number; end: number } }): Promise<void> {
  if (totalRecordCount.value == null || !activeSheet.value) return;
  const total = totalRecordCount.value;
  const sheetId = activeSheet.value.id;
  lastWindowStats = stats;
  materializeRecordWindow(stats.rows.start, stats.rows.end);

  const haveStart = recordOffset.value;
  const haveEnd = recordOffset.value + records.value.length;
  const viewStart = stats.rows.start;
  const viewEnd = stats.rows.end;
  const covered =
    haveEnd > haveStart && viewStart >= haveStart && viewEnd <= haveEnd;

  // While flinging: only warm sequential edges via cursor (cheap). Deep OFFSET
  // waits until scroll settles — same idea as skeleton-then-fill grids.
  if (covered) {
    if (viewEnd > haveEnd - PREFETCH_EDGE) {
      void fetchRecordWindow(sheetId, clampWindowOffset(total, haveEnd - WINDOW_PAD), viewEnd);
    }
    if (viewStart < haveStart + PREFETCH_EDGE) {
      void fetchRecordWindow(
        sheetId,
        clampWindowOffset(total, haveStart - WINDOW_SIZE + WINDOW_PAD),
        viewStart,
      );
    }
    return;
  }

  scheduleSettledWindowFetch(sheetId, total, viewStart, viewEnd);
}`;

const oldEnsureCrlf = oldEnsure.replace(/\n/g, '\r\n');
const newEnsureJoined = newEnsure.replace(/\n/g, nl);
if (s.includes('scheduleSettledWindowFetch')) {
  console.log('ensure already patched');
} else if (s.includes(oldEnsureCrlf) || s.includes(oldEnsure)) {
  s = s.includes(oldEnsureCrlf)
    ? s.replace(oldEnsureCrlf, newEnsureJoined)
    : s.replace(oldEnsure, newEnsureJoined);
} else {
  console.error('ensureRecordWindow not found');
  process.exit(1);
}

writeFileSync(path, Buffer.from(s, 'utf8'));
console.log({
  settle: s.includes('SCROLL_SETTLE_MS'),
  cursorPrefetch: s.includes('Prefer keyset'),
  chinese: /静默续拉/.test(s),
});
