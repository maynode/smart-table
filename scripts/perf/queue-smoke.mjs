/**
 * Queue-mode smoke against a running API + claim-worker.
 * Requires API/worker env SUBMIT_MODE=queue. Creates a form and polls the
 * submitted job until the worker completes it.
 *
 * Usage: node scripts/perf/queue-smoke.mjs
 */
import { randomUUID } from 'node:crypto';

const API = process.env.PERF_API ?? 'http://127.0.0.1:3000';

async function json(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
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
    email: `queue-${stamp}@example.com`,
    password: 'Passw0rd!123',
    name: '队列冒烟',
  }),
});
const headers = { Authorization: `Bearer ${session.accessToken}` };
const workspace = await json('/workspaces', {
  method: 'POST',
  headers,
  body: JSON.stringify({ name: `队列工作区${stamp}` }),
});
const base = await json(`/workspaces/${workspace.id}/bases`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ name: '队列 Base' }),
});
const sheet = await json(`/bases/${base.id}/sheets`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ name: '队列表', seed: false }),
});
const field = await json(`/sheets/${sheet.id}/fields`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ name: '手机号', type: 'phone' }),
});
const form = await json(`/forms/${randomUUID()}`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    baseId: base.id,
    sheetId: sheet.id,
    name: '队列表单',
    fields: [{ fieldId: field.id, required: true }],
    share: { enabled: true, audience: 'anyone' },
    successPage: { templateHtml: '队列成功 {{手机号}}' },
  }),
});

const response = await fetch(
  `${API}/public/forms/${form.share.token}/submit`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cells: { [field.id]: '13900000001' } }),
  },
);
const submitted = await response.json();
if (response.status !== 202) {
  throw new Error(`expected 202, got ${response.status}: ${JSON.stringify(submitted)}`);
}

const pollUrl = submitted.pollUrl ?? `/public/forms/${form.share.token}/submissions/${submitted.submissionId}`;
let status = submitted;
const deadline = Date.now() + 20_000;
while (Date.now() < deadline) {
  if (status.status === 'completed') break;
  if (status.status === 'failed') {
    throw new Error(`queued job failed: ${JSON.stringify(status)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  const poll = await fetch(`${API}${pollUrl}`);
  status = await poll.json();
}
if (status.status !== 'completed') {
  throw new Error(`queue job did not complete: ${JSON.stringify(status)}`);
}
if (!String(status.success?.html ?? '').includes('队列成功')) {
  throw new Error(`success page missing: ${JSON.stringify(status.success)}`);
}

console.log(
  JSON.stringify(
    {
      queue: 'completed',
      submissionId: submitted.submissionId,
      pollUrl,
      successHtml: status.success.html,
    },
    null,
    2,
  ),
);
