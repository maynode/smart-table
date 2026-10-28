/**
 * COLLAB-SCALE §4：单表 WebSocket 连接 + 持续 user_changes 压测。
 *
 * 前置：API :3000 已起（含 Redis/Postgres）。
 *
 * Usage:
 *   node scripts/perf/collab-scale-load.mjs
 *   PERF_COLLAB_CONNECTIONS=1000 PERF_COLLAB_WRITERS=20 PERF_COLLAB_DURATION_S=30 \
 *     PERF_COLLAB_TARGET_CPS=50 node scripts/perf/collab-scale-load.mjs
 *
 * 产出：artifacts/perf/collab-scale.json
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(import.meta.dirname, '../../apps/api/package.json'));
const WebSocket = require('ws');

const API = process.env.PERF_API ?? 'http://127.0.0.1:3000';
const WS_BASE = (process.env.PERF_WS ?? API).replace(/^http/, 'ws');
const CONNECTIONS = Number(process.env.PERF_COLLAB_CONNECTIONS ?? 100);
const WRITERS = Math.min(
  CONNECTIONS,
  Number(process.env.PERF_COLLAB_WRITERS ?? 10),
);
const DURATION_S = Number(process.env.PERF_COLLAB_DURATION_S ?? 20);
const TARGET_CPS = Number(process.env.PERF_COLLAB_TARGET_CPS ?? 50);

async function call(path, { token, ...init } = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ];
}

function openCollab(token, sheetId) {
  return new Promise((resolveWs, reject) => {
    const url = `${WS_BASE}/collab?token=${encodeURIComponent(token)}&sheetId=${encodeURIComponent(sheetId)}`;
    const ws = new WebSocket(url);
    let sheetRev = 0;
    const pending = new Map();
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('collab connect timeout'));
    }, 15_000);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === 'last_reversion') {
        sheetRev = msg.sheetRev ?? 0;
        clearTimeout(timer);
        resolveWs({
          ws,
          getRev: () => sheetRev,
          setRev: (r) => {
            sheetRev = r;
          },
          pending,
        });
        return;
      }
      if (msg.type === 'accept_commit') {
        sheetRev = msg.newRev ?? sheetRev;
        const wait = pending.get(msg.clientBatchId);
        if (wait) {
          pending.delete(msg.clientBatchId);
          wait.resolve({ ok: true, ms: Date.now() - wait.started, newRev: msg.newRev });
        }
        return;
      }
      if (msg.type === 'error') {
        if (typeof msg.sheetRev === 'number') sheetRev = msg.sheetRev;
        // Fail the oldest pending commit on this socket (serial writers).
        const first = pending.keys().next().value;
        if (first !== undefined) {
          const wait = pending.get(first);
          pending.delete(first);
          wait?.resolve({
            ok: false,
            ms: Date.now() - wait.started,
            code: msg.code,
          });
        }
      }
      if (msg.type === 'new_changes' && typeof msg.newRev === 'number') {
        sheetRev = Math.max(sheetRev, msg.newRev);
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'client_ready' }));
    });
  });
}

function commitOnce(client, { recordId, fieldId, value }) {
  const clientBatchId = randomUUID();
  const clientOpId = randomUUID();
  const started = Date.now();
  return new Promise((resolveCommit) => {
    const timer = setTimeout(() => {
      client.pending.delete(clientBatchId);
      resolveCommit({ ok: false, ms: Date.now() - started, code: 'TIMEOUT' });
    }, 10_000);
    client.pending.set(clientBatchId, {
      started,
      resolve: (r) => {
        clearTimeout(timer);
        resolveCommit(r);
      },
    });
    client.ws.send(
      JSON.stringify({
        type: 'user_changes',
        baseRev: client.getRev(),
        clientBatchId,
        mutations: [
          {
            type: 'setRecord',
            recordId,
            cells: { [fieldId]: value },
            clientOpId,
            baseVersion: 1,
          },
        ],
      }),
    );
  });
}

const stamp = Date.now();
const account = `cs${String(stamp).slice(-10)}`;
console.log(`register ${account} …`);
const owner = await call('/auth/register', {
  method: 'POST',
  body: JSON.stringify({
    account,
    password: 'Ab12_cd34',
    securityQuestion: '你小学就读的学校名称是？',
    securityAnswer: 'demo',
  }),
});
const token = owner.accessToken;
const workspace = await call('/workspaces', {
  method: 'POST',
  token,
  body: JSON.stringify({ name: `collab-scale-${stamp}` }),
});
const base = await call(`/workspaces/${workspace.id}/bases`, {
  method: 'POST',
  token,
  body: JSON.stringify({ name: 'scale-base' }),
});
const sheets = await call(`/bases/${base.id}/sheets`, { token });
const sheet = sheets[0];
const field = await call(`/sheets/${sheet.id}/fields`, {
  method: 'POST',
  token,
  body: JSON.stringify({ name: '压测列', type: 'text' }),
});
const record = await call(`/sheets/${sheet.id}/records`, {
  method: 'POST',
  token,
  body: JSON.stringify({ cells: { [field.id]: 'init' } }),
});

console.log(`opening ${CONNECTIONS} WS to sheet ${sheet.id} …`);
const clients = [];
const connectErrors = [];
const batch = 50;
for (let i = 0; i < CONNECTIONS; i += batch) {
  const slice = Array.from(
    { length: Math.min(batch, CONNECTIONS - i) },
    () =>
      openCollab(token, sheet.id).catch((err) => {
        connectErrors.push(String(err));
        return null;
      }),
  );
  const opened = await Promise.all(slice);
  for (const c of opened) if (c) clients.push(c);
  process.stdout.write(`\r  connected ${clients.length}/${CONNECTIONS}`);
}
process.stdout.write('\n');

const writers = clients.slice(0, WRITERS);
const acceptLatencies = [];
let accepts = 0;
let conflicts = 0;
let timeouts = 0;
let otherErrors = 0;

const intervalMs = Math.max(1, Math.floor(1000 / Math.max(1, TARGET_CPS)));
const deadline = Date.now() + DURATION_S * 1000;
let writeIdx = 0;
console.log(
  `writing ~${TARGET_CPS} commits/s for ${DURATION_S}s with ${writers.length} writers …`,
);

while (Date.now() < deadline && writers.length > 0) {
  const client = writers[writeIdx % writers.length];
  writeIdx += 1;
  const tickStart = Date.now();
  const result = await commitOnce(client, {
    recordId: record.id,
    fieldId: field.id,
    value: `v-${writeIdx}-${Date.now()}`,
  });
  acceptLatencies.push(result.ms);
  if (result.ok) accepts += 1;
  else if (result.code === 'TIMEOUT') timeouts += 1;
  else if (
    String(result.code ?? '').includes('CONFLICT') ||
    String(result.code ?? '') === 'COMMIT_VERSION_CONFLICT'
  ) {
    conflicts += 1;
  } else otherErrors += 1;
  const spent = Date.now() - tickStart;
  if (spent < intervalMs) {
    await new Promise((r) => setTimeout(r, intervalMs - spent));
  }
}

for (const c of clients) {
  try {
    c.ws.close();
  } catch {
    /* ignore */
  }
}

