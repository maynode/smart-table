/**
 * Root-cause fix for fast-scroll blanks:
 * 1) Prefetch was targeting already-cached offsets (haveEnd - PAD) → no-op
 * 2) Settle-debounce delayed fetch while flinging → worse than before
 * 3) Paint used only dense records[]; cache hits did not redraw
 *
 * Align with WeCom-style tiled cache: render via absolute-row lookup;
 * extend forward with keyset cursor immediately; OFFSET only on big jumps.
 */
import { readFileSync, writeFileSync } from 'node:fs';

function patch(path, fn) {
  const raw = readFileSync(path);
  const before = raw.toString('utf8');
  const after = fn(before);
  if (after === before) console.log('unchanged', path);
  else {
    writeFileSync(path, Buffer.from(after, 'utf8'));
    console.log('patched', path);
  }
}

patch('apps/web/src/components/CanvasGrid.vue', (s) => {
  const nl = s.includes('\r\n') ? '\r\n' : '\n';

  if (!s.includes('recordLookup?:')) {
    s = s.replace(
      [
        '    /** Absolute row index of records[0] (windowed large sheets). */',
        '    recordOffset?: number;',
        '    provider?: ((row: number, col: number) => CellRender | null) | null;',
      ].join(nl),
      [
        '    /** Absolute row index of records[0] (windowed large sheets). */',
        '    recordOffset?: number;',
        '    /** Absolute-row lookup (tiled cache); preferred over dense window. */',
        '    recordLookup?: ((row: number) => RecordDto | undefined) | null;',
        '    /** Bumped when cache pages arrive so canvas repaints without swapping arrays. */',
        '    recordCacheEpoch?: number;',
        '    provider?: ((row: number, col: number) => CellRender | null) | null;',
      ].join(nl),
    );
    s = s.replace(
      `recordOffset: 0,${nl}    provider: null,`,
      `recordOffset: 0,${nl}    recordLookup: null,${nl}    recordCacheEpoch: 0,${nl}    provider: null,`,
    );
  }

  s = s.replace(
    [
      'function recordAt(row: number): RecordDto | undefined {',
      '  return props.records[row - (props.recordOffset ?? 0)];',
      '}',
    ].join(nl),
    [
      'function recordAt(row: number): RecordDto | undefined {',
      '  const fromLookup = props.recordLookup?.(row);',
      '  if (fromLookup) return fromLookup;',
      '  return props.records[row - (props.recordOffset ?? 0)];',
      '}',
    ].join(nl),
  );

  // Remove skeleton — lookup + live prefetch should paint real cells; skeleton felt worse.
  s = s.replace(
    [
      '  const record = recordAt(row);',
      '  if (!record) {',
      '    // Windowed large sheet: missing pages show a light skeleton instead of empty flash.',
      '    if ((props.rowCount ?? 0) > props.records.length) {',
      "      return { text: '', bg: '#f3f5f7' };",
      '    }',
      '    return null;',
      '  }',
    ].join(nl),
    [
      '  const record = recordAt(row);',
      '  if (!record) return null;',
    ].join(nl),
  );

  s = s.replace(
    '[() => props.fields, () => props.records, () => props.rowCount, () => props.recordOffset],',
    '[() => props.fields, () => props.records, () => props.rowCount, () => props.recordOffset, () => props.recordCacheEpoch],',
  );

  return s;
});

