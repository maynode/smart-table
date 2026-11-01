/**
 * Demo: multi-turn LLM chat → generate → publish complex aiComponents.
 * Writes summary JSON under .data/ai-component-demo/
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_URL || 'http://127.0.0.1:3000';
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../.data/ai-component-demo',
);

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${path} → ${res.status}: ${typeof json === 'object' ? JSON.stringify(json) : text}`,
    );
  }
  return json;
}

const DEMOS = [
  {
    key: 'sla',
    fieldName: 'SLA进度',
    turns: [
      '做一个「工单 SLA」格内组件：显示剩余小时倒计时进度条；可点「延期 +4h」把 deadline 往后推；单元格值结构 { deadline: ISO字符串, hoursTotal: number }。要根据 deadline 与现在时间算剩余比例，超时变红。需要能按剩余小时排序、筛选超时、导出显示「剩余Xh」或「已超时」。',
      '补充：进度条要显示百分比文字；延期按钮要二次确认（点一次变「确认？」，再点才写入）。不要弹窗，格内完成。',
    ],
  },
  {
    key: 'approval',
    fieldName: '审批意见',
    turns: [
      '做一个审批组件：三个状态按钮「通过 / 驳回 / 待定」，选中高亮；下方多行备注（最多 80 字）；值 { status: "approved"|"rejected"|"pending", note: string, at?: ISO }。点状态立即 setCell；备注失焦才写入。要能按 status 筛选排序，导出「通过：备注」这种格式。',
      '再加：若选驳回且备注为空，备注框边框变红并提示「驳回请填写原因」，不允许清空 status。',
    ],
  },
  {
    key: 'checklist',
    fieldName: '交付清单',
    turns: [
      '做一个可勾选的交付清单组件：预设 4 项「需求确认 / 设计稿 / 联调 / 上线」；值 { items: [{ id, label, done: boolean }] }。顶部显示完成数「2/4」；全部完成时标题变绿。要点击切换 done 并 setCell。按完成数排序，导出「已完成 n/m」。',
      '允许点「+」临时加一项自定义文案（最多 6 项）；自定义项可点 × 删除。预置项不能删。',
    ],
  },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const stamp = Date.now();
  const account = `aidemo${String(stamp).slice(-6)}`;
  const password = 'Ab12_cd34';

  console.log('register', account);
  const session = await api('/auth/register', {
    method: 'POST',
    body: {
      account,
      password,
      securityQuestion: '你小学就读的学校名称是？',
      securityAnswer: 'demo',
    },
  });
  const token = session.accessToken;
  const headersToken = token;

  const workspace = await api('/workspaces', {
    method: 'POST',
    token,
    body: { name: '智能组件演示' },
  });
  const base = await api(`/workspaces/${workspace.id}/bases`, {
    method: 'POST',
    token,
    body: { name: '复杂组件验收' },
  });
  const sheet = await api(`/bases/${base.id}/sheets`, {
    method: 'POST',
    token,
    body: { name: '业务演示表', seed: false },
  });

  const titleField = await api(`/sheets/${sheet.id}/fields`, {
    method: 'POST',
    token,
    body: { name: '事项', type: 'text' },
  });
  const ownerField = await api(`/sheets/${sheet.id}/fields`, {
    method: 'POST',
    token,
    body: { name: '负责人', type: 'text' },
  });

  const results = [];

  for (const demo of DEMOS) {
    console.log('\n===', demo.fieldName, '===');
    const field = await api(`/sheets/${sheet.id}/fields`, {
      method: 'POST',
      token,
      body: {
        name: demo.fieldName,
        type: 'aiComponent',
        options: { aiComponent: { status: 'draft' } },
      },
    });

    const chatLog = [];
    for (const [i, text] of demo.turns.entries()) {
      console.log(`chat turn ${i + 1}…`);
      const chat = await api(`/fields/${field.id}/ai-component/chat`, {
        method: 'POST',
        token,
        body: { text },
      });
      chatLog.push({
        user: text,
        assistant: chat.reply,
        llmConfigured: chat.llmConfigured,
      });
      console.log(
        '  llmConfigured=',
        chat.llmConfigured,
        'reply chars=',
        String(chat.reply || '').length,
      );
      console.log('  reply preview:', String(chat.reply || '').slice(0, 180).replace(/\n/g, ' '));
    }

    console.log('generate…');
    const generated = await api(`/fields/${field.id}/ai-component/generate`, {
      method: 'POST',
      token,
      body: {},
    });
    console.log(
      '  source=',
      generated.source,
      'bundleBytes=',
      generated.bundleBytes,
      'hint=',
      generated.previewHint,
    );

    console.log('publish…');
    const published = await api(`/fields/${field.id}/ai-component/publish`, {
      method: 'POST',
      token,
      body: {},
    });

    const bundlePath = resolve(OUT, `${demo.key}-bundle.json`);
    writeFileSync(
      bundlePath,
      JSON.stringify(
        {
          fieldId: field.id,
          fieldName: demo.fieldName,
          chatLog,
          source: generated.source,
          previewHint: generated.previewHint,
          gridContract: published.gridContract,
          valueSchema: generated.valueSchema,
          bridgeManifest: published.bridgeManifest,
          bundle: published.bundle,
        },
        null,
        2,
      ),
      'utf8',
    );

    results.push({
      key: demo.key,
      fieldId: field.id,
      fieldName: demo.fieldName,
      source: generated.source,
      version: published.version,
      gridContract: published.gridContract,
      htmlLen: published.bundle?.html?.length ?? 0,
      jsLen: published.bundle?.js?.length ?? 0,
      cssLen: published.bundle?.css?.length ?? 0,
      chatAssistantLens: chatLog.map((c) => c.assistant?.length ?? 0),
      llmConfigured: chatLog[0]?.llmConfigured,
      bundleFile: bundlePath,
    });
  }

  // Seed sample rows with plausible cell values
  const now = Date.now();
  const samples = [
    {
      title: '客户门户改版',
      owner: '张三',
      cells: {
        [results[0].fieldId]: {
          deadline: new Date(now + 6 * 3600_000).toISOString(),
          hoursTotal: 24,
        },
        [results[1].fieldId]: { status: 'pending', note: '' },
        [results[2].fieldId]: {
          items: [
            { id: 'req', label: '需求确认', done: true },
            { id: 'design', label: '设计稿', done: true },
            { id: 'qa', label: '联调', done: false },
            { id: 'ship', label: '上线', done: false },
          ],
        },
      },
    },
    {
      title: '支付对账异常',
      owner: '李四',
      cells: {
        [results[0].fieldId]: {
          deadline: new Date(now - 2 * 3600_000).toISOString(),
          hoursTotal: 8,
        },
        [results[1].fieldId]: {
          status: 'rejected',
          note: '缺流水凭证',
          at: new Date().toISOString(),
        },
        [results[2].fieldId]: {
          items: [
            { id: 'req', label: '需求确认', done: true },
            { id: 'design', label: '设计稿', done: true },
            { id: 'qa', label: '联调', done: true },
            { id: 'ship', label: '上线', done: true },
          ],
        },
      },
    },
    {
      title: '移动端适配',
      owner: '王五',
      cells: {
        [results[0].fieldId]: {
          deadline: new Date(now + 48 * 3600_000).toISOString(),
          hoursTotal: 72,
        },
        [results[1].fieldId]: {
          status: 'approved',
          note: '可合入',
          at: new Date().toISOString(),
        },
        [results[2].fieldId]: {
          items: [
            { id: 'req', label: '需求确认', done: true },
            { id: 'design', label: '设计稿', done: false },
            { id: 'qa', label: '联调', done: false },
            { id: 'ship', label: '上线', done: false },
          ],
        },
      },
    },
  ];

  for (const row of samples) {
    await api(`/sheets/${sheet.id}/records`, {
      method: 'POST',
      token,
      body: {
        cells: {
          [titleField.id]: row.title,
          [ownerField.id]: row.owner,
          ...row.cells,
        },
      },
    });
  }

  const summary = {
    createdAt: new Date().toISOString(),
    account,
    password,
    token,
    workspaceId: workspace.id,
    baseId: base.id,
    sheetId: sheet.id,
    openUrl: `http://127.0.0.1:5173/workspaces/${workspace.id}/bases/${base.id}?face=data&oid=${sheet.id}`,
    results,
  };
  writeFileSync(resolve(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('\nDONE');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
