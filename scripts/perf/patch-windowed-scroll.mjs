/**
 * Wire GridPanel + BaseShellView for large-sheet offset windowing.
 * ASCII-safe edits only; preserves existing UTF-8 / CRLF.
 */
import { readFileSync, writeFileSync } from 'node:fs';

function patch(path, transform) {
  const raw = readFileSync(path);
  const before = raw.toString('utf8');
  const after = transform(before);
  if (after === before) {
    console.log('unchanged', path);
    return;
  }
  writeFileSync(path, Buffer.from(after, 'utf8'));
  console.log('patched', path);
}

patch('apps/web/src/components/GridPanel.vue', (s) => {
  if (s.includes('recordOffset?: number')) return s;

  s = s.replace(
    'records: RecordDto[];\n    nextCursor: string | null;',
    [
      'records: RecordDto[];',
      '    /** Absolute total rows (virtual scrollbar); omit = records.length */',
      '    totalRecordCount?: number | null;',
      '    /** Absolute row index of records[0] */',
      '    recordOffset?: number;',
      '    nextCursor: string | null;',
    ].join('\n'),
  );

  // Also handle CRLF
  s = s.replace(
    'records: RecordDto[];\r\n    nextCursor: string | null;',
    [
      'records: RecordDto[];',
      '    /** Absolute total rows (virtual scrollbar); omit = records.length */',
      '    totalRecordCount?: number | null;',
      '    /** Absolute row index of records[0] */',
      '    recordOffset?: number;',
      '    nextCursor: string | null;',
    ].join('\r\n'),
  );

  if (!s.includes('totalRecordCount: null')) {
    s = s.replace(
      '{ editable: true },',
      '{ editable: true, totalRecordCount: null, recordOffset: 0 },',
    );
  }

  if (!s.includes("ensureWindow: [stats: GridStats]")) {
    s = s.replace(
      'loadMore: [];',
      'loadMore: [];\n  ensureWindow: [stats: GridStats];',
    );
    s = s.replace(
      'loadMore: [];\r\n',
      'loadMore: [];\r\n  ensureWindow: [stats: GridStats];\r\n',
    );
  }

  // Viewport: bubble for windowed mode; keep loadMore for drain mode
  const oldHandle =
    'function handleViewport(stats: GridStats): void {\n  if (!props.nextCursor || props.loading) return;\n  if (stats.rows.end >= props.records.length - 5) {\n    emit(\'loadMore\');\n  }\n}';
  const newHandle = [
    'function handleViewport(stats: GridStats): void {',
    '  if (props.totalRecordCount != null && props.totalRecordCount > props.records.length) {',
    '    emit(\'ensureWindow\', stats);',
    '    return;',
    '  }',
    '  if (!props.nextCursor || props.loading) return;',
    '  if (stats.rows.end >= props.records.length - 5) {',
    "    emit('loadMore');",
    '  }',
    '}',
  ].join('\n');
  if (s.includes(oldHandle)) {
    s = s.replace(oldHandle, newHandle);
  } else {
    const oldCrlf = oldHandle.replace(/\n/g, '\r\n');
    const newCrlf = newHandle.replace(/\n/g, '\r\n');
    if (s.includes(oldCrlf)) s = s.replace(oldCrlf, newCrlf);
  }

  // Pass rowCount / recordOffset to CanvasGrid
  if (!s.includes(':row-count=')) {
    s = s.replace(
      ':records="displayRecords"\n        :editable="editable"',
      [
        ':records="displayRecords"',
        '        :row-count="totalRecordCount ?? undefined"',
        '        :record-offset="recordOffset ?? 0"',
        '        :editable="editable"',
      ].join('\n'),
    );
    s = s.replace(
      ':records="displayRecords"\r\n        :editable="editable"',
      [
        ':records="displayRecords"',
        '        :row-count="totalRecordCount ?? undefined"',
        '        :record-offset="recordOffset ?? 0"',
        '        :editable="editable"',
      ].join('\r\n'),
    );
  }

  // Footer test hook uses absolute count when known
  s = s.replace(
    '记录数 {{ displayRecords.length }}',
    '记录数 {{ totalRecordCount ?? displayRecords.length }}',
  );

  return s;
});

