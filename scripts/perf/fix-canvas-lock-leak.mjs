import { readFileSync, writeFileSync } from 'node:fs';

const path = 'apps/web/src/components/CanvasGrid.vue';
let s = readFileSync(path, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';

// Fix corrupted toast strings
s = s.replace(
  /toast\(`\$\{lock\.holderName\}[^`]*`\);/g,
  'toast(`${lock.holderName} \u6b63\u5728\u7f16\u8f91\u6b64\u5355\u5143\u683c`);',
);

// Release lock when readonly field short-circuits after acquire
const readonlyReturn = [
  "    field.type === 'groupChat'",
  '  ) {',
  '    return;',
  '  }',
].join(nl);
const readonlyRelease = [
  "    field.type === 'groupChat'",
  '  ) {',
  '    props.releaseCellLock?.(record.id, field.id);',
  '    return;',
  '  }',
].join(nl);
if (s.includes(readonlyReturn) && !s.includes('props.releaseCellLock?.(record.id, field.id);')) {
  s = s.replace(readonlyReturn, readonlyRelease);
}

writeFileSync(path, Buffer.from(s, 'utf8'));
console.log({
  toastOk: s.includes('\u6b63\u5728\u7f16\u8f91\u6b64\u5355\u5143\u683c'),
  releaseReadonly: s.includes("field.type === 'groupChat'") &&
    s.includes('props.releaseCellLock?.(record.id, field.id);'),
  chineseRecord: /\u8bb0\u5f55\u6570/.test(s),
});
