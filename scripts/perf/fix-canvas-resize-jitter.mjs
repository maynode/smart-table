/**
 * One-shot: repair CanvasGrid UTF-8 + split watches to stop resize jitter.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'apps/web/src/components/CanvasGrid.vue';
let s = readFileSync(path, 'utf8');

if (!/[\u4e00-\u9fff]/.test(s)) {
  s = Buffer.from(s, 'latin1').toString('utf8');
  console.log(
    'repaired encoding, cjk',
    (s.match(/[\u4e00-\u9fff]/g) || []).length,
  );
}

if (!s.includes('let lastViewportRangeKey')) {
  s = s.replace(
    "let lastViewportKey = '';",
    "let lastViewportKey = '';\nlet lastViewportRangeKey = '';",
  );
  console.log('added lastViewportRangeKey');
}

const oldWatchLf = `watch(
  [() => props.fields, () => props.records, () => props.rowCount, () => props.recordOffset, () => props.recordCacheEpoch],
  () => {
    if (!engine) return;
    engine.setColumns(columns.value);
    engine.setRowCount(absoluteRowCount());
    engine.setCellProvider(renderCell);
    engine.setColumnFooterProvider(columnFooter);
    engine.invalidate();
  },
  { deep: true },
);`;

const newWatchLf = `watch(
  () => props.fields,
  () => {
    if (!engine) return;
    engine.setColumns(columns.value);
    engine.setColumnFooterProvider(columnFooter);
    engine.invalidate();
  },
  { deep: true },
);

watch(
  [() => props.rowCount, () => props.recordOffset],
  () => {
    if (!engine) return;
    engine.setRowCount(absoluteRowCount());
    engine.invalidate();
  },
);

watch(
  [() => props.records, () => props.recordCacheEpoch],
  () => {
    if (!engine) return;
    // Paint via lookup/cache; avoid setColumns (rebuilds axes) on every window materialize.
    engine.setCellProvider(renderCell);
    engine.setColumnFooterProvider(columnFooter);
    engine.invalidate();
  },
);`;

const oldWatchCrlf = oldWatchLf.replace(/\n/g, '\r\n');
const newWatchCrlf = newWatchLf.replace(/\n/g, '\r\n');

if (s.includes(oldWatchLf)) {
  s = s.replace(oldWatchLf, newWatchLf);
  console.log('replaced watch LF');
} else if (s.includes(oldWatchCrlf)) {
  s = s.replace(oldWatchCrlf, newWatchCrlf);
  console.log('replaced watch CRLF');
} else {
  console.error('watch block not found');
  process.exit(1);
}

writeFileSync(path, s, 'utf8');
console.log('ok', {
  editToast: s.includes('正在编辑此单元格'),
  rangeKey: s.includes('let lastViewportRangeKey'),
  splitWatch: s.includes('avoid setColumns'),
});
