import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:3000';
const webUrl = process.env.WEB_URL ?? 'http://127.0.0.1:8080';
const repoRoot = resolve(import.meta.dirname, '..');

const requiredDocs = [
  'docs/DEPLOYMENT.md',
  'docs/PRD.md',
  'docs/DATA_MODEL.md',
  'docs/AUTOMATION.md',
  'docs/FORM_SUCCESS_PAGE.md',
  'docs/TEMPLATES.md',
];

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`✓ ${message}`);
}

for (const doc of requiredDocs) {
  const path = resolve(repoRoot, doc);
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    fail(`缺少文档 ${doc}`);
  }
  if (size < 500) fail(`文档过短（${size} bytes）: ${doc}`);
}
ok('文档包齐套');

async function http(path, options = {}) {
  const { headers: extraHeaders, ...rest } = options;
  const response = await fetch(`${apiUrl}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(extraHeaders ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const health = await http('/health');
if (health.status !== 200) fail(`API 健康检查失败: ${health.status}`);
ok('API 健康');

const web = await fetch(webUrl);
if (!web.ok) fail(`Web 不可达: ${web.status}`);
ok('Web 可达');

const stamp = Date.now();
const email = `smoke-${stamp}@example.com`;
const register = await http('/auth/register', {
  method: 'POST',
  body: JSON.stringify({ email, password: 'Passw0rd!123', name: '冒烟测试' }),
});
if (register.status !== 201) fail(`注册失败: ${register.status} ${JSON.stringify(register.body)}`);
const token = register.body.accessToken;
const auth = { Authorization: `Bearer ${token}` };

const workspace = await http('/workspaces', {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ name: `冒烟工作区 ${stamp}` }),
});
const base = await http(`/workspaces/${workspace.body.id}/bases`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ name: '冒烟 Base' }),
});
const formSheet = await http(`/bases/${base.body.id}/sheets`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ name: '收集表单' }),
});
const codeSheet = await http(`/bases/${base.body.id}/sheets`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ name: '码库' }),
});

const phoneField = await http(`/sheets/${formSheet.body.id}/fields`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ name: '手机号', type: 'phone', required: true }),
});
const serialField = await http(`/sheets/${codeSheet.body.id}/fields`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ name: '序列号', type: 'text' }),
});
const statusField = await http(`/sheets/${codeSheet.body.id}/fields`, {
  method: 'POST',
  headers: auth,
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
const claimedPhoneField = await http(`/sheets/${codeSheet.body.id}/fields`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ name: '领取手机号', type: 'phone' }),
});
const claimedAtField = await http(`/sheets/${codeSheet.body.id}/fields`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ name: '领取时间', type: 'date' }),
});

for (const serial of ['SMOKE-001', 'SMOKE-002']) {
  await http(`/sheets/${codeSheet.body.id}/records`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      cells: { [serialField.body.id]: serial, [statusField.body.id]: 'unclaimed' },
    }),
  });
}

const formId = randomUUID();
const form = await http(`/forms/${formId}`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({
    baseId: base.body.id,
    sheetId: formSheet.body.id,
    name: '冒烟领取',
    fields: [{ fieldId: phoneField.body.id, required: true }],
    share: { enabled: true, audience: 'anyone' },
    successPage: { templateHtml: '领取成功：{{序列号}}' },
  }),
});
if (form.status !== 201) fail(`建表单失败: ${form.status} ${JSON.stringify(form.body)}`);

const automation = await http('/automations', {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({
    baseId: base.body.id,
    name: '冒烟占码',
    onFindEmpty: 'stop',
    trigger: {
      type: 'recordCreated',
      sheetId: formSheet.body.id,
      filters: {
        conjunction: 'and',
        conditions: [{ fieldId: phoneField.body.id, operator: 'isNotEmpty' }],
      },
    },
    steps: [
      {
        id: 'find-code',
        type: 'findRecords',
        sheetId: codeSheet.body.id,
        filters: {
          conjunction: 'and',
          conditions: [
            { fieldId: statusField.body.id, operator: 'equals', value: 'unclaimed' },
          ],
        },
      },
      {
        id: 'claim-code',
        type: 'modifyRecords',
        target: { mode: 'fromStep', stepId: 'find-code' },
        cells: {
          [statusField.body.id]: { kind: 'literal', value: 'claimed' },
          [claimedPhoneField.body.id]: {
            kind: 'variable',
            variable: { source: 'trigger', field: '手机号' },
          },
          [claimedAtField.body.id]: {
            kind: 'variable',
            variable: { source: 'naturalTime', naturalTime: 'today' },
          },
        },
      },
    ],
  }),
});
if (automation.status !== 201) fail(`建自动化失败: ${automation.status} ${JSON.stringify(automation.body)}`);

const submit = await http(
  `/public/forms/${form.body.share.token}/submit`,
  {
    method: 'POST',
    body: JSON.stringify({
      cells: { [phoneField.body.id]: '13800000000' },
    }),
  },
);
if (submit.status !== 201) fail(`公开提交失败: ${submit.status} ${JSON.stringify(submit.body)}`);
if (!/SMOKE-001/.test(submit.body.success.html)) {
  fail(`成功页未包含序列号: ${submit.body.success.html}`);
}
ok('公开提交 → 成功页含序列号');

const runs = await http(`/automations/${automation.body.id}/runs`, {
  headers: auth,
});
if (runs.status !== 200 || runs.body[0]?.status !== 'success') {
  fail(`自动化运行未成功: ${JSON.stringify(runs.body)}`);
}
ok('自动化运行成功日志');

console.log('\n冒烟通过：部署可完成一次真实领取。');
