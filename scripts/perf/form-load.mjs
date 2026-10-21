/**
 * Sustained public-form submission load.
 * Usage: PERF_CONCURRENCY=100 PERF_DURATION_SECONDS=30 node scripts/perf/form-load.mjs
 *
 * The API must allow the test IP (PUBLIC_SUBMIT_RATE_LIMIT high enough).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const API = process.env.PERF_API ?? 'http://127.0.0.1:3000';
const CONCURRENCY = Number(process.env.PERF_CONCURRENCY ?? 100);
const DURATION_MS = Number(process.env.PERF_DURATION_SECONDS ?? 30) * 1000;
const samples = [];
const statuses = new Map();

async function json(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

const stamp = Date.now();
const session = await json('/auth/register', {
  method: 'POST',
  body: JSON.stringify({
    email: `perf-form-${stamp}@example.com`,
    password: 'Passw0rd!123',
    name: '表单压测',
  }),
});
const headers = { Authorization: `Bearer ${session.accessToken}` };
const workspace = await json('/workspaces', {
  method: 'POST',
  headers,
  body: JSON.stringify({ name: `表单压测${stamp}` }),
});
const base = await json(`/workspaces/${workspace.id}/bases`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ name: '压测 Base' }),
});
const sheet = await json(`/bases/${base.id}/sheets`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ name: '提交表' }),
});
const field = await json(`/sheets/${sheet.id}/fields`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ name: '手机号', type: 'phone' }),
});
const formId = randomUUID();
const form = await json(`/forms/${formId}`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    baseId: base.id,
    sheetId: sheet.id,
    name: '压测表单',
    fields: [{ fieldId: field.id, required: true }],
    share: { enabled: true, audience: 'anyone' },
    successPage: { templateHtml: '提交成功' },
  }),
});
const token = form.share.token;

const deadline = Date.now() + DURATION_MS;
let sequence = 0;

async function worker() {
  while (Date.now() < deadline) {
    const value = `139${String((sequence += 1) % 100_000_000).padStart(8, '0')}`;
    const started = performance.now();
    let status = 0;
    try {
      const response = await fetch(`${API}/public/forms/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cells: { [field.id]: value } }),
        signal: AbortSignal.timeout(15_000),
      });
      status = response.status;
      await response.arrayBuffer();
    } catch {
      status = -1;
    }
    samples.push(performance.now() - started);
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
  }
}

const startedAt = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
const elapsedMs = Date.now() - startedAt;

const sorted = [...samples].sort((a, b) => a - b);
const percentile = (p) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const successes = (statuses.get(201) ?? 0) + (statuses.get(202) ?? 0);
const report = {
  sheetId: sheet.id,
  formToken: token,
  concurrency: CONCURRENCY,
  durationMs: elapsedMs,
  requests: samples.length,
  successes,
  successRate: Number((successes / samples.length).toFixed(4)),
  rps: Number((samples.length / (elapsedMs / 1000)).toFixed(1)),
  statuses: Object.fromEntries([...statuses.entries()].sort()),
  latencyMs: {
    p50: Number(percentile(50).toFixed(2)),
    p95: Number(percentile(95).toFixed(2)),
    p99: Number(percentile(99).toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
  },
};

await mkdir('artifacts/perf', { recursive: true });
await writeFile(
  'artifacts/perf/form-load.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));

if (report.successRate < 0.99) {
  throw new Error(`success rate ${report.successRate} below 0.99`);
}
if (report.latencyMs.p95 > 1000) {
  throw new Error(`p95 ${report.latencyMs.p95}ms exceeds 1000ms`);
}
