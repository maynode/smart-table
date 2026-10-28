/**
 * 小白用户探索巡检：注册 → 建表 → 点各面板 → 截图到 .explore-shots/
 * Usage: node scripts/perf/explore-xiaobai.mjs
 * Requires: API :3000 + web :5173
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dirname, '../../apps/web/package.json'));
const { chromium } = require('@playwright/test');

const API = process.env.PERF_API ?? 'http://127.0.0.1:3000';
const WEB = process.env.PERF_WEB ?? 'http://127.0.0.1:5173';
const OUT = join(process.cwd(), '.explore-shots');
const password = 'Ab12_cd34';
const stamp = Date.now();
const account = `xiaobai${String(stamp).slice(-8)}`;

const findings = [];

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

async function shot(page, name, note) {
  const file = join(OUT, `${String(findings.length + 1).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  findings.push({ name, note, file, url: page.url() });
  console.log(`[shot] ${name}: ${note}`);
}

async function safeClick(page, selector, label) {
  const loc = page.locator(selector).first();
  if ((await loc.count()) === 0) {
    findings.push({ name: `missing-${label}`, note: `找不到 ${selector}`, severity: 'warn' });
    return false;
  }
  await loc.click({ timeout: 8000 });
  return true;
}

await mkdir(OUT, { recursive: true });

console.log(`register ${account}`);
const owner = await api('/auth/register', {
  method: 'POST',
  body: {
    account,
    password,
    securityQuestion: '你小学就读的学校名称是？',
    securityAnswer: 'demo',
  },
});
const token = owner.accessToken;
const viewerAccount = `viewer${String(stamp).slice(-8)}`;
const viewer = await api('/auth/register', {
  method: 'POST',
  body: {
    account: viewerAccount,
    password,
    securityQuestion: '你小学就读的学校名称是？',
    securityAnswer: 'demo',
  },
});

const workspace = await api('/workspaces', {
  method: 'POST',
  token,
  body: { name: `小白工作区${stamp}` },
});
await api(`/workspaces/${workspace.id}/members`, {
  method: 'POST',
  token,
  body: { account: viewerAccount, role: 'viewer' },
});
const base = await api(`/workspaces/${workspace.id}/bases`, {
  method: 'POST',
  token,
  body: { name: '小白试用表' },
});
const sheet = await api(`/bases/${base.id}/sheets`, {
  method: 'POST',
  token,
  body: { name: '数据表', seed: true },
});

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (err) => {
  findings.push({ name: 'pageerror', note: String(err), severity: 'error', url: page.url() });
});
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    findings.push({
      name: 'console-error',
      note: msg.text().slice(0, 400),
      severity: 'warn',
      url: page.url(),
    });
  }
});

await page.addInitScript(
  ({ t, u }) => {
    localStorage.setItem('st.token', t);
    localStorage.setItem('st.user', JSON.stringify(u));
  },
  { t: token, u: owner.user },
);

// 1) 首页
await page.goto(`${WEB}/`);
await page.waitForTimeout(800);
await shot(page, 'home', '登录后首页/工作区');

// 2) 打开 Base
await page.goto(`${WEB}/bases/${base.id}`);
await page.waitForTimeout(1200);
await shot(page, 'base-sheet', '打开智能表格网格');

// 3) 点侧栏常见入口（有则进）
const navProbes = [
  { sel: '[data-testid="nav-form"], button:has-text("收集表"), a:has-text("收集表")', name: 'forms', label: '收集表' },
  { sel: '[data-testid="nav-automation"], button:has-text("自动化"), a:has-text("自动化")', name: 'automation', label: '自动化' },
  { sel: '[data-testid="nav-dashboard"], button:has-text("仪表盘"), a:has-text("仪表盘")', name: 'dashboard', label: '仪表盘' },
  { sel: '[data-testid="nav-permission"], button:has-text("权限"), a:has-text("权限")', name: 'permissions', label: '权限' },
  { sel: 'button:has-text("分享"), [data-testid="share-btn"]', name: 'share', label: '分享' },
  { sel: 'button:has-text("更多"), [data-testid="more-menu"]', name: 'more', label: '更多' },
];

for (const probe of navProbes) {
  try {
    const hit = await safeClick(page, probe.sel, probe.label);
    if (!hit) continue;
    await page.waitForTimeout(700);
    await shot(page, probe.name, `点击「${probe.label}」后`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } catch (err) {
    findings.push({
      name: `click-fail-${probe.name}`,
      note: String(err).slice(0, 300),
      severity: 'warn',
    });
  }
}

// 4) 消息页
await page.goto(`${WEB}/notifications`);
await page.waitForTimeout(800);
await shot(page, 'notifications', '消息中心');

// 5) 尝试在网格里编辑（Canvas 难点，只验证控件在）
await page.goto(`${WEB}/bases/${base.id}`);
await page.waitForTimeout(1500);
const grid = page.locator('[data-testid="canvas-grid"], .canvas-grid-wrap, canvas').first();
if ((await grid.count()) > 0) {
  const box = await grid.boundingBox();
  if (box) {
    await page.mouse.dblclick(box.x + 180, box.y + 60);
    await page.waitForTimeout(400);
    const editor = page.locator('[data-testid="cell-editor"]');
    if ((await editor.count()) > 0) {
      await editor.fill(`小白改${stamp}`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(800);
      await shot(page, 'cell-edit', '双击单元格编辑并回车');
    } else {
      findings.push({
        name: 'cell-editor-missing',
        note: '双击后未出现 cell-editor（可能点在空白/只读列）',
        severity: 'warn',
      });
      await shot(page, 'cell-edit-miss', '双击后无编辑框');
    }
  }
} else {
  findings.push({ name: 'grid-missing', note: '未找到网格 canvas', severity: 'error' });
}

// 6) viewer 只读壳
const viewerPage = await context.newPage();
await viewerPage.addInitScript(
  ({ t, u }) => {
    localStorage.setItem('st.token', t);
    localStorage.setItem('st.user', JSON.stringify(u));
  },
  { t: viewer.accessToken, u: viewer.user },
);
await viewerPage.goto(`${WEB}/bases/${base.id}`);
await viewerPage.waitForTimeout(1200);
await viewerPage.screenshot({ path: join(OUT, '09-viewer-readonly.png') });
findings.push({
  name: 'viewer-readonly',
  note: 'viewer 打开同一 Base',
  file: join(OUT, '09-viewer-readonly.png'),
  url: viewerPage.url(),
});
const createVisible = await viewerPage.locator('button:has-text("添加记录"), button:has-text("新建")').count();
if (createVisible > 0) {
  findings.push({
    name: 'viewer-can-see-create',
    note: `viewer 仍看到 ${createVisible} 个新建/添加入口`,
    severity: 'error',
  });
}

// 7) 忘记密码入口（未登录）
const guest = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const loginPage = await guest.newPage();
await loginPage.goto(`${WEB}/login`);
await loginPage.waitForTimeout(500);
await loginPage.screenshot({ path: join(OUT, '10-login.png') });
findings.push({ name: 'login', note: '登录页', file: join(OUT, '10-login.png') });
if (await loginPage.getByRole('button', { name: '忘记密码？' }).count()) {
  await loginPage.getByRole('button', { name: '忘记密码？' }).click();
  await loginPage.waitForTimeout(500);
  await loginPage.screenshot({ path: join(OUT, '11-forgot-password.png') });
  findings.push({ name: 'forgot-password', note: '忘记密码流程入口' });
}

await browser.close();

const report = {
  account,
  viewerAccount,
  workspaceId: workspace.id,
  baseId: base.id,
  sheetId: sheet.id,
  findings,
  shotDir: OUT,
  createdAt: new Date().toISOString(),
};
await writeFile(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const errors = findings.filter((f) => f.severity === 'error');
const warns = findings.filter((f) => f.severity === 'warn');
console.log(
  JSON.stringify(
    {
      ok: errors.length === 0,
      errors: errors.length,
      warns: warns.length,
      shots: findings.filter((f) => f.file).length,
      out: OUT,
      errorsDetail: errors,
      warnsDetail: warns.slice(0, 20),
    },
    null,
    2,
  ),
);
process.exit(errors.length ? 1 : 0);
