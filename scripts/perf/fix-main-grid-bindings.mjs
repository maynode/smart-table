import { readFileSync, writeFileSync } from 'node:fs';

const path = 'apps/web/src/views/BaseShellView.vue';
let s = readFileSync(path, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';

const from = [
  '            :total-record-count="totalRecordCount"',
  '            :record-offset="recordOffset"',
  '            :next-cursor="nextCursor"',
].join(nl);

const to = [
  '            :total-record-count="totalRecordCount"',
  '            :record-offset="recordOffset"',
  '            :record-lookup="lookupRecord"',
  '            :record-cache-epoch="recordCacheEpoch"',
  '            :next-cursor="nextCursor"',
].join(nl);

if (!s.includes(from)) {
  console.error('main grid bindings not found');
  process.exit(1);
}
if ((s.match(/:record-lookup="lookupRecord"/g) || []).length < 2) {
  s = s.replace(from, to);
}

// Ensure form-results also has epoch
const from2 = [
  '              :record-lookup="lookupRecord"',
  '              :next-cursor="nextCursor"',
].join(nl);
const to2 = [
  '              :record-lookup="lookupRecord"',
  '              :record-cache-epoch="recordCacheEpoch"',
  '              :next-cursor="nextCursor"',
].join(nl);
if (s.includes(from2)) s = s.replace(from2, to2);

writeFileSync(path, Buffer.from(s, 'utf8'));
console.log({
  lookups: (s.match(/:record-lookup="lookupRecord"/g) || []).length,
  epochs: (s.match(/:record-cache-epoch="recordCacheEpoch"/g) || []).length,
  chinese: /静默续拉/.test(s),
});
