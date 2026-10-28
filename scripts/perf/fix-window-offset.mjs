import { readFileSync, writeFileSync } from 'node:fs';

const path = 'apps/web/src/views/BaseShellView.vue';
let s = readFileSync(path, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';

const from = `const offset = Math.max(0, Math.min(total - 1, mid - Math.floor(WINDOW_SIZE / 2)));`;
const to = [
  'const maxOffset = Math.max(0, total - WINDOW_SIZE);',
  '  const offset = Math.max(0, Math.min(maxOffset, mid - Math.floor(WINDOW_SIZE / 2)));',
].join(nl);

if (!s.includes(from)) {
  console.error('offset line not found');
  process.exit(1);
}
s = s.replace(from, to);
writeFileSync(path, Buffer.from(s, 'utf8'));
console.log({ ok: s.includes('maxOffset'), chinese: /静默续拉/.test(s) });
