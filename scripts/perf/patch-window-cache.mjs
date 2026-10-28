/**
 * Replace large-sheet window loader with index cache + prefetch
 * so scrolling does not flash blank cells.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'apps/web/src/views/BaseShellView.vue';
let s = readFileSync(path, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';

const oldConsts = [
  'const WINDOW_SIZE = 500;',
  'const WINDOW_PAD = 80;',
  'const LARGE_SHEET_THRESHOLD = 2000;',
  '/** 静默续拉世代号：切表时递增，丢弃过期批次 */',
  'const recordsLoadGen = ref(0);',
  'let windowFetchInFlight: Promise<void> | null = null;',
  'let windowFetchTarget = -1;',
].join(nl);

const newConsts = [
  'const WINDOW_SIZE = 800;',
  '/** Start fetch before the viewport reaches the buffer edge. */',
  'const WINDOW_PAD = 120;',
  'const PREFETCH_EDGE = 280;',
  'const MAX_INDEX_CACHE = 4000;',
  'const LARGE_SHEET_THRESHOLD = 2000;',
  '/** 静默续拉世代号：切表时递增，丢弃过期批次 */',
  'const recordsLoadGen = ref(0);',
  '/** Absolute row -> record (large-sheet sliding cache). */',
  'const recordIndexCache = new Map<number, RecordDto>();',
  'const windowFetchesInFlight = new Map<number, Promise<void>>();',
  'let lastWindowStats: { rows: { start: number; end: number } } | null = null;',
].join(nl);

if (!s.includes(oldConsts)) {
  if (s.includes('recordIndexCache')) {
    console.log('already patched consts');
  } else {
    console.error('const block not found');
    process.exit(1);
  }
} else {
  s = s.replace(oldConsts, newConsts);
}

const oldEnsure = `async function ensureRecordWindow(stats: { rows: { start: number; end: number } }): Promise<void> {
  if (totalRecordCount.value == null || !activeSheet.value) return;
  const total = totalRecordCount.value;
  const sheetId = activeSheet.value.id;
  const needStart = Math.max(0, stats.rows.start - WINDOW_PAD);
  const needEnd = Math.min(total, stats.rows.end + WINDOW_PAD);
  const haveStart = recordOffset.value;
  const haveEnd = recordOffset.value + records.value.length;
  if (needStart >= haveStart && needEnd <= haveEnd) return;

  const mid = Math.floor((stats.rows.start + stats.rows.end) / 2);
  const maxOffset = Math.max(0, total - WINDOW_SIZE);
  const offset = Math.max(0, Math.min(maxOffset, mid - Math.floor(WINDOW_SIZE / 2)));
  if (offset === windowFetchTarget && windowFetchInFlight) {
    await windowFetchInFlight;
    return;
  }
  windowFetchTarget = offset;
  const gen = recordsLoadGen.value;
  windowFetchInFlight = (async () => {
    try {
      const page = await endpoints.listRecords(sheetId, null, WINDOW_SIZE, offset);
      if (gen !== recordsLoadGen.value || activeSheet.value?.id !== sheetId) return;
      records.value = page.records;
      recordOffset.value = page.offset ?? offset;
    } catch {
      /* keep previous window */
    } finally {
      if (windowFetchTarget === offset) windowFetchInFlight = null;
    }
  })();
  await windowFetchInFlight;
}`;

const oldEnsureCrlf = oldEnsure.replace(/\n/g, '\r\n');

