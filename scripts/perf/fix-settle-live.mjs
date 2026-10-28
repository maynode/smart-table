import { readFileSync, writeFileSync } from 'node:fs';

const path = 'apps/web/src/views/BaseShellView.vue';
let s = readFileSync(path, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';

s = s.replace(
  [
    'function clearRecordWindowCache(): void {',
    '  recordIndexCache.clear();',
    '  windowFetchesInFlight.clear();',
    '  lastWindowStats = null;',
    '}',
  ].join(nl),
  [
    'function clearRecordWindowCache(): void {',
    '  recordIndexCache.clear();',
    '  windowFetchesInFlight.clear();',
    '  lastWindowStats = null;',
    '  if (scrollSettleTimer) clearTimeout(scrollSettleTimer);',
    '  scrollSettleTimer = null;',
    '}',
  ].join(nl),
);

const from = [
  '    if (totalRecordCount.value == null || activeSheet.value?.id !== sheetId) return;',
  '    const mid = Math.floor((viewStart + viewEnd) / 2);',
  '    const primary = clampWindowOffset(total, mid - Math.floor(WINDOW_SIZE / 2));',
].join(nl);

const to = [
  '    if (totalRecordCount.value == null || activeSheet.value?.id !== sheetId) return;',
  '    const live = lastWindowStats ?? { rows: { start: viewStart, end: viewEnd } };',
  '    const mid = Math.floor((live.rows.start + live.rows.end) / 2);',
  '    const primary = clampWindowOffset(total, mid - Math.floor(WINDOW_SIZE / 2));',
].join(nl);

if (!s.includes(from)) {
  console.error('settle mid block missing');
  process.exit(1);
}
s = s.replace(from, to);
writeFileSync(path, Buffer.from(s, 'utf8'));
console.log({ ok: s.includes('live.rows.start'), chinese: /静默续拉/.test(s) });
