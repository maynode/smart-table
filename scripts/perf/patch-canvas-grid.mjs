import { readFileSync, writeFileSync } from 'node:fs';

const path = 'apps/web/src/components/CanvasGrid.vue';
const raw = readFileSync(path);
const nl = raw.includes(0x0d) ? '\r\n' : '\n';
let s = raw.toString('utf8');

if (!s.includes('recordOffset?: number')) {
  s = s.replace(
    `rowCount?: number;${nl}    provider?:`,
    [
      'rowCount?: number;',
      '    /** Absolute row index of records[0] (windowed large sheets). */',
      '    recordOffset?: number;',
      '    provider?:',
    ].join(nl),
  );
  s = s.replace(
    `rowCount: undefined,${nl}    provider: null,`,
    `rowCount: undefined,${nl}    recordOffset: 0,${nl}    provider: null,`,
  );
}

if (!s.includes('function recordAt(')) {
  s = s.replace(
    `function closeCellMenu(): void {${nl}  cellMenu.value = null;${nl}}${nl}${nl}function confirmInsert`,
    [
      'function closeCellMenu(): void {',
      '  cellMenu.value = null;',
      '}',
      '',
      '/** Absolute row -> record in current window (large-sheet offset window). */',
      'function recordAt(row: number): RecordDto | undefined {',
      '  return props.records[row - (props.recordOffset ?? 0)];',
      '}',
      '',
      'function absoluteRowCount(): number {',
      '  return props.rowCount ?? props.records.length;',
      '}',
      '',
      'function confirmInsert',
    ].join(nl),
  );
}

const reps = [
  ['props.records[selection.row]', 'recordAt(selection.row)'],
  ['props.records[sel.row]', 'recordAt(sel.row)'],
  ['props.records[rowIndex]', 'recordAt(rowIndex)'],
  ['props.records[fromRow]', 'recordAt(fromRow)'],
  ['props.records[row]', 'recordAt(row)'],
  ['props.records[index]?.id', 'recordAt(index)?.id'],
  ['(props.rowCount ?? props.records.length) - 1', 'absoluteRowCount() - 1'],
  ['const maxRows = props.records.length;', 'const maxRows = absoluteRowCount();'],
  ['return `\u8bb0\u5f55\u6570 ${props.records.length}`;', 'return `\u8bb0\u5f55\u6570 ${absoluteRowCount()}`;'],
  ['rowCount: props.rowCount ?? props.records.length,', 'rowCount: absoluteRowCount(),'],
  [
    'engine.setRowCount(props.rowCount ?? props.records.length);',
    'engine.setRowCount(absoluteRowCount());',
  ],
];

for (const [from, to] of reps) {
  s = s.split(from).join(to);
}

if (!s.includes('() => props.recordOffset')) {
  s = s.replace(
    '[() => props.fields, () => props.records, () => props.rowCount],',
    '[() => props.fields, () => props.records, () => props.rowCount, () => props.recordOffset],',
  );
}

writeFileSync(path, Buffer.from(s, 'utf8'));
console.log({
  remainingIndexed: [...s.matchAll(/props\.records\[/g)].length,
  recordAt: s.includes('function recordAt'),
  absoluteCalls: (s.match(/absoluteRowCount\(\)/g) || []).length,
  chineseOk: /\u8bb0\u5f55\u6570/.test(s) && /\u7236\u8bb0\u5f55/.test(s),
});
