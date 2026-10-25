import { expect, test, request as apiRequest } from '@playwright/test';

const API = 'http://127.0.0.1:3000';

test('two browsers see cell edit without refresh', async ({ browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const account = `col${String(stamp).slice(-8)}`;
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
      data: { name: `协同工作区${stamp}` },
    })
  ).json();
  const base = await (
    await api.post(`/workspaces/${workspace.id}/bases`, {
      headers,
      data: { name: '协同 Base' },
    })
  ).json();
  const sheets = await (
    await api.get(`/bases/${base.id}/sheets`, { headers })
  ).json();
  const sheet = sheets[0] as { id: string };
  const field = await (
    await api.post(`/sheets/${sheet.id}/fields`, {
      headers,
      data: { name: '协同列', type: 'text' },
    })
  ).json();
  const record = await (
    await api.post(`/sheets/${sheet.id}/records`, {
      headers,
      data: { cells: { [field.id]: '初始' } },
    })
  ).json();

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  for (const page of [pageA, pageB]) {
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
  }

  await expect(pageA.getByTestId('collab-presence')).toBeVisible({
    timeout: 20_000,
  });
  await expect(pageB.getByTestId('collab-presence')).toBeVisible({
    timeout: 20_000,
  });

  const marker = `协同值-${stamp}`;
  await pageA.evaluate(
    async ({ sheetId, recordId, fieldId, value }) => {
      const mc = (
        window as unknown as {
          __stMessageCenter?: {
            enqueue: (s: string, m: unknown) => Promise<string>;
            flushAll: () => Promise<void>;
          };
        }
      ).__stMessageCenter;
      if (!mc) throw new Error('no message center');
      await mc.enqueue(sheetId, {
        type: 'setRecord',
        recordId,
        cells: { [fieldId]: value },
        baseVersion: 1,
      });
      await mc.flushAll();
    },
    {
      sheetId: sheet.id,
      recordId: record.id,
      fieldId: field.id,
      value: marker,
    },
  );

  await expect
    .poll(
      async () =>
        pageB.evaluate(
          ({ recordId, fieldId }) => {
            const rows = (
              window as unknown as {
                __stRecordsProbe?: Array<{
                  id: string;
                  cells: Record<string, unknown>;
                }>;
              }
            ).__stRecordsProbe;
            const row = rows?.find((r) => r.id === recordId);
            return String(row?.cells?.[fieldId] ?? '');
          },
          { recordId: record.id, fieldId: field.id },
        ),
      { timeout: 30_000 },
    )
    .toBe(marker);

  await ctxA.close();
  await ctxB.close();
});