const elapsedS = DURATION_S;
const cps = accepts / elapsedS;
const report = {
  at: new Date().toISOString(),
  api: API,
  connectionsRequested: CONNECTIONS,
  connectionsOpened: clients.length,
  connectErrors: connectErrors.slice(0, 5),
  writers: writers.length,
  durationS: DURATION_S,
  targetCommitsPerSec: TARGET_CPS,
  accepts,
  conflicts,
  timeouts,
  otherErrors,
  commitsPerSec: Number(cps.toFixed(2)),
  acceptLatencyMs: {
    p50: percentile(acceptLatencies, 50),
    p95: percentile(acceptLatencies, 95),
    p99: percentile(acceptLatencies, 99),
    max: acceptLatencies.length ? Math.max(...acceptLatencies) : null,
  },
  sheetId: sheet.id,
  thresholds: {
    connections: 1000,
    commitsPerSec: 50,
  },
  pass: {
    connections:
      clients.length >= Math.min(CONNECTIONS, 1000) ||
      (CONNECTIONS < 1000 && clients.length === CONNECTIONS),
    commitsPerSec: cps >= Math.min(TARGET_CPS * 0.8, 50) || CONNECTIONS < 1000,
  },
};

await mkdir('artifacts/perf', { recursive: true });
const out = 'artifacts/perf/collab-scale.json';
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`wrote ${out}`);

if (clients.length < CONNECTIONS * 0.95) {
  console.error('FAIL: too many connect failures');
  process.exit(1);
}
if (accepts === 0) {
  console.error('FAIL: zero accepts');
  process.exit(1);
}