const newEnsure = `function clearRecordWindowCache(): void {
  recordIndexCache.clear();
  windowFetchesInFlight.clear();
  lastWindowStats = null;
}

function trimRecordIndexCache(anchor: number): void {
  if (recordIndexCache.size <= MAX_INDEX_CACHE) return;
  const ranked = [...recordIndexCache.keys()].sort(
    (a, b) => Math.abs(a - anchor) - Math.abs(b - anchor),
  );
  const keep = new Set(ranked.slice(0, MAX_INDEX_CACHE));
  for (const key of recordIndexCache.keys()) {
    if (!keep.has(key)) recordIndexCache.delete(key);
  }
}

function putRecordWindow(offset: number, list: RecordDto[], anchor: number): void {
  for (let i = 0; i < list.length; i += 1) {
    recordIndexCache.set(offset + i, list[i]!);
  }
  trimRecordIndexCache(anchor);
}

/** Build contiguous records[] covering the viewport from cache (never clears ahead of fetch). */
function materializeRecordWindow(vStart: number, vEnd: number): void {
  if (recordIndexCache.size === 0) return;
  let start = Math.max(0, vStart);
  while (start > 0 && recordIndexCache.has(start - 1)) start -= 1;
  while (start < vEnd && !recordIndexCache.has(start)) start += 1;
  if (!recordIndexCache.has(start)) {
    // Jump gap: keep previous buffer so visible cells do not flash empty.
    return;
  }
  const out: RecordDto[] = [];
  let i = start;
  while (recordIndexCache.has(i) && out.length < MAX_INDEX_CACHE) {
    out.push(recordIndexCache.get(i)!);
    i += 1;
  }
  records.value = out;
  recordOffset.value = start;
}

function clampWindowOffset(total: number, preferred: number): number {
  const maxOffset = Math.max(0, total - WINDOW_SIZE);
  return Math.max(0, Math.min(maxOffset, preferred));
}

function fetchRecordWindow(sheetId: string, offset: number, anchor: number): Promise<void> {
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

const newEnsureJoined = newEnsure.replace(/\n/g, nl);

if (s.includes('recordIndexCache') && s.includes('materializeRecordWindow')) {
  console.log('ensure already patched');
} else if (s.includes(oldEnsureCrlf) || s.includes(oldEnsure)) {
  s = s.includes(oldEnsureCrlf)
    ? s.replace(oldEnsureCrlf, newEnsureJoined)
    : s.replace(oldEnsure, newEnsureJoined);
} else {
  console.error('ensureRecordWindow block not found');
  process.exit(1);
}

// Seed cache on selectSheet large-sheet path
const oldSelectTail = [
  '    records.value = page.records;',
  '    recordOffset.value = 0;',
  '    const total = page.total ?? page.records.length;',
  '    if (total > LARGE_SHEET_THRESHOLD) {',
  '      totalRecordCount.value = total;',
  '      nextCursor.value = null;',
  '    } else {',
  '      totalRecordCount.value = null;',
  '      nextCursor.value = page.nextCursor;',
  '      void drainRecordsInBackground(sheetId);',
  '    }',
].join(nl);

const newSelectTail = [
  '    clearRecordWindowCache();',
  '    records.value = page.records;',
  '    recordOffset.value = 0;',
  '    const total = page.total ?? page.records.length;',
  '    if (total > LARGE_SHEET_THRESHOLD) {',
  '      totalRecordCount.value = total;',
  '      nextCursor.value = null;',
  '      putRecordWindow(0, page.records, 0);',
  '    } else {',
  '      totalRecordCount.value = null;',
  '      nextCursor.value = page.nextCursor;',
  '      void drainRecordsInBackground(sheetId);',
  '    }',
].join(nl);

if (s.includes(oldSelectTail)) {
  s = s.replace(oldSelectTail, newSelectTail);
} else if (!s.includes('putRecordWindow(0, page.records, 0)')) {
  console.warn('selectSheet seed not found — check manually');
}

// Clear cache when emptying sheet (form path)
s = s.replace(
  [
    '      records.value = [];',
    '      nextCursor.value = null;',
    '      totalRecordCount.value = null;',
    '      recordOffset.value = 0;',
    '      messageCenter.attachSheet(null);',
  ].join(nl),
  [
    '      records.value = [];',
    '      nextCursor.value = null;',
    '      totalRecordCount.value = null;',
    '      recordOffset.value = 0;',
    '      clearRecordWindowCache();',
    '      messageCenter.attachSheet(null);',
  ].join(nl),
);

writeFileSync(path, Buffer.from(s, 'utf8'));
console.log({
  cache: s.includes('recordIndexCache'),
  materialize: s.includes('materializeRecordWindow'),
  prefetch: s.includes('PREFETCH_EDGE'),
  chinese: /静默续拉/.test(s),
});
