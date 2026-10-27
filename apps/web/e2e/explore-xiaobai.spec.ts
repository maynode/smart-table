/**
 * 小白多账号逐页探索：owner / editor / viewer + 公开页。
 * 目标不是断言业务正确性穷尽，而是铺开页面/入口并截图，抓白屏、报错、权限泄漏。
 *
 * 截图：test-results/explore-xiaobai/
 * 报告：同目录 report.json（fixture 收工时写）
 */
import { expect, test, request as apiRequest, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = 'http://127.0.0.1:3000';
const password = 'Ab12_cd34';
const OUT = join(process.cwd(), 'test-results', 'explore-xiaobai');

type Finding = {
  role: string;
  step: string;
  note: string;
  severity?: 'info' | 'warn' | 'error';
  url?: string;
  shot?: string;
};

const findings: Finding[] = [];
let shotSeq = 0;

async function api(
  ctx: Awaited<ReturnType<typeof apiRequest.newContext>>,
  path: string,
  opts: { method?: string; token?: string; data?: unknown } = {},
) {
  const res = await ctx.fetch(path, {
    method: opts.method ?? (opts.data ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    data: opts.data,
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok()) {
    throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()}: ${text.slice(0, 400)}`);
  }
  return body;
}

async function shot(page: Page, role: string, step: string, note: string) {
  shotSeq += 1;
  const file = join(OUT, `${String(shotSeq).padStart(3, '0')}-${role}-${step}.png`);
  await page.screenshot({ path: file, fullPage: false });
  findings.push({ role, step, note, severity: 'info', url: page.url(), shot: file });
}

function note(
  role: string,
  step: string,
  message: string,
  severity: Finding['severity'] = 'warn',
  url?: string,
) {
  findings.push({ role, step, note: message, severity, url });
}

async function bindAuth(page: Page, token: string, user: unknown) {
  await page.addInitScript(
    ({ t, u }) => {
      localStorage.setItem('st.token', t);
      localStorage.setItem('st.user', JSON.stringify(u));
    },
    { t: token, u: user },
  );
}

async function attachErrorHooks(page: Page, role: string) {
  const seen = new Set<string>();
  page.on('pageerror', (err) => {
    const text = String(err);
    const key = `${role}:pageerror:${text.slice(0, 160)}`;
    if (seen.has(key)) return;
    seen.add(key);
    note(role, 'pageerror', text, 'error', page.url());
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // 忽略常见噪音
      if (/ResizeObserver|favicon|Download the Vue Devtools/i.test(text)) return;
      const key = `${role}:console:${text.slice(0, 160)}`;
      if (seen.has(key)) return;
      seen.add(key);
      note(role, 'console-error', text.slice(0, 500), 'warn', page.url());
    }
  });
}

async function dismissOverlays(page: Page, role: string) {
  for (let i = 0; i < 3; i += 1) {
    const dialog = page.locator('[data-testid="app-dialog"]');
    if ((await dialog.count()) === 0 || !(await dialog.isVisible().catch(() => false))) {
      break;
    }
    if (i === 0) {
      note(role, 'stuck-dialog', '发现未关闭的 app-dialog 遮罩', 'warn', page.url());
      await shot(page, role, `dialog-${Date.now().toString().slice(-4)}`, '卡住的对话框');
    }
    await page.keyboard.press('Escape').catch(() => undefined);
    await page
      .locator(
        '[data-testid="app-dialog-cancel"], [data-testid="app-dialog-confirm"], [data-testid="app-dialog"] button:has-text("取消"), [data-testid="app-dialog"] button:has-text("关闭"), [data-testid="app-dialog"] [aria-label="关闭"]',
      )
      .first()
      .click({ timeout: 1_500 })
      .catch(() => undefined);
    await page.waitForTimeout(200);
  }
}

async function clickFirst(page: Page, selectors: string[], label: string, role: string) {
  await dismissOverlays(page, role);
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    try {
      await loc.click({ timeout: 5_000 });
      return true;
    } catch {
      await dismissOverlays(page, role);
      await loc.click({ timeout: 5_000, force: true }).catch(() => undefined);
      return true;
    }
  }
  note(role, `missing-${label}`, `入口未找到: ${label}`, 'warn', page.url());
  return false;
}

test.describe.configure({ mode: 'serial' });

test('explore page-by-page with owner/editor/viewer', async ({ browser }) => {
  test.setTimeout(600_000);
  await mkdir(OUT, { recursive: true });
  const stamp = Date.now();
  const ctx = await apiRequest.newContext({ baseURL: API });

  const ownerAccount = `xbown${String(stamp).slice(-8)}`;
  const editorAccount = `xbedt${String(stamp).slice(-8)}`;
  const viewerAccount = `xbviw${String(stamp).slice(-8)}`;

  const owner = await api(ctx, '/auth/register', {
    data: {
      account: ownerAccount,
      password,
      securityQuestion: '你小学就读的学校名称是？',
      securityAnswer: 'demo',
    },
  });
  const editor = await api(ctx, '/auth/register', {
    data: {
      account: editorAccount,
      password,
      securityQuestion: '你小学就读的学校名称是？',
      securityAnswer: 'demo',
    },
  });
  const viewer = await api(ctx, '/auth/register', {
    data: {
      account: viewerAccount,
      password,
      securityQuestion: '你小学就读的学校名称是？',
      securityAnswer: 'demo',
    },
  });

  const token = owner.accessToken as string;
  const workspace = await api(ctx, '/workspaces', {
    token,
    data: { name: `探索工作区${stamp}` },
  });
  await api(ctx, `/workspaces/${workspace.id}/members`, {
    token,
    data: { account: editorAccount, role: 'editor' },
  });
  await api(ctx, `/workspaces/${workspace.id}/members`, {
    token,
    data: { account: viewerAccount, role: 'viewer' },
  });

  const base = await api(ctx, `/workspaces/${workspace.id}/bases`, {
    token,
    data: { name: '探索 Base' },
  });
  const sheet = await api(ctx, `/bases/${base.id}/sheets`, {
    token,
    data: { name: '主数据表', seed: true },
  });
  const textField = await api(ctx, `/sheets/${sheet.id}/fields`, {
    token,
    data: { name: '标题', type: 'text' },
  });
  await api(ctx, `/sheets/${sheet.id}/fields`, {
    token,
    data: {
      name: '状态',
      type: 'select',
      options: {
        choices: [
          { id: 'todo', name: '待办', color: '#94a3b8' },
          { id: 'doing', name: '进行中', color: '#3b82f6' },
          { id: 'done', name: '完成', color: '#22c55e' },
        ],
      },
    },
  });
  await api(ctx, `/sheets/${sheet.id}/fields`, {
    token,
    data: { name: '数量', type: 'number' },
  });

  // 填几行，方便网格可见
  for (let i = 1; i <= 5; i += 1) {
    await api(ctx, `/sheets/${sheet.id}/records`, {
      token,
      data: {
        cells: {
          [textField.id]: `样例行 ${i}`,
        },
      },
    });
  }

  // 产品模型：收集表是独立 sheet（名含「收集表单」），由前端打开 FormBuilder
  const formSheet = await api(ctx, `/bases/${base.id}/sheets`, {
    token,
    data: { name: '收集表单', seed: false },
  });
  const formNameField = await api(ctx, `/sheets/${formSheet.id}/fields`, {
    token,
    data: { name: '姓名', type: 'text', required: true },
  });
  await api(ctx, `/sheets/${formSheet.id}/fields`, {
    token,
    data: { name: '手机号', type: 'phone' },
  });

  const dashboard = await api(ctx, `/bases/${base.id}/dashboards`, {
    token,
    data: { name: '看板A', kind: 'dashboard' },
  });
  await api(ctx, `/bases/${base.id}/analysis-reports`, {
    token,
    data: { name: '分析报告A' },
  }).catch(() => undefined);

  // —— 未登录页 ——
  {
    const guest = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await guest.newPage();
    await attachErrorHooks(page, 'guest');
    await page.goto('/login');
    await page.waitForTimeout(400);
    await shot(page, 'guest', 'login', '登录页');
    if (await page.getByRole('button', { name: '注册' }).count()) {
      await page.getByRole('button', { name: '注册' }).click();
      await page.waitForTimeout(300);
      await shot(page, 'guest', 'register-tab', '注册页');
    }
    if (await page.getByRole('button', { name: '忘记密码？' }).count()) {
      await page.getByRole('button', { name: '忘记密码？' }).click();
      await page.waitForTimeout(400);
      await shot(page, 'guest', 'forgot-password', '忘记密码');
    }
    await guest.close();
  }

  // —— Owner 逐页 ——
  {
    const role = 'owner';
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await attachErrorHooks(page, role);
    await bindAuth(page, token, owner.user);

    await page.goto('/');
    await page.waitForTimeout(800);
    await shot(page, role, 'home', '首页工作区 Hub');

    // 用户菜单
    if (await clickFirst(page, ['[data-testid="avatar-open"]'], 'avatar', role)) {
      await page.waitForTimeout(300);
      await shot(page, role, 'user-menu', '用户菜单');
      await page.keyboard.press('Escape');
    }

    // 成员
    if (await clickFirst(page, ['[data-testid="hub-members"]', 'button:has-text("成员")'], 'members', role)) {
      await page.waitForTimeout(500);
      await shot(page, role, 'hub-members', '工作区成员');
      await page.keyboard.press('Escape');
    }

    // 从模板新建入口
    if (await clickFirst(page, ['[data-testid="hub-template"]', 'button:has-text("从模板新建")'], 'template', role)) {
      await page.waitForTimeout(600);
      await shot(page, role, 'template-panel', '模板新建');
      await page.keyboard.press('Escape');
    }

    const baseUrl = `/workspaces/${workspace.id}/bases/${base.id}`;
    // 打开 Base
    await page.goto(`${baseUrl}?sheet=${sheet.id}`);
    await page.waitForSelector('.canvas-grid-wrap, [data-testid="canvas-grid"], [data-testid="more-open"]', {
      timeout: 20_000,
    });
    await page.waitForTimeout(800);
    await shot(page, role, 'base-grid', 'Base 网格主视图');

    // 侧栏：新建表 / 收集表 / 仪表盘 / 自动化 / 分析报告 / 更多
    const ownerProbes: Array<{ step: string; sels: string[]; label: string }> = [
      { step: 'forms-open', sels: ['[data-testid="forms-open"]', 'button:has-text("收集表")'], label: '收集表' },
      {
        step: 'automation-open',
        sels: ['[data-testid="automation-open"]', 'button:has-text("自动化")'],
        label: '自动化',
      },
      {
        step: 'dashboard-open',
        sels: ['[data-testid="dashboard-open"]', 'button:has-text("仪表盘")'],
        label: '仪表盘',
      },
      {
        step: 'report-open',
        sels: ['[data-testid="report-open"]', 'button:has-text("分析报告")'],
        label: '分析报告',
      },
      { step: 'create-menu', sels: ['[data-testid="create-menu"]', 'button:has-text("新建")'], label: '侧栏新建' },
      { step: 'more-open', sels: ['[data-testid="more-open"]', 'button:has-text("更多")'], label: '更多' },
    ];

    for (const probe of ownerProbes) {
      await page.goto(`${baseUrl}?sheet=${sheet.id}`);
      await page.waitForTimeout(900);
      const ok = await clickFirst(page, probe.sels, probe.label, role);
      if (!ok) continue;
      await page.waitForTimeout(700);
      await shot(page, role, probe.step, `打开「${probe.label}」`);

      if (probe.step === 'more-open') {
        for (const sub of [
          { sels: ['[data-testid="permissions-open"]'], label: '权限', step: 'permissions' },
          { sels: ['[data-testid="public-view-open"]', '[data-testid="more-public-view"]'], label: '公开视图', step: 'public-view' },
          { sels: ['[data-testid="comments-toggle"]'], label: '评论', step: 'comments' },
          { sels: ['[data-testid="excel-export"]'], label: '导出', step: 'excel-export' },
        ]) {
          const hit = await clickFirst(page, sub.sels, sub.label, role);
          if (!hit) continue;
          await page.waitForTimeout(600);
          await shot(page, role, sub.step, `更多 → ${sub.label}`);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(200);
          // 重新打开更多
          await clickFirst(page, ['[data-testid="more-open"]'], '更多', role);
          await page.waitForTimeout(300);
        }
      }

      if (probe.step === 'forms-open') {
        // 收集表是独立 sheet；侧栏点开后常停在选择态，直接落到表单 sheet 再验 tabs
        await page.goto(`${baseUrl}?sheet=${formSheet.id}`);
        await page.waitForTimeout(800);
        await dismissOverlays(page, role);
        if (await clickFirst(page, ['[data-testid="form-object-form"]'], '表单编辑', role)) {
          await page.waitForTimeout(500);
          await shot(page, role, 'form-builder', '收集表编辑');
        }
        if (await clickFirst(page, ['[data-testid="form-object-results"]'], '填写结果', role)) {
          await page.waitForTimeout(500);
          await shot(page, role, 'form-results', '收集表结果');
        }
      }

      if (probe.step === 'dashboard-open') {
        await dismissOverlays(page, role);
        const row = page.locator('[data-testid="dashboard-row"]').first();
        if ((await row.count()) > 0) {
          await row.click({ force: true, timeout: 5_000 }).catch(async () => {
            note(role, 'dashboard-row-click', '仪表盘行点击被遮罩拦截', 'warn', page.url());
          });
          await page.waitForTimeout(800);
          await shot(page, role, 'dashboard-canvas', '仪表盘画布');
        }
      }

      await dismissOverlays(page, role);
      await page.keyboard.press('Escape');
    }

    // 视图栏 / 筛选排序等工具（有则点）
    await page.goto(`${baseUrl}?sheet=${sheet.id}`);
    await page.waitForTimeout(900);
    if (await page.locator('[data-testid="view-tabs-bar"]').count()) {
      await shot(page, role, 'view-tabs', '命名视图栏');
    }
    for (const tool of ['筛选', '排序', '分组', '填色', '字段', '行高', '冻结']) {
      const btn = page.getByRole('button', { name: tool }).first();
      if ((await btn.count()) === 0) continue;
      if (!(await btn.isVisible().catch(() => false))) continue;
      await btn.click().catch(() => undefined);
      await page.waitForTimeout(400);
      await shot(page, role, `tool-${tool}`, `工具栏「${tool}」`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }

    // 单元格编辑：优先用引擎探针定位首行数据格，避免点到表头
    const host = page.locator('[data-testid="canvas-grid"], .canvas-grid-wrap').first();
    if ((await host.count()) > 0) {
      await host.scrollIntoViewIfNeeded().catch(() => undefined);
      const hit = await page.evaluate(() => {
        const wrap = document.querySelector('[data-testid="canvas-grid"], .canvas-grid-wrap') as HTMLElement | null;
        if (!wrap) return null;
        const rect = wrap.getBoundingClientRect();
        const engine = (window as unknown as { __gridEngine?: { metrics?: { headerHeight?: number; rowHeight?: number; rowNumberWidth?: number } } }).__gridEngine;
        const headerH = engine?.metrics?.headerHeight ?? 36;
        const rowH = engine?.metrics?.rowHeight ?? 36;
        const gutter = engine?.metrics?.rowNumberWidth ?? 48;
        return {
          x: rect.left + gutter + 80,
          y: rect.top + headerH + rowH * 0.5,
        };
      });
      if (hit) {
        await page.mouse.click(hit.x, hit.y);
        await page.waitForTimeout(150);
        await page.mouse.dblclick(hit.x, hit.y);
        await page.waitForTimeout(500);
      }
      const editor = page.locator('[data-testid="cell-editor"]');
      if ((await editor.count()) > 0) {
        await editor.fill(`owner改${stamp}`);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(700);
        await shot(page, role, 'cell-edit', '双击编辑单元格');
      } else {
        note(role, 'cell-edit', '双击后无 cell-editor', 'warn', page.url());
        await shot(page, role, 'cell-edit-miss', '双击后无编辑框');
      }
    } else {
      note(role, 'grid', '未找到网格', 'error', page.url());
    }

    // 消息中心
    await page.goto('/notifications');
    await page.waitForTimeout(700);
    await shot(page, role, 'notifications', '消息中心');

    await context.close();
  }

  // —— Editor ——
  {
    const role = 'editor';
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await attachErrorHooks(page, role);
    await bindAuth(page, editor.accessToken, editor.user);

    await page.goto('/');
    await page.waitForTimeout(700);
    await shot(page, role, 'home', 'editor 首页');

    const baseUrl = `/workspaces/${workspace.id}/bases/${base.id}`;
    await page.goto(`${baseUrl}?sheet=${sheet.id}`);
    await page.waitForSelector('[data-testid="more-open"], .canvas-grid-wrap', {
      timeout: 20_000,
    });
    await page.waitForTimeout(800);
    await shot(page, role, 'base-grid', 'editor 打开 Base');

    // editor 应能编辑、通常也能开自动化/表单（按产品角色）
    for (const probe of [
      { step: 'forms', sels: ['[data-testid="forms-open"]'] },
      { step: 'automation', sels: ['[data-testid="automation-open"]'] },
      { step: 'more', sels: ['[data-testid="more-open"]'] },
    ]) {
      await page.goto(`${baseUrl}?sheet=${sheet.id}`);
      await page.waitForTimeout(600);
      if (await clickFirst(page, probe.sels, probe.step, role)) {
        await page.waitForTimeout(600);
        await shot(page, role, probe.step, `editor 打开 ${probe.step}`);
      }
    }

    const readonlyBanner = page.locator('[data-testid="readonly-banner"]');
    if ((await readonlyBanner.count()) > 0 && (await readonlyBanner.isVisible())) {
      note(role, 'readonly-banner', 'editor 不应出现只读横幅', 'error', page.url());
    }

    await context.close();
  }

  // —— Viewer ——
  {
    const role = 'viewer';
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await attachErrorHooks(page, role);
    await bindAuth(page, viewer.accessToken, viewer.user);

    await page.goto('/');
    await page.waitForTimeout(700);
    await shot(page, role, 'home', 'viewer 首页');

    // viewer 不应能新建表格
    const createBase = page.locator('[data-testid="create-base"]');
    if ((await createBase.count()) > 0 && (await createBase.isVisible().catch(() => false))) {
      note(role, 'create-base-visible', 'viewer 仍可见新建表格', 'error', page.url());
    }

    const baseUrl = `/workspaces/${workspace.id}/bases/${base.id}`;
    await page.goto(`${baseUrl}?sheet=${sheet.id}`);
    await page.waitForTimeout(1200);
    await shot(page, role, 'base-grid', 'viewer 打开 Base');

    const banner = page.locator('[data-testid="readonly-banner"]');
    if ((await banner.count()) === 0 || !(await banner.isVisible().catch(() => false))) {
      note(role, 'readonly-banner-missing', 'viewer 未看到只读横幅', 'warn', page.url());
    } else {
      await shot(page, role, 'readonly-banner', 'viewer 只读横幅');
    }

    // 危险写入口不应暴露
    for (const [label, sel] of [
      ['create-sheet', '[data-testid="create-sheet"]'],
      ['create-menu', '[data-testid="create-menu"]'],
    ] as const) {
      const loc = page.locator(sel);
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        note(role, `write-leak-${label}`, `viewer 可见写入口 ${label}`, 'error', page.url());
      }
    }

    // 尝试双击编辑应失败/无 editor
    const host = page.locator('.canvas-grid-wrap').first();
    if ((await host.count()) > 0) {
      const box = await host.boundingBox();
      if (box) {
        await page.mouse.dblclick(box.x + 160, box.y + 56);
        await page.waitForTimeout(400);
        if ((await page.locator('[data-testid="cell-editor"]').count()) > 0) {
          note(role, 'cell-edit-leak', 'viewer 双击出现了编辑框', 'error', page.url());
          await shot(page, role, 'cell-edit-leak', 'viewer 不应可编辑');
        } else {
          await shot(page, role, 'cell-edit-blocked', 'viewer 双击无编辑框（预期）');
        }
      }
    }

    await context.close();
  }

  // —— 公开填表：在 UI 里打开收集表单并尝试分享拿 token ——
  {
    const role = 'owner-public';
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await attachErrorHooks(page, role);
    await bindAuth(page, token, owner.user);
    await page.goto(`/workspaces/${workspace.id}/bases/${base.id}?sheet=${formSheet.id}`);
    await page.waitForTimeout(1200);
    await shot(page, role, 'form-sheet', '打开收集表单 sheet');
    if (await clickFirst(page, ['[data-testid="form-share-open"]', 'button:has-text("分享")'], 'form-share', role)) {
      await page.waitForTimeout(600);
      await shot(page, role, 'form-share', '收集表分享对话框');
      const urlText = await page.locator('[data-testid="form-share-url-dialog"]').textContent().catch(() => '');
      const match = urlText?.match(/\/fill\/([A-Za-z0-9_-]+)/);
      if (match?.[1]) {
        const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const fillPage = await guest.newPage();
        await attachErrorHooks(fillPage, 'public');
        await fillPage.goto(`/fill/${match[1]}`);
        await fillPage.waitForTimeout(800);
        await shot(fillPage, 'public', 'form-fill', '公开填表页');
        // 尝试提交
        const input = fillPage.locator('input, textarea').first();
        if ((await input.count()) > 0) {
          await input.fill(`公开提交${stamp}`).catch(() => undefined);
          await fillPage.getByRole('button', { name: /提交/ }).click().catch(() => undefined);
          await fillPage.waitForTimeout(800);
          await shot(fillPage, 'public', 'form-submit', '公开填表提交后');
        }
        await guest.close();
      } else {
        note(role, 'form-token', '分享对话框未解析到 /fill/token', 'warn', page.url());
      }
    }
    void formNameField;
    await context.close();
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warn');
  await writeFile(
    join(OUT, 'report.json'),
    `${JSON.stringify(
      {
        stamp,
        accounts: { ownerAccount, editorAccount, viewerAccount },
        workspaceId: workspace.id,
        baseId: base.id,
        sheetId: sheet.id,
        dashboardId: dashboard.id,
        formSheetId: formSheet.id,
        counts: {
          shots: findings.filter((f) => f.shot).length,
          errors: errors.length,
          warns: warns.length,
          info: findings.filter((f) => f.severity === 'info').length,
        },
        errors,
        warns,
        findings,
      },
      null,
      2,
    )}\n`,
  );

  // 探索允许 warn；仅致命前端错误失败（递归更新 / Worker clone 等）
  const fatal = errors.filter(
    (item) =>
      /Maximum recursive updates/i.test(item.note) ||
      /DataCloneError/i.test(item.note),
  );
  expect(fatal, JSON.stringify(fatal, null, 2)).toEqual([]);
});
