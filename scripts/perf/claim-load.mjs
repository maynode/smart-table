/**
 * Task 26 claim gate over real HTTP (Docker API + PgBouncer), not supertest.
 * Creates N codes, fires N simultaneous submissions, requires N successes,
 * N unique serials and zero duplicate rows.
 *
 * Usage: PERF_CODES=1000 PERF_CONCURRENCY=1000 node scripts/perf/claim-load.mjs
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const API = process.env.PERF_API ?? 'http://127.0.0.1:3000';
const CODE_COUNT = Number(process.env.PERF_CODES ?? 1000);
const CONCURRENCY = Number(process.env.PERF_CONCURRENCY ?? 1000);
const latencies = [];

async function call(path, { token, ...init } = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const stamp = Date.now();
const owner = await call('/auth/register', {
  method: 'POST',
  body: JSON.stringify({
    email: `claim-perf-${stamp}@example.com`,
    password: 'Passw0rd!123',
    name: '领码压测',
  }),
});
const token = owner.accessToken;
const workspace = await call('/workspaces', {
  method: 'POST',
  token,
  body: JSON.stringify({ name: `领码压测${stamp}` }),
});
const base = await call(`/workspaces/${workspace.id}/bases`, {
  method: 'POST',
  token,
  body: JSON.stringify({ name: '压测 Base' }),
});
const formSheet = await call(`/bases/${base.id}/sheets`, {
  method: 'POST',
  token,
  body: JSON.stringify({ name: '收集表单' }),
});
const phone = await call(`/sheets/${formSheet.id}/fields`, {
  method: 'POST',
  token,
  body: JSON.stringify({ name: '手机号', type: 'phone' }),
});
const codeSheet = await call(`/bases/${base.id}/sheets`, {
  method: 'POST',
  token,
  body: JSON.stringify({ name: '码库' }),
});
const serial = await call(`/sheets/${codeSheet.id}/fields`, {
  method: 'POST',
  token,
  body: JSON.stringify({ name: '序列号', type: 'text' }),
});
const status = await call(`/sheets/${codeSheet.id}/fields`, {
  method: 'POST',
  token,
  body: JSON.stringify({
    name: '状态',
    type: 'select',
    options: {
      choices: [
        { id: 'unclaimed', name: '未领' },
        { id: 'claimed', name: '已领' },
      ],
    },
  }),
});
const claimedPhone = await call(`/sheets/${codeSheet.id}/fields`, {
  method: 'POST',
  token,
  body: JSON.stringify({ name: '领取手机号', type: 'phone' }),
});

let created = 0;
const createWorkers = Array.from({ length: 25 }, async () => {
  while (created < CODE_COUNT) {
    const index = created++;
    await call(`/sheets/${codeSheet.id}/records`, {
      method: 'POST',
      token,
      body: JSON.stringify({
        cells: {
          [serial.id]: `GATE-${String(index + 1).padStart(4, '0')}`,
          [status.id]: 'unclaimed',
        },
      }),
    });
  }
});
await Promise.all(createWorkers);

const form = await call(`/forms/${randomUUID()}`, {
  method: 'POST',
  token,
  body: JSON.stringify({
    baseId: base.id,
    sheetId: formSheet.id,
    name: '领码压测表单',
    fields: [{ fieldId: phone.id, required: true }],
    share: { enabled: true, audience: 'anyone' },
    successPage: { templateHtml: '序列号：{{序列号}}' },
  }),
});
await call('/automations', {
  method: 'POST',
  token,
  body: JSON.stringify({
    baseId: base.id,
    name: '压测占码',
    onFindEmpty: 'stop',
    trigger: {
      type: 'recordCreated',
      sheetId: formSheet.id,
      filters: {
        conjunction: 'and',
        conditions: [{ fieldId: phone.id, operator: 'isNotEmpty' }],
      },
    },
    steps: [
      {
        id: 'find-code',
        type: 'findRecords',
        sheetId: codeSheet.id,
        filters: {
          conjunction: 'and',
          conditions: [
            { fieldId: status.id, operator: 'equals', value: 'unclaimed' },
          ],
        },
      },
      {
        id: 'claim-code',
        type: 'modifyRecords',
        target: { mode: 'fromStep', stepId: 'find-code' },
        cells: {
          [status.id]: { kind: 'literal', value: 'claimed' },
          [claimedPhone.id]: {
            kind: 'variable',
            variable: { source: 'trigger', field: '手机号' },
          },
        },
      },
    ],
  }),
});

const startedAt = Date.now();
const responses = await Promise.all(
  Array.from({ length: CONCURRENCY }, async (_, index) => {
    const begin = Date.now();
    const response = await fetch(
      `${API}/public/forms/${form.share.token}/submit`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cells: { [phone.id]: `136${String(index).padStart(8, '0')}` },
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
    const body = await response.json();
    latencies.push(Date.now() - begin);
    return { status: response.status, body };
  }),
);
const elapsedMs = Date.now() - startedAt;

const successes = responses.filter((item) => item.status === 201);
const conflicts = responses.filter((item) => item.status === 409);
const other = responses.filter(
  (item) => item.status !== 201 && item.status !== 409,
);
const serials = successes.map(
  (item) => item.body.stepOutputs?.['序列号'] as string,
);
const unique = new Set(serials);

const claimedRows = [];
let cursor = null;
do {
  const page = await call(
    `/sheets/${codeSheet.id}/records?limit=500${cursor ? `&cursor=${cursor}` : ''}`,
    { token },
  );
  claimedRows.push(...page.records);
  cursor = page.nextCursor;
} while (cursor);
const claimed = claimedRows.filter(
  (row) => row.claimStatus === 'claimed',
);

const report = {
  codes: CODE_COUNT,
  concurrency: CONCURRENCY,
  success: successes.length,
  conflict: conflicts.length,
  otherStatuses: other.map((item) => item.status),
  uniqueSerials: unique.size,
  claimedRows: claimed.length,
  durationMs: elapsedMs,
  rps: Number((CONCURRENCY / (elapsedMs / 1000)).toFixed(1)),
  latencyMs: {
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: Math.max(...latencies),
  },
};

await mkdir('artifacts/perf', { recursive: true });
await writeFile(
  'artifacts/perf/claim-1000.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));

if (successes.length !== CODE_COUNT) throw new Error('success count mismatch');
if (conflicts.length !== CONCURRENCY - CODE_COUNT) {
  throw new Error('conflict count mismatch');
}
if (other.length) throw new Error(`other statuses: ${report.otherStatuses}`);
if (unique.size !== CODE_COUNT) throw new Error('duplicate serial claimed');
if (claimed.length !== CODE_COUNT) throw new Error('claimed row count mismatch');
