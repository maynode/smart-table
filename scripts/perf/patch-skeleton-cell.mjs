import { readFileSync, writeFileSync } from 'node:fs';

const path = 'apps/web/src/components/CanvasGrid.vue';
let s = readFileSync(path, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';

const old = [
  'function renderCell(row: number, col: number): CellRender | null {',
  '  if (props.provider) return props.provider(row, col);',
  '  const field = visibleFields.value[col];',
  '  if (!field) return null;',
  '  const record = recordAt(row);',
  '  if (!record) return null;',
].join(nl);

const neu = [
  'function renderCell(row: number, col: number): CellRender | null {',
  '  if (props.provider) return props.provider(row, col);',
  '  const field = visibleFields.value[col];',
  '  if (!field) return null;',
  '  const record = recordAt(row);',
  '  if (!record) {',
  '    // Windowed large sheet: missing pages show a light skeleton instead of empty flash.',
  '    if ((props.rowCount ?? 0) > props.records.length) {',
  "      return { text: '', bg: '#f3f5f7' };",
  '    }',
  '    return null;',
  '  }',
].join(nl);

if (!s.includes(old)) {
  if (s.includes("bg: '#f3f5f7'")) {
    console.log('already patched');
    process.exit(0);
  }
  console.error('renderCell head not found');
  process.exit(1);
}
s = s.replace(old, neu);
writeFileSync(path, Buffer.from(s, 'utf8'));
console.log({
  ok: s.includes("bg: '#f3f5f7'"),
  chinese: /记录数/.test(s) && /父记录/.test(s),
});
