import { expect, test, request as apiRequest, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'http://127.0.0.1:3000';
/** Playwright cwd is apps/web; keep shots under repo .data for review. */
const OUT = resolve(process.cwd(), '../../.data/mobile-audit');

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

async function shot(page: Page, name: string) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({
    path: resolve(OUT, `${name}.png`),
    fullPage: false,
  });
}

async function softClick(page: Page, locator: ReturnType<Page['locator']>) {
  try {
    const el = locator.first();
    if (!(await el.isVisible({ timeout: 1500 }).catch(() => false))) {
      return false;
    }
    await el.click({ timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function closeOverlay(page: Page) {
  if (
    await softClick(
      page,
      page.getByTestId('mobile-sheet-close').or(page.locator('.mobile-sheet-close')),
    )
  ) {
    return;
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

test.describe('mobile visual audit', () => {
  test('seed + screenshot all station/base/admin/public surfaces', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const stamp = Date.now();
    const account = `mva${String(stamp).slice(-8)}`;
    const password = 'Ab12_cd34';
    const api = await apiRequest.newContext({ baseURL: API });

    const session = await (
      await api.post('/auth/register', {
        data: {
          account,
          password,
          securityQuestion: '你小学就读的学校名称是？',
          securityAnswer: 'demo',
        },
      })
    ).json();
    expect(session.accessToken).toBeTruthy();
    const headers = { Authorization: `Bearer ${session.accessToken}` };

    const workspace = await (
      await api.post('/workspaces', {
        headers,
        data: { name: '手机审计工作区' },
      })
    ).json();
    expect(workspace.id).toBeTruthy();

    const base = await (
      await api.post(`/workspaces/${workspace.id}/bases`, {
        headers,
        data: { name: '手机审计表格' },
      })
    ).json();
    expect(base.id).toBeTruthy();

    const sheetsRes = await (
      await api.get(`/bases/${base.id}/sheets`, { headers })
    ).json();
    const defaultSheet = Array.isArray(sheetsRes)
      ? sheetsRes[0]
      : sheetsRes?.items?.[0] ?? sheetsRes?.sheets?.[0];
    expect(defaultSheet?.id).toBeTruthy();

    const nameField = await (
      await api.post(`/sheets/${defaultSheet.id}/fields`, {
        headers,
        data: { name: '客户名', type: 'text' },
      })
    ).json();
    const statusField = await (
      await api.post(`/sheets/${defaultSheet.id}/fields`, {
        headers,
        data: {
          name: '状态',
          type: 'select',
          options: {
            choices: [
              { id: 'new', name: '新线索', color: 'blue' },
              { id: 'won', name: '已成交', color: 'green' },
              { id: 'lost', name: '已流失', color: 'red' },
            ],
          },
        },
      })
    ).json();
    const phoneField = await (
      await api.post(`/sheets/${defaultSheet.id}/fields`, {
        headers,
        data: { name: '手机', type: 'phone' },
      })
    ).json();
    const noteField = await (
      await api.post(`/sheets/${defaultSheet.id}/fields`, {
        headers,
        data: { name: '备注', type: 'longText' },
      })
    ).json();

    const sampleRows = [
      ['张三', 'new', '13800001111', '跟进中，下周回访'],
      ['李四', 'won', '13900002222', '合同已签'],
      ['王五', 'lost', '13700003333', '价格不合适'],
      ['赵六', 'new', '13600004444', '待分配销售'],
      ['钱七', 'won', '13500005555', '续费客户'],
    ];
    for (const [name, status, phone, note] of sampleRows) {
      await api.post(`/sheets/${defaultSheet.id}/records`, {
        headers,
        data: {
          cells: {
            [nameField.id]: name,
            [statusField.id]: status,
            [phoneField.id]: phone,
            [noteField.id]: note,
          },
        },
      });
    }

    // Form sheet (产品：收集表单独立 sheet)
    const formSheet = await (
      await api.post(`/bases/${base.id}/sheets`, {
        headers,
        data: { name: '收集表单', seed: false },
      })
    ).json();
    const formName = await (
      await api.post(`/sheets/${formSheet.id}/fields`, {
        headers,
        data: { name: '姓名', type: 'text', required: true },
      })
    ).json();
    await api.post(`/sheets/${formSheet.id}/fields`, {
      headers,
      data: { name: '联系电话', type: 'phone' },
    });
    await api.post(`/sheets/${formSheet.id}/fields`, {
      headers,
        data: { name: '留言', type: 'longText' },
    });

    const dash = await (
      await api.post(`/bases/${base.id}/dashboards`, {
        headers,
        data: { name: '手机仪表盘' },
      })
    ).json();

    await page.addInitScript(
      ({ token, user }) => {
        localStorage.setItem('st.token', token);
        localStorage.setItem('st.user', JSON.stringify(user));
      },
      { token: session.accessToken, user: session.user },
    );

    // Login
    await page.goto('/login');
    await page.waitForTimeout(400);
    await shot(page, '01-login');

    // Home
    await page.goto('/');
    await expect(page.getByTestId('station-bottom-nav')).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(800);
    await shot(page, '02-home');

    // Create workspace / base UI
    if (
      await softClick(
        page,
        page.getByTestId('hub-create-base').or(
          page.getByRole('button', { name: /新建表格|创建表格/ }),
        ),
      )
    ) {
      await page.waitForTimeout(400);
      await shot(page, '02b-create-base');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }

    // Notifications
    await page.getByTestId('station-nav-notifications').click();
    await expect(page.getByTestId('notifications-page')).toBeVisible();
    await shot(page, '03-notifications');

    // Me
    await page.getByTestId('station-nav-me').click();
    await expect(page.getByTestId('me-page')).toBeVisible();
    await shot(page, '04-me');

    // Admin pages
    for (const [path, name] of [
      ['/admin/users', '05-admin-users'],
      ['/admin/feedback', '05b-admin-feedback'],
      ['/admin/activity', '05c-admin-activity'],
    ] as const) {
      await page.goto(path);
      await page.waitForTimeout(700);
      await shot(page, name);
    }

    const baseUrl = `/workspaces/${workspace.id}/bases/${base.id}`;

    // Data face list
    await page.goto(`${baseUrl}?sheet=${defaultSheet.id}&face=data`);
    await expect(page.getByTestId('base-face-tabs')).toBeVisible({
      timeout: 60_000,
    });
    await page.waitForTimeout(1200);
    await shot(page, '10-base-data-list');

    // Compact table
    if (await softClick(page, page.getByTestId('phone-layout-toggle'))) {
      await page.waitForTimeout(600);
      await shot(page, '10b-base-data-compact');
      await softClick(page, page.getByTestId('phone-layout-toggle'));
      await page.waitForTimeout(400);
    }

    // Record detail
    const recordCard = page
      .getByTestId('record-list-item')
      .or(page.locator('[data-testid="record-card"]'))
      .or(page.locator('.record-list-item, .record-card'));
    if (await softClick(page, recordCard)) {
      await page.waitForTimeout(700);
      await shot(page, '11-record-detail-sheet');
      await closeOverlay(page);
    }

    // Sidebar drawer
    if (
      await softClick(
        page,
        page
          .getByTestId('base-sidebar-toggle')
          .or(page.getByTestId('phone-sidebar-toggle'))
          .or(page.getByTestId('base-menu-btn')),
      )
    ) {
      await page.waitForTimeout(500);
      await shot(page, '12-base-sidebar-drawer');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // Form face
    await page.goto(`${baseUrl}?sheet=${formSheet.id}&face=form`);
    await page.waitForTimeout(1500);
    await shot(page, '20-form-face');

    if (
      await softClick(
        page,
        page
          .getByTestId('form-share-open')
          .or(page.getByTestId('form-share-btn'))
          .or(page.getByRole('button', { name: /分享|发布|填写链接/ })),
      )
    ) {
      await page.waitForTimeout(500);
      await shot(page, '20b-form-share');
      await page.keyboard.press('Escape');
    }

    if (
      await softClick(
        page,
        page
          .getByTestId('form-condition-open')
          .or(page.getByRole('button', { name: /条件|显隐/ })),
      )
    ) {
      await page.waitForTimeout(500);
      await shot(page, '20c-form-conditions');
      await page.keyboard.press('Escape');
    }

    // Automation face
    await page.goto(`${baseUrl}?face=automation`);
    await page.waitForTimeout(1200);
    await shot(page, '30-automation-face');

    if (
      await softClick(
        page,
        page
          .getByTestId('automation-create')
          .or(page.getByTestId('automation-create-empty')),
      )
    ) {
      await page.waitForTimeout(800);
      await shot(page, '30b-automation-editor');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // Dashboard
    await page.goto(`${baseUrl}?face=dashboard&oid=${dash.id}`);
    await page.waitForTimeout(1200);
    await shot(page, '40-dashboard-face');

    if (
      await softClick(
        page,
        page
          .getByTestId('dashboard-add-widget')
          .or(page.getByTestId('dashboard-phone-builder'))
          .or(page.getByRole('button', { name: /添加组件|新建|添加/ })),
      )
    ) {
      await page.waitForTimeout(700);
      await shot(page, '40b-dashboard-builder');
      await page.keyboard.press('Escape');
    }

    // Analysis
    await page.goto(`${baseUrl}?face=analysis`);
    await page.waitForTimeout(1200);
    await shot(page, '50-analysis-face');

    // Public form fill — resolve form token from API
    const forms = await (
      await api.get(`/forms?baseId=${base.id}`, { headers })
    ).json();
    const form = Array.isArray(forms) ? forms[0] : forms?.items?.[0];
    if (form?.id) {
      // ensure share enabled if endpoint exists
      await api
        .patch(`/forms/${form.id}`, {
          headers,
          data: { name: '手机收集表' },
        })
        .catch(() => null);
      const shareInfo = await api
        .get(`/forms/${form.id}`, { headers })
        .then((r) => r.json())
        .catch(() => form);
      const token =
        shareInfo?.shareToken ||
        shareInfo?.publicToken ||
        shareInfo?.token ||
        form.shareToken;
      if (token) {
        await page.goto(`/fill/${token}`);
        await page.waitForTimeout(1000);
        await shot(page, '60-form-fill');
      } else if (shareInfo?.shareUrl) {
        const path = String(shareInfo.shareUrl).replace(/^https?:\/\/[^/]+/, '');
        await page.goto(path);
        await page.waitForTimeout(1000);
        await shot(page, '60-form-fill');
      }
    }

    // Confirm dialog
    await page.goto('/me');
    await page.waitForTimeout(500);
    if (
      await softClick(
        page,
        page.getByTestId('me-logout').or(page.getByRole('button', { name: /退出/ })),
      )
    ) {
      await page.waitForTimeout(400);
      await shot(page, '70-confirm-logout');
    }

    // keep a marker so test always "passes" after screenshots
    expect(true).toBe(true);
  });
});
