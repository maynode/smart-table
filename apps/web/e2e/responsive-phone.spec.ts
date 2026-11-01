import { expect, test, request as apiRequest } from '@playwright/test';

const API = 'http://127.0.0.1:3000';

/** Chromium + phone viewport (project defaults to Chrome; avoid webkit device preset). */
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test.describe('responsive phone shell + surfaces', () => {
  test('station nav, record list, faces form/automation/dashboard', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const account = `rph${String(stamp).slice(-8)}`;
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
      await api.post('/workspaces', { headers, data: { name: 'Phone WS' } })
    ).json();
    const base = await (
      await api.post(`/workspaces/${workspace.id}/bases`, {
        headers,
        data: { name: 'Phone Base' },
      })
    ).json();
    const sheets = await (
      await api.get(`/bases/${base.id}/sheets`, { headers })
    ).json();
    const sheet = Array.isArray(sheets) ? sheets[0] : null;
    expect(sheet?.id).toBeTruthy();
    await api.post(`/sheets/${sheet.id}/records`, {
      headers,
      data: { cells: {} },
    });
    const dash = await (
      await api.post(`/bases/${base.id}/dashboards`, {
        headers,
        data: { name: '手机仪表盘' },
      })
    ).json();
    expect(dash.id).toBeTruthy();

    await page.addInitScript(
      ({ token, user }) => {
        localStorage.setItem('st.token', token);
        localStorage.setItem('st.user', JSON.stringify(user));
      },
      { token: session.accessToken, user: session.user },
    );

    await page.goto('/');
    await expect(page.getByTestId('station-bottom-nav')).toBeVisible();
    await page.getByTestId('station-nav-notifications').click();
    await expect(page.getByTestId('notifications-page')).toBeVisible();
    await page.getByTestId('station-nav-me').click();
    await expect(page.getByTestId('me-page')).toBeVisible();

    await page.goto(
      `/workspaces/${workspace.id}/bases/${base.id}?sheet=${sheet.id}`,
    );
    await expect(page.getByTestId('station-bottom-nav')).toHaveCount(0);
    await expect(page.getByTestId('base-face-tabs')).toBeVisible();
    await expect(page.getByTestId('phone-layout-toggle')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('record-list')).toBeVisible();
    await expect(page.locator('[data-testid^="record-card-"]').first()).toBeVisible({
      timeout: 30_000,
    });
    await page.locator('[data-testid^="record-card-"]').first().click();
    await expect(page.getByTestId('record-detail-sheet')).toBeVisible();
    await page.evaluate(() => {
      const btn = document.querySelector(
        '[data-testid="record-detail-sheet"] button.mobile-sheet-close',
      ) as HTMLButtonElement | null;
      btn?.click();
    });
    await expect(page.getByTestId('record-detail-sheet')).toBeHidden({
      timeout: 10_000,
    });

    await page.getByTestId('phone-layout-compact').click();
    await expect(page.getByTestId('compact-record-table')).toBeVisible();
    await page.getByTestId('phone-layout-list').click();

    await page.getByTestId('face-tab-automation').click();
    await expect(page.getByTestId('automation-face')).toBeVisible();
    await expect(page.getByTestId('automation-create')).toBeVisible();

    await page.getByTestId('face-tab-dashboard').click();
    await expect(page.getByTestId('dashboard-phone-builder')).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId('dashboard-phone-builder').click();
    await expect(
      page.getByTestId('dashboard-phone-builder-close'),
    ).toBeVisible({ timeout: 15_000 });
  });
});
