import { readFileSync } from 'node:fs';

for (const path of [
  'apps/web/src/components/CanvasGrid.vue',
  'apps/web/src/components/GridPanel.vue',
  'apps/web/src/views/BaseShellView.vue',
]) {
  const buf = readFileSync(path);
  const t = buf.toString('utf8');
  console.log(path, {
    hasFu: t.includes('父记录'),
    hasJi: t.includes('记录数'),
    hasQiu: t.includes('求和'),
    hasJing: t.includes('静默续拉'),
    recordAt: t.includes('function recordAt'),
    absolute: (t.match(/absoluteRowCount\(\)/g) || []).length,
  });
}