patch('apps/web/src/components/GridPanel.vue', (s) => {
  const nl = s.includes('\r\n') ? '\r\n' : '\n';
  if (s.includes('recordLookup?:')) return s;

  s = s.replace(
    [
      '    /** Absolute row index of records[0] */',
      '    recordOffset?: number;',
      '    nextCursor: string | null;',
    ].join(nl),
    [
      '    /** Absolute row index of records[0] */',
      '    recordOffset?: number;',
      '    recordLookup?: ((row: number) => RecordDto | undefined) | null;',
      '    recordCacheEpoch?: number;',
      '    nextCursor: string | null;',
    ].join(nl),
  );

  s = s.replace(
    '{ editable: true, totalRecordCount: null, recordOffset: 0 },',
    '{ editable: true, totalRecordCount: null, recordOffset: 0, recordLookup: null, recordCacheEpoch: 0 },',
  );

  s = s.replace(
    [
      '        :row-count="totalRecordCount ?? undefined"',
      '        :record-offset="recordOffset ?? 0"',
      '        :editable="editable"',
    ].join(nl),
    [
      '        :row-count="totalRecordCount ?? undefined"',
      '        :record-offset="recordOffset ?? 0"',
      '        :record-lookup="recordLookup"',
      '        :record-cache-epoch="recordCacheEpoch ?? 0"',
      '        :editable="editable"',
    ].join(nl),
  );

  return s;
});

