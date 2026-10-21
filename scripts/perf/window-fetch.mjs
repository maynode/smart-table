/**
 * Deep-page window fetch latency against the 10M-row perf sheet.
 * Random UUID cursors land across the whole table instead of only page 1.
 *
 * Usage: node scripts/perf/window-fetch.mjs
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const thresholds = JSON.parse(
  await readFile('scripts/perf/thresholds.json', 'utf8'),
).windowFetch10m;

const API = process.env.PERF_API ?? 'http://127.0.0.1:3000';
const env = JSON.parse(
  (await readFile('.perf-env.json', 'utf8')).replace(/^\uFEFF/, ''),
);
const samples = [];
const counts = [];

async function fetchPage(cursor) {
  const started = performance.now();
  const response = await fetch(
    `${API}/sheets/${env.sheetId}/records?limit=100&cursor=${cursor}`,
    {
      headers: { Authorization: `Bearer ${env.token}` },
      signal: AbortSignal.timeout(20_000),
    },
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`status ${response.status}: ${JSON.stringify(body)}`);
  }
  samples.push(performance.now() - started);
  counts.push(body.records.length);
}

for (let index = 0; index < 10; index += 1) await fetchPage(randomUUID());
samples.length = 0;
counts.length = 0;

for (let index = 0; index < 200; index += 1) {
  await fetchPage(randomUUID());
}

const sorted = [...samples].sort((a, b) => a - b);
const percentile = (p) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const report = {
  sheetId: env.sheetId,
  requests: samples.length,
  rowsPerPage: 100,
  pageSizes: {
    min: Math.min(...counts),
    max: Math.max(...counts),
  },
  latencyMs: {
    p50: Number(percentile(50).toFixed(2)),
    p95: Number(percentile(95).toFixed(2)),
    p99: Number(percentile(99).toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
  },
};

await mkdir('artifacts/perf', { recursive: true });
await writeFile(
  'artifacts/perf/window-fetch.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));

if (report.latencyMs.p95 > thresholds.p95Ms) {
  throw new Error(
    `window fetch p95 ${report.latencyMs.p95}ms exceeds ${thresholds.p95Ms}ms`,
  );
}
