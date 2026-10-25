import { expect, test, request as apiRequest } from '@playwright/test';

const API = 'http://127.0.0.1:3000';

test('offline cell edit persists and flushes after online', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const account = `off${String(stamp).slice(-8)}`;
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
      data: { name: `离线工作区${stamp}` },
    })
  ).json();
  const base = await (
    await api.post(`/workspaces/${workspace.id}/bases`, {
      headers,
      data: { name: '离线 Base' },
    })
  ).json();
  const sheets = await (
    await api.get(`/bases/${base.id}/sheets`, { headers })
  ).json();
  const sheet = sheets[0] as { id: string };
  const field = await (
    await api.post(`/sheets/${sheet.id}/fields`, {
      headers,
      data: { name: '离线列', type: 'text' },
    })
  ).json();
  const record = await (
    await api.post(`/sheets/${sheet.id}/records`, {
      headers,
      data: { cells: { [field.id]: '在线值' } },
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
  await expect(page.locator('[data-testid="canvas-grid"]')).toBeVisible({
    timeout: 30_000,
  });

  await context.setOffline(true);
  await expect(page.getByTestId('sync-banner')).toBeVisible({ timeout: 10_000 });

  await page.evaluate(
    async ({ sheetId, recordId, fieldId }) => {
      const mc = (
        window as unknown as {
          __stMessageCenter?: {
            enqueue: (s: string, m: unknown) => Promise<string>;
            flushAll: () => Promise<void>;
          };
        }
      ).__stMessageCenter;
      if (!mc) throw new Error('MessageCenter not bootstrapped');
      await mc.enqueue(sheetId, {
        type: 'setRecord',
        recordId,
        cells: { [fieldId]: '离线改写' },
        baseVersion: 1,
      });
    },
    { sheetId: sheet.id, recordId: record.id, fieldId: field.id },
  );

  await expect(page.getByTestId('sync-banner')).toContainText(/离线|待同步/);

  await context.setOffline(false);
  await page.evaluate(async () => {
    const mc = (
      window as unknown as {
        __stMessageCenter?: { flushAll: () => Promise<void> };
      }
    ).__stMessageCenter;
    await mc?.flushAll();
  });

  await expect
    .poll(
      async () => {
        const rec = await (
          await api.get(`/sheets/${sheet.id}/records?limit=50`, { headers })
        ).json();
        const row = rec.records.find((r: { id: string }) => r.id === record.id);
        return row?.cells?.[field.id];
      },
      { timeout: 30_000 },
    )
    .toBe('离线改写');
});