patch('apps/web/src/views/BaseShellView.vue', (s) => {
  const nl = s.includes('\r\n') ? '\r\n' : '\n';

  // Constants
  s = s.replace('const WINDOW_SIZE = 1000;', 'const WINDOW_SIZE = 2000;');
  s = s.replace('const WINDOW_PAD = 120;', 'const WINDOW_PAD = 200;');
  s = s.replace('const PREFETCH_EDGE = 400;', 'const PREFETCH_EDGE = 600;');
  s = s.replace('const MAX_INDEX_CACHE = 8000;', 'const MAX_INDEX_CACHE = 12000;');

  if (!s.includes('recordCacheEpoch')) {
    s = s.replace(
      'const recordIndexCache = new Map<number, RecordDto>();',
      [
        'const recordIndexCache = new Map<number, RecordDto>();',
        'const recordCacheEpoch = ref(0);',
      ].join(nl),
    );
  }

  // Replace put/materialize/fetch/ensure block wholesale from clearRecordWindowCache through ensureRecordWindow
  const start = s.indexOf('function clearRecordWindowCache(): void {');
  const end = s.indexOf('async function drainRecordsInBackground');
  if (start < 0 || end < 0) {
    throw new Error('window helpers block not found');
  }

  const replacement = [
    'function clearRecordWindowCache(): void {',
    '  recordIndexCache.clear();',
    '  windowFetchesInFlight.clear();',
    '  lastWindowStats = null;',
    '  if (scrollSettleTimer) clearTimeout(scrollSettleTimer);',
    '  scrollSettleTimer = null;',
    '  recordCacheEpoch.value = 0;',
    '}',
    '',
    'function lookupRecord(row: number): RecordDto | undefined {',
    '  return recordIndexCache.get(row);',
    '}',
    '',
    'function trimRecordIndexCache(anchor: number): void {',
    '  if (recordIndexCache.size <= MAX_INDEX_CACHE) return;',
    '  const ranked = [...recordIndexCache.keys()].sort(',
    '    (a, b) => Math.abs(a - anchor) - Math.abs(b - anchor),',
    '  );',
    '  const keep = new Set(ranked.slice(0, MAX_INDEX_CACHE));',
    '  for (const key of recordIndexCache.keys()) {',
    '    if (!keep.has(key)) recordIndexCache.delete(key);',
    '  }',
    '}',
    '',
    'function putRecordWindow(offset: number, list: RecordDto[], anchor: number): void {',
    '  for (let i = 0; i < list.length; i += 1) {',
    '    recordIndexCache.set(offset + i, list[i]!);',
    '  }',
    '  trimRecordIndexCache(anchor);',
    '  recordCacheEpoch.value += 1;',
    '}',
    '',
    '/** Contiguous dense window for selection/edit; paint prefers lookupRecord. */',
    'function materializeRecordWindow(vStart: number, vEnd: number): void {',
    '  if (recordIndexCache.size === 0) return;',
    '  let start = Math.max(0, vStart);',
    '  while (start > 0 && recordIndexCache.has(start - 1)) start -= 1;',
    '  while (start < vEnd && !recordIndexCache.has(start)) start += 1;',
    '  if (!recordIndexCache.has(start)) return;',
    '  const out: RecordDto[] = [];',
    '  let i = start;',
    '  while (recordIndexCache.has(i) && out.length < MAX_INDEX_CACHE) {',
    '    out.push(recordIndexCache.get(i)!);',
    '    i += 1;',
    '  }',
    '  if (',
    '    start === recordOffset.value &&',
    '    out.length === records.value.length &&',
    '    out[0] === records.value[0] &&',
    '    out[out.length - 1] === records.value[out.length - 1]',
    '  ) {',
    '    return;',
    '  }',
    '  records.value = out;',
    '  recordOffset.value = start;',
    '}',
    '',
    'function clampWindowOffset(total: number, preferred: number): number {',
    '  const maxOffset = Math.max(0, total - WINDOW_SIZE);',
    '  return Math.max(0, Math.min(maxOffset, preferred));',
    '}',
    '',
    'function cacheContiguousEnd(from: number): number {',
    '  let i = from;',
    '  while (recordIndexCache.has(i)) i += 1;',
    '  return i;',
    '}',
    '',
    'function cacheContiguousStart(from: number): number {',
    '  let i = from;',
    '  while (i > 0 && recordIndexCache.has(i - 1)) i -= 1;',
    '  return recordIndexCache.has(i) ? i : from;',
    '}',
    '',
    'function pageAlreadyCached(offset: number): boolean {',
    '  let hit = 0;',
    '  const probe = Math.min(48, WINDOW_SIZE);',
    '  for (let i = 0; i < probe; i += 1) {',
    '    if (recordIndexCache.has(offset + i)) hit += 1;',
    '  }',
    '  return hit >= probe - 2;',
    '}',
    '',
    'function fetchRecordWindow(sheetId: string, offset: number, anchor: number): Promise<void> {',
    '  if (offset < 0) return Promise.resolve();',
    '  if (pageAlreadyCached(offset)) return Promise.resolve();',
    '  const existing = windowFetchesInFlight.get(offset);',
    '  if (existing) return existing;',
    '  const gen = recordsLoadGen.value;',
    '  const task = (async () => {',
    '    try {',
    '      const prev = offset > 0 ? recordIndexCache.get(offset - 1) : undefined;',
    '      const page = prev',
    '        ? await endpoints.listRecords(sheetId, prev.id, WINDOW_SIZE)',
    '        : await endpoints.listRecords(sheetId, null, WINDOW_SIZE, offset);',
    '      if (gen !== recordsLoadGen.value || activeSheet.value?.id !== sheetId) return;',
    '      const appliedOffset = prev ? offset : (page.offset ?? offset);',
    '      putRecordWindow(appliedOffset, page.records, anchor);',
    '      const stats = lastWindowStats;',
    '      if (stats) materializeRecordWindow(stats.rows.start, stats.rows.end);',
    '      else materializeRecordWindow(anchor, anchor + 1);',
    '    } catch {',
    '      /* keep cache */',
    '    } finally {',
    '      windowFetchesInFlight.delete(offset);',
    '    }',
    '  })();',
    '  windowFetchesInFlight.set(offset, task);',
    '  return task;',
    '}',
    '',
    'function scheduleJumpFetch(sheetId: string, total: number): void {',
    '  if (scrollSettleTimer) clearTimeout(scrollSettleTimer);',
    '  scrollSettleTimer = setTimeout(() => {',
    '    scrollSettleTimer = null;',
    '    if (totalRecordCount.value == null || activeSheet.value?.id !== sheetId) return;',
    '    const live = lastWindowStats;',
    '    if (!live) return;',
    '    const mid = Math.floor((live.rows.start + live.rows.end) / 2);',
    '    const primary = clampWindowOffset(total, mid - Math.floor(WINDOW_SIZE / 2));',
    '    void fetchRecordWindow(sheetId, primary, mid);',
    '  }, SCROLL_SETTLE_MS);',
    '}',
    '',
    'async function ensureRecordWindow(stats: { rows: { start: number; end: number } }): Promise<void> {',
    '  if (totalRecordCount.value == null || !activeSheet.value) return;',
    '  const total = totalRecordCount.value;',
    '  const sheetId = activeSheet.value.id;',
    '  lastWindowStats = stats;',
    '  materializeRecordWindow(stats.rows.start, stats.rows.end);',
    '',
    '  const viewStart = stats.rows.start;',
    '  const viewEnd = stats.rows.end;',
    '  const mid = Math.floor((viewStart + viewEnd) / 2);',
    '',
    '  // Contiguous loaded span intersecting viewport (or nearest below).',
    '  let haveStart = recordOffset.value;',
    '  let haveEnd = recordOffset.value + records.value.length;',
    '  if (recordIndexCache.has(viewStart)) {',
    '    haveStart = cacheContiguousStart(viewStart);',
    '    haveEnd = cacheContiguousEnd(viewStart);',
    '  } else if (records.value.length > 0) {',
    '    haveStart = recordOffset.value;',
    '    haveEnd = recordOffset.value + records.value.length;',
    '  }',
    '',
    '  const covered = haveEnd > haveStart && viewStart >= haveStart && viewEnd <= haveEnd;',
    '  const gapAhead = viewStart > haveEnd + WINDOW_SIZE;',
    '  const gapBehind = viewEnd < haveStart - WINDOW_SIZE;',
    '',
    '  // Big scrollbar jump → one OFFSET after settle (deep skip is expensive).',
    '  if (gapAhead || gapBehind) {',
    '    scheduleJumpFetch(sheetId, total);',
    '    return;',
    '  }',
    '',
    '  // Continuous scroll: ALWAYS extend from the unloaded edge via keyset.',
    '  // Root bug was prefetching haveEnd-PAD (already cached) → never fetched ahead.',
    '  if (viewEnd + PREFETCH_EDGE >= haveEnd) {',
    '    void fetchRecordWindow(sheetId, haveEnd, mid);',
    '    void fetchRecordWindow(sheetId, haveEnd + WINDOW_SIZE, mid);',
    '  }',
    '  if (viewStart - PREFETCH_EDGE <= haveStart) {',
    '    const back = clampWindowOffset(total, haveStart - WINDOW_SIZE);',
    '    void fetchRecordWindow(sheetId, back, mid);',
    '  }',
    '  if (!covered) {',
    '    if (viewStart >= haveEnd) void fetchRecordWindow(sheetId, haveEnd, mid);',
    '    if (viewEnd <= haveStart) {',
    '      void fetchRecordWindow(sheetId, clampWindowOffset(total, haveStart - WINDOW_SIZE), mid);',
    '    }',
    '  }',
    '}',
    '',
    '',
  ].join(nl);

  s = s.slice(0, start) + replacement + s.slice(end);

  // Wire lookup + epoch into both GridPanels
  for (const indent of ['              ', '            ']) {
    const from = [
      `${indent}:total-record-count="totalRecordCount"`,
      `${indent}:record-offset="recordOffset"`,
      `${indent}:next-cursor="nextCursor"`,
    ].join(nl);
    const to = [
      `${indent}:total-record-count="totalRecordCount"`,
      `${indent}:record-offset="recordOffset"`,
      `${indent}:record-lookup="lookupRecord"`,
      `${indent}:record-cache-epoch="recordCacheEpoch"`,
      `${indent}:next-cursor="nextCursor"`,
    ].join(nl);
    if (s.includes(from) && !s.includes(`${indent}:record-lookup="lookupRecord"`)) {
      s = s.replace(from, to);
    }
  }

  return s;
});

console.log('done');
