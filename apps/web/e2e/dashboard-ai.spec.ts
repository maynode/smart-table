import { expect, test, request as apiRequest } from '@playwright/test';

const API = 'http://127.0.0.1:3000';

test('dashboard AI dock: add bar chart via local agent', async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const account = `daiui${String(stamp).slice(-8)}`;
  const password = 'Ab12_cd34';
  const api = await apiRequest.newContext({ baseURL: API });
  const ownerRes = await api.post('/auth/register', {
    data: {
      account,
      password,
      securityQuestion: '你小学就读的学校名称是？',
      securityAnswer: 'demo',
    },
  });
  expect(ownerRes.ok()).toBeTruthy();
  const owner = await ownerRes.json();
  const headers = { Authorization: `Bearer ${owner.accessToken}` };

  const workspace = await (
    await api.post('/workspaces', {
      headers,
      data: { name: `仪表盘AI UI${stamp}` },
    })
  ).json();
  const base = await (
    await api.post(`/workspaces/${workspace.id}/bases`, {
      headers,
      data: { name: '仪表盘 AI Base' },
    })
  ).json();
  const sheet = await (
    await api.post(`/bases/${base.id}/sheets`, {
      headers,
      data: { name: '销售', seed: false },
    })
  ).json();
  const region = await (
    await api.post(`/sheets/${sheet.id}/fields`, {
      headers,
      data: { name: '区域', type: 'text' },
    })
  ).json();
  const amount = await (
    await api.post(`/sheets/${sheet.id}/fields`, {
      headers,
      data: { name: '金额', type: 'number' },
    })
  ).json();
  await api.post(`/sheets/${sheet.id}/records`, {
    headers,
    data: { cells: { [region.id]: '华东', [amount.id]: 12 } },
  });
  const dashboard = await (
    await api.post(`/bases/${base.id}/dashboards`, {
      headers,
      data: { name: 'AI 画布' },
    })
  ).json();

  await page.addInitScript(
    ({ token, user }) => {
      localStorage.setItem('st.token', token);
      localStorage.setItem('st.user', JSON.stringify(user));
    },
    { token: owner.accessToken, user: owner.user },
  );

  await page.goto(
    `/workspaces/${workspace.id}/bases/${base.id}?sheet=${sheet.id}`,
  );
  await expect(page.getByTestId('canvas-grid')).toBeVisible({
    timeout: 30_000,
  });
  await page
    .getByTestId('dashboard-row')
    .filter({ hasText: dashboard.name })
    .click();
  await expect(page.getByTestId('dashboard-panel')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId('dashboard-ai-toggle').click();
  await expect(page.getByTestId('dashboard-ai-chat')).toBeVisible();
  await expect(page.getByTestId('dashboard-ai-input')).toBeVisible();

  const before = await page.getByTestId('dashboard-widget-card').count();
  await page.getByTestId('dashboard-ai-input').fill('加一张柱状图');
  await page.getByTestId('dashboard-ai-send').click();

  await expect
    .poll(async () => page.getByTestId('dashboard-widget-card').count(), {
      timeout: 30_000,
    })
    .toBeGreaterThan(before);
});
