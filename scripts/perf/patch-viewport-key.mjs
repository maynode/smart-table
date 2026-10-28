import { readFileSync, writeFileSync } from 'node:fs';

const path = 'apps/web/src/components/CanvasGrid.vue';
let s = readFileSync(path, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';

s = s.replace(
  'let lastViewportEnd = -1;',
  "let lastViewportKey = '';",
);

const from = [
  'function handleViewport(stats: GridStats): void {',
  '  layoutEpoch.value += 1;',
  '  if (stats.rows.end === lastViewportEnd) return;',
  '  lastViewportEnd = stats.rows.end;',
  "  emit('viewport', stats);",
  '}',
].join(nl);

const to = [
  'function handleViewport(stats: GridStats): void {',
  '  layoutEpoch.value += 1;',
  '  const key = `${stats.rows.start}:${stats.rows.end}`;',
  '  if (key === lastViewportKey) return;',
  '  lastViewportKey = key;',
  "  emit('viewport', stats);",
  '}',
].join(nl);

if (!s.includes(from)) {
  console.error('handleViewport block not found');
  process.exit(1);
}
s = s.replace(from, to);
writeFileSync(path, Buffer.from(s, 'utf8'));
console.log({
  ok: s.includes('lastViewportKey'),
  chinese: /父记录/.test(s) && /记录数/.test(s),
});
