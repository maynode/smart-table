/**
 * COLLAB-SCALE §4：双副本 Redis 扇出实跑。
 *
 * 前置：两台 API（默认 :3000 / :3001）共享同一 REDIS_URL + DATABASE_URL；
 *       CollabFanout 已 ready（日志含 "CollabFanout Redis pub/sub ready"）。
 *
 *   API_PORT=3000 pnpm --filter api start:dev
 *   API_PORT=3001 pnpm --filter api start   # 或第二份 dist
 *
 * Usage:
 *   node scripts/perf/collab-dual-replica.mjs
 *   PERF_API_A=http://127.0.0.1:3000 PERF_API_B=http://127.0.0.1:3001 \
 *     node scripts/perf/collab-dual-replica.mjs
 *
 * 产出：artifacts/perf/collab-dual-replica.json
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(import.meta.dirname, '../../apps/api/package.json'));
const WebSocket = require('ws');

const API_A = process.env.PERF_API_A ?? 'http://127.0.0.1:3000';
const API_B = process.env.PERF_API_B ?? 'http://127.0.0.1:3001';
const WS_A = API_A.replace(/^http/, 'ws');
const WS_B = API_B.replace(/^http/, 'ws');
const TIMEOUT_MS = Number(process.env.PERF_DUAL_TIMEOUT_MS ?? 8_000);

async function call(api, path, { token, ...init } = {}) {
  const response = await fetch(`${api}${path}`, {
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
    throw new Error(`${api}${path} -> ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function assertReady(api, label) {
  const ready = await call(api, '/ready');
  if (ready.status !== 'ok' || !ready.db) {
    throw new Error(`${label} not ready: ${JSON.stringify(ready)}`);
  }
  if (!ready.redis) {
    throw new Error(
      `${label} redis=false — CollabFanout will stay memory-only; fix REDIS_URL / waitForRedisReady`,
    );
  }
  return ready;
}

function openCollab(wsBase, token, sheetId) {
  return new Promise((resolveWs, reject) => {
    const url = `${wsBase}/collab?token=${encodeURIComponent(token)}&sheetId=${encodeURIComponent(sheetId)}`;
    const ws = new WebSocket(url);
    let sheetRev = 0;
    const pending = new Map();
    const remoteChanges = [];
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
          remoteChanges,
        });
        return;
      }
      if (msg.type === 'accept_commit') {
        sheetRev = msg.newRev ?? sheetRev;
        const wait = pending.get(msg.clientBatchId);
        if (wait) {
          pending.delete(msg.clientBatchId);
          wait.resolve({ ok: true, newRev: msg.newRev, ms: Date.now() - wait.started });
        }
        return;
      }
      if (msg.type === 'error') {
        if (typeof msg.sheetRev === 'number') sheetRev = msg.sheetRev;
        const first = pending.keys().next().value;
        if (first !== undefined) {
          const wait = pending.get(first);
          pending.delete(first);
          wait?.resolve({ ok: false, code: msg.code, ms: Date.now() - wait.started });
        }
        return;
      }
      if (msg.type === 'new_changes') {
        if (typeof msg.newRev === 'number') sheetRev = Math.max(sheetRev, msg.newRev);
        remoteChanges.push(msg);
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
  const started = Date.now();
  return new Promise((resolveCommit) => {
    const timer = setTimeout(() => {
      client.pending.delete(clientBatchId);
      resolveCommit({ ok: false, code: 'TIMEOUT', ms: Date.now() - started });
    }, TIMEOUT_MS);
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
            clientOpId: randomUUID(),
            baseVersion: 1,
          },
        ],
      }),
    );
  });
}

function waitForRemote(client, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveWait) => {
    const tick = () => {
      const hit = client.remoteChanges.find(predicate);
      if (hit) {
        resolveWait({ ok: true, msg: hit, ms: timeoutMs - (deadline - Date.now()) });
        return;
      }
      if (Date.now() >= deadline) {
        resolveWait({ ok: false, msg: null, ms: timeoutMs });
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

const stamp = Date.now();
console.log(`dual-replica: A=${API_A} B=${API_B}`);
await assertReady(API_A, 'API_A');
await assertReady(API_B, 'API_B');

const account = `dual${String(stamp).slice(-10)}`;
const owner = await call(API_A, '/auth/register', {
  method: 'POST',
  body: JSON.stringify({
    account,
    password: 'Ab12_cd34',
    securityQuestion: '你小学就读的学校名称是？',
    securityAnswer: 'demo',
  }),
});
const token = owner.accessToken;
const workspace = await call(API_A, '/workspaces', {
  method: 'POST',
  token,
  body: JSON.stringify({ name: `dual-replica-${stamp}` }),
});
const base = await call(API_A, `/workspaces/${workspace.id}/bases`, {
  method: 'POST',
  token,
  body: JSON.stringify({ name: 'dual-base' }),
});
const sheets = await call(API_A, `/bases/${base.id}/sheets`, { token });
const sheet = sheets[0];
const field = await call(API_A, `/sheets/${sheet.id}/fields`, {
  method: 'POST',
  token,
  body: JSON.stringify({ name: '双副本列', type: 'text' }),
});
const row = await call(API_A, `/sheets/${sheet.id}/records`, {
  method: 'POST',
  token,
  body: JSON.stringify({ cells: { [field.id]: 'init' } }),
});

const writer = await openCollab(WS_A, token, sheet.id);
const reader = await openCollab(WS_B, token, sheet.id);
reader.remoteChanges.length = 0;

const marker = `cross-pod-${stamp}`;
const accept = await commitOnce(writer, {
  recordId: row.id,
  fieldId: field.id,
  value: marker,
});
if (!accept.ok) {
  throw new Error(`writer accept failed: ${JSON.stringify(accept)}`);
}

const delivered = await waitForRemote(
  reader,
  (m) =>
    m.type === 'new_changes' &&
    Array.isArray(m.mutations) &&
    JSON.stringify(m.mutations).includes(marker),
  TIMEOUT_MS,
);

writer.ws.close();
reader.ws.close();

const report = {
  at: new Date().toISOString(),
  apiA: API_A,
  apiB: API_B,
  sheetId: sheet.id,
  acceptOk: accept.ok,
  acceptMs: accept.ms,
  newRev: accept.newRev,
  fanoutOk: delivered.ok,
  fanoutMs: delivered.ms,
  remoteNewRev: delivered.msg?.newRev ?? null,
  pass: Boolean(accept.ok && delivered.ok),
};

await mkdir(resolve(import.meta.dirname, '../../artifacts/perf'), {
  recursive: true,
});
const out = resolve(
  import.meta.dirname,
  '../../artifacts/perf/collab-dual-replica.json',
);
await writeFile(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`wrote ${out}`);
if (!report.pass) {
  process.exitCode = 1;
  console.error('FAIL: peer on API_B did not receive new_changes via Redis fanout');
} else {
  console.log('PASS: cross-replica new_changes delivered');
}
