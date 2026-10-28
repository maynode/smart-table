import { readFileSync, writeFileSync } from 'node:fs';

const path = 'apps/web/src/views/BaseShellView.vue';
let s = readFileSync(path, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';

// Collapse duplicate ensure-window after load-more
s = s.replace(
  new RegExp(
    '@load-more="loadMore"' +
      nl +
      '\\s*@ensure-window="ensureRecordWindow"' +
      nl +
      '\\s*@ensure-window="ensureRecordWindow"',
    'g',
  ),
  '@load-more="loadMore"' + nl + '              @ensure-window="ensureRecordWindow"',
);

// Main grid (12-space indent) needs ensure-window
if (
  !s.includes(
    '            @load-more="loadMore"' +
      nl +
      '            @ensure-window="ensureRecordWindow"',
  )
) {
  s = s.replace(
    '            @load-more="loadMore"' + nl + '            @refresh="refreshSheet"',
    [
      '            @load-more="loadMore"',
      '            @ensure-window="ensureRecordWindow"',
      '            @refresh="refreshSheet"',
    ].join(nl),
  );
}

// Move drain JSDoc off ensureRecordWindow
s = s.replace(
  [
    '/**',
    ' * 静默续拉剩余行（无分页 UI）。Canvas 虚拟滚动只渲染可视区；',
    ' * 批次在后台拼齐，体验对齐 Excel「整表在内存、滚动浏览」。',
    ' */',
    'async function ensureRecordWindow',
  ].join(nl),
  'async function ensureRecordWindow',
);

if (
  !s.includes(
    [
      '/**',
      ' * 静默续拉剩余行（无分页 UI）。Canvas 虚拟滚动只渲染可视区；',
      ' * 批次在后台拼齐，体验对齐 Excel「整表在内存、滚动浏览」。',
      ' */',
      'async function drainRecordsInBackground',
    ].join(nl),
  )
) {
  s = s.replace(
    'async function drainRecordsInBackground(sheetId: string): Promise<void> {',
    [
      '/**',
      ' * 静默续拉剩余行（无分页 UI）。Canvas 虚拟滚动只渲染可视区；',
      ' * 批次在后台拼齐，体验对齐 Excel「整表在内存、滚动浏览」。',
      ' */',
      'async function drainRecordsInBackground(sheetId: string): Promise<void> {',
    ].join(nl),
  );
}

if (
  !s.includes(
    '    recordsLoadGen.value += 1;' +
      nl +
      '    const page = await endpoints.listRecords(sheetId, null, WINDOW_SIZE, 0);',
  )
) {
  s = s.replace(
    '    const page = await endpoints.listRecords(sheetId, null, WINDOW_SIZE, 0);',
    '    recordsLoadGen.value += 1;' +
      nl +
      '    const page = await endpoints.listRecords(sheetId, null, WINDOW_SIZE, 0);',
  );
}

writeFileSync(path, Buffer.from(s, 'utf8'));
console.log({
  ensure: (s.match(/@ensure-window/g) || []).length,
  totals: (s.match(/:total-record-count/g) || []).length,
  chinese: /静默续拉/.test(s),
});
