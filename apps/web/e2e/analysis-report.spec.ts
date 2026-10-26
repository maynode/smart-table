import { expect, test, request as apiRequest } from '@playwright/test';

const API = 'http://127.0.0.1:3000';

test('analysis report panel: chat, generate, delete', async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const account = `arui${String(stamp).slice(-8)}`;
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
  expect(owner.accessToken).toBeTruthy();
  const headers = { Authorization: `Bearer ${owner.accessToken}` };
  const workspace = await (
    await api.post('/workspaces', {
      headers,
      data: { name: `分析UI工作区${stamp}` },
    })
  ).json();
  const base = await (
    await api.post(`/workspaces/${workspace.id}/bases`, {
      headers,
      data: { name: '分析 UI Base' },
    })
  ).json();
  const sheet = await (
    await api.post(`/bases/${base.id}/sheets`, {
      headers,
      data: { name: '销售', seed: false },
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
    data: { cells: { [amount.id]: 120 } },
  });

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
  await expect(page.getByTestId('report-open')).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('report-open').click();
  await expect(page.getByTestId('app-dialog')).toBeVisible();
  await page.getByTestId('app-dialog-input').fill('UI 分析报告');
  await page.getByTestId('app-dialog-confirm').click();

  await expect(page.getByTestId('analysis-report-panel')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('analysis-chat')).toBeVisible();
  await expect(page.getByTestId('analysis-chat-input')).toBeVisible();
  await expect(page.getByTestId('analysis-steps')).toHaveCount(0);
  await expect(page.getByTestId('analysis-confirm')).toHaveCount(0);

  await page.getByTestId('analysis-chat-input').fill('请生成分析报告');
  await page.getByTestId('analysis-chat-send').click();

  await expect(page.getByTestId('analysis-report-body')).toBeVisible({
    timeout: 120_000,
  });

  await page.getByTestId('analysis-delete').click();
  await expect(page.getByTestId('app-dialog')).toBeVisible();
  await page.getByTestId('app-dialog-confirm').click();
  await expect
    .poll(
      async () => {
        const rows = await (
          await api.get(`/bases/${base.id}/analysis-reports`, { headers })
        ).json();
        return Array.isArray(rows) ? rows.length : -1;
      },
      { timeout: 15_000 },
    )
    .toBe(0);
  await page.getByTestId('analysis-close').click();
  await expect(page.getByTestId('analysis-report-panel')).toBeHidden({
    timeout: 10_000,
  });
});