patch('apps/web/src/views/BaseShellView.vue', (s) => {
  if (s.includes('ensureRecordWindow')) return s;

  const nl = s.includes('\r\n') ? '\r\n' : '\n';

  // State after nextCursor
  s = s.replace(
    `const nextCursor = ref<string | null>(null);${nl}/** 静默续拉世代号：切表时递增，丢弃过期批次 */${nl}const recordsLoadGen = ref(0);`,
    [
      'const nextCursor = ref<string | null>(null);',
      '/** Large sheet: absolute total for virtual scrollbar (null = small/drain mode). */',
      'const totalRecordCount = ref<number | null>(null);',
      'const recordOffset = ref(0);',
      'const WINDOW_SIZE = 500;',
      'const WINDOW_PAD = 80;',
      'const LARGE_SHEET_THRESHOLD = 2000;',
      '/** 静默续拉世代号：切表时递增，丢弃过期批次 */',
      'const recordsLoadGen = ref(0);',
      'let windowFetchInFlight: Promise<void> | null = null;',
      'let windowFetchTarget = -1;',
    ].join(nl),
  );

  // selectSheet homepage load
  const oldSelect = [
    '    const page = await endpoints.listRecords(sheetId, null, 200);',
    '    records.value = page.records;',
    '    nextCursor.value = page.nextCursor;',
    '    void drainRecordsInBackground(sheetId);',
  ].join(nl);

  const newSelect = [
    '    const page = await endpoints.listRecords(sheetId, null, WINDOW_SIZE, 0);',
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

  if (!s.includes(oldSelect)) {
    throw new Error('selectSheet listRecords block not found');
  }
  s = s.replace(oldSelect, newSelect);

  // Form-results / other listRecords(200) that reset — leave as-is for small pages

  // Clear totals when emptying records on form sheet
  s = s.replace(
    `      records.value = [];${nl}      nextCursor.value = null;${nl}      messageCenter.attachSheet(null);`,
    [
      '      records.value = [];',
      '      nextCursor.value = null;',
      '      totalRecordCount.value = null;',
      '      recordOffset.value = 0;',
      '      messageCenter.attachSheet(null);',
    ].join(nl),
  );

  // Insert ensureRecordWindow before drainRecordsInBackground
  const drainStart = `async function drainRecordsInBackground(sheetId: string): Promise<void> {`;
  if (!s.includes(drainStart)) throw new Error('drainRecordsInBackground not found');

  const ensureFn = [
    'async function ensureRecordWindow(stats: { rows: { start: number; end: number } }): Promise<void> {',
    '  if (totalRecordCount.value == null || !activeSheet.value) return;',
    '  const total = totalRecordCount.value;',
    '  const sheetId = activeSheet.value.id;',
    '  const needStart = Math.max(0, stats.rows.start - WINDOW_PAD);',
    '  const needEnd = Math.min(total, stats.rows.end + WINDOW_PAD);',
    '  const haveStart = recordOffset.value;',
    '  const haveEnd = recordOffset.value + records.value.length;',
    '  if (needStart >= haveStart && needEnd <= haveEnd) return;',
    '',
    '  const mid = Math.floor((stats.rows.start + stats.rows.end) / 2);',
    '  const offset = Math.max(0, Math.min(total - 1, mid - Math.floor(WINDOW_SIZE / 2)));',
    '  if (offset === windowFetchTarget && windowFetchInFlight) {',
    '    await windowFetchInFlight;',
    '    return;',
    '  }',
    '  windowFetchTarget = offset;',
    '  const gen = recordsLoadGen.value;',
    '  windowFetchInFlight = (async () => {',
    '    try {',
    '      const page = await endpoints.listRecords(sheetId, null, WINDOW_SIZE, offset);',
    '      if (gen !== recordsLoadGen.value || activeSheet.value?.id !== sheetId) return;',
    '      records.value = page.records;',
    '      recordOffset.value = page.offset ?? offset;',
    '    } catch {',
    '      /* keep previous window */',
    '    } finally {',
    '      if (windowFetchTarget === offset) windowFetchInFlight = null;',
    '    }',
    '  })();',
    '  await windowFetchInFlight;',
    '}',
    '',
    drainStart,
  ].join(nl);

  s = s.replace(drainStart, ensureFn);

  // applyViewQuery: leave windowed mode
  s = s.replace(
    `    records.value = result.records;${nl}    nextCursor.value = null;`,
    [
      '    records.value = result.records;',
      '    nextCursor.value = null;',
      '    totalRecordCount.value = null;',
      '    recordOffset.value = 0;',
    ].join(nl),
  );

  // Template: both GridPanels — add props + ensure-window
  const gridBindings = [
    ':records="records"',
    '              :next-cursor="nextCursor"',
  ];
  // form results uses more spaces? check both indent levels
  for (const indent of ['              ', '            ']) {
    const from = `${indent}:records="records"${nl}${indent}:next-cursor="nextCursor"`;
    const to = [
      `${indent}:records="records"`,
      `${indent}:total-record-count="totalRecordCount"`,
      `${indent}:record-offset="recordOffset"`,
      `${indent}:next-cursor="nextCursor"`,
    ].join(nl);
    s = s.split(from).join(to);
  }

  for (const indent of ['              ', '            ']) {
    const from = `${indent}@load-more="loadMore"`;
    const to = `${indent}@load-more="loadMore"${nl}${indent}@ensure-window="ensureRecordWindow"`;
    if (s.includes(from) && !s.includes('@ensure-window="ensureRecordWindow"')) {
      // replace both occurrences via split once each
    }
    s = s.replace(from, to); // first only if we call replace once per... use split join for all
  }
  // The above replace only does first match each loop - use split/join
  // Re-do cleanly:
  if ((s.match(/@ensure-window="ensureRecordWindow"/g) || []).length < 2) {
    s = s.split('@load-more="loadMore"').join(
      '@load-more="loadMore"' + nl + '            @ensure-window="ensureRecordWindow"',
    );
    // form-results has deeper indent — fix double-indent mismatch by normalizing later if needed
  }

  return s;
});

console.log('done');
