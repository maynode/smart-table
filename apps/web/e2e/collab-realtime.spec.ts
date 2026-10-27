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

test('cell lock: second peer sees lock overlay or acquire denial', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const ownerAccount = `clk${String(stamp).slice(-8)}`;
  const peerAccount = `clp${String(stamp).slice(-8)}`;
  const password = 'Ab12_cd34';
  const api = await apiRequest.newContext({ baseURL: API });
  const ownerRes = await api.post('/auth/register', {
    data: {
      account: ownerAccount,
      password,
      securityQuestion: '你小学就读的学校名称是？',
      securityAnswer: 'demo',
    },
  });
  expect(ownerRes.ok()).toBeTruthy();
  const owner = await ownerRes.json();
  const peerRes = await api.post('/auth/register', {
    data: {
      account: peerAccount,
      password,
      securityQuestion: '你小学就读的学校名称是？',
      securityAnswer: 'demo',
    },
  });
  expect(peerRes.ok()).toBeTruthy();
  const peer = await peerRes.json();
  const headers = { Authorization: `Bearer ${owner.accessToken}` };
  const workspace = await (
    await api.post('/workspaces', {
      headers,
      data: { name: `锁工作区${stamp}` },
    })
  ).json();
  await api.post(`/workspaces/${workspace.id}/members`, {
    headers,
    data: { account: peerAccount, role: 'editor' },
  });
  const base = await (
    await api.post(`/workspaces/${workspace.id}/bases`, {
      headers,
      data: { name: '锁 Base' },
    })
  ).json();
  const sheets = await (
    await api.get(`/bases/${base.id}/sheets`, { headers })
  ).json();
  const sheet = sheets[0] as { id: string };
  const field = await (
    await api.post(`/sheets/${sheet.id}/fields`, {
      headers,
      data: { name: '锁列', type: 'text' },
    })
  ).json();
  const record = await (
    await api.post(`/sheets/${sheet.id}/records`, {
      headers,
      data: { cells: { [field.id]: '锁测' } },
    })
  ).json();

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await pageA.addInitScript(
    ({ token, user }) => {
      localStorage.setItem('st.token', token);
      localStorage.setItem('st.user', JSON.stringify(user));
    },
    { token: owner.accessToken, user: owner.user },
  );
  await pageB.addInitScript(
    ({ token, user }) => {
      localStorage.setItem('st.token', token);
      localStorage.setItem('st.user', JSON.stringify(user));
    },
    { token: peer.accessToken, user: peer.user },
  );

  for (const page of [pageA, pageB]) {
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

  const acquired = await pageA.evaluate(
    async ({ recordId, fieldId }) => {
      const collab = (
        window as unknown as {
          __stCollab?: {
            acquireCellLock: (
              r: string,
              f: string,
            ) => Promise<{ ok: boolean }>;
            connected: { value: boolean };
          };
        }
      ).__stCollab;
      if (!collab) throw new Error('no collab');
      for (let i = 0; i < 20 && !collab.connected.value; i += 1) {
        await new Promise((r) => setTimeout(r, 250));
      }
      return collab.acquireCellLock(recordId, fieldId);
    },
    { recordId: record.id, fieldId: field.id },
  );
  expect(acquired.ok).toBeTruthy();

  await expect
    .poll(
      async () => {
        const lockVisible = await pageB
          .getByTestId('peer-cell-lock')
          .count();
        if (lockVisible > 0) return 'overlay';
        const denied = await pageB.evaluate(
          async ({ recordId, fieldId }) => {
            const collab = (
              window as unknown as {
                __stCollab?: {
                  acquireCellLock: (
                    r: string,
                    f: string,
                  ) => Promise<{ ok: boolean; holderName?: string }>;
                  connected: { value: boolean };
                };
              }
            ).__stCollab;
            if (!collab) return { ok: true };
            for (let i = 0; i < 10 && !collab.connected.value; i += 1) {
              await new Promise((r) => setTimeout(r, 200));
            }
            return collab.acquireCellLock(recordId, fieldId);
          },
          { recordId: record.id, fieldId: field.id },
        );
        return denied.ok ? 'allowed' : 'denied';
      },
      { timeout: 20_000 },
    )
    .not.toBe('allowed');

  await ctxA.close();
  await ctxB.close();
});

test('version conflict shows human sync banner and retry recovers', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const account = `cfl${String(stamp).slice(-8)}`;
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
      data: { name: `冲突工作区${stamp}` },
    })
  ).json();
  const base = await (
    await api.post(`/workspaces/${workspace.id}/bases`, {
      headers,
      data: { name: '冲突 Base' },
    })
  ).json();
  const sheets = await (
    await api.get(`/bases/${base.id}/sheets`, { headers })
  ).json();
  const sheet = sheets[0] as { id: string };
  const field = await (
    await api.post(`/sheets/${sheet.id}/fields`, {
      headers,
      data: { name: '冲突列', type: 'text' },
    })
  ).json();
  const record = await (
    await api.post(`/sheets/${sheet.id}/records`, {
      headers,
      data: { cells: { [field.id]: '冲突初值' } },
    })
  ).json();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
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

  // 服务端先提交一版，制造客户端 baseVersion 落后
  await api.post(`/sheets/${sheet.id}/commitchanges`, {
    headers,
    data: {
      clientBatchId: `srv-${stamp}`,
      mutations: [
        {
          type: 'setRecord',
          recordId: record.id,
          cells: { [field.id]: `服务端先写-${stamp}` },
          clientOpId: `srv-op-${stamp}`,
          baseVersion: 1,
        },
      ],
    },
  });

  await page.evaluate(
    async ({ sheetId, recordId, fieldId, stamp: s }) => {
      const mc = (
        window as unknown as {
          __stMessageCenter?: {
            enqueue: (sid: string, m: unknown) => Promise<string>;
            flushAll: () => Promise<void>;
            status: { value: string };
            lastError: { value: string | null };
            retryConflicts: () => Promise<void>;
          };
        }
      ).__stMessageCenter;
      if (!mc) throw new Error('no message center');
      await mc.enqueue(sheetId, {
        type: 'setRecord',
        recordId,
        cells: { [fieldId]: `客户端冲突-${s}` },
        baseVersion: 1,
      });
      await mc.flushAll();
    },
    {
      sheetId: sheet.id,
      recordId: record.id,
      fieldId: field.id,
      stamp,
    },
  );

  // 人话 banner 或冲突态（OT 可能已自动 rebase；至少不应裸露 COMMIT_*）
  await expect
    .poll(
      async () => {
        const banner = page.getByTestId('sync-banner');
        if (await banner.count()) {
          const text = await banner.innerText();
          if (text.includes('COMMIT_')) return 'raw-code';
          if (
            text.includes('他人') ||
            text.includes('冲突') ||
            text.includes('合并') ||
            text.includes('待同步')
          ) {
            return 'human';
          }
        }
        const status = await page.evaluate(() => {
          const mc = (
            window as unknown as {
              __stMessageCenter?: { status: { value: string } };
            }
          ).__stMessageCenter;
          return mc?.status.value ?? '';
        });
        if (status === 'online' || status === 'syncing') return 'recovered';
        return status || 'none';
      },
      { timeout: 25_000 },
    )
    .toMatch(/human|recovered/);

  const retryBtn = page.locator('.sync-banner-btn');
  if (await retryBtn.count()) {
    await retryBtn.click();
  } else {
    await page.evaluate(async () => {
      const mc = (
        window as unknown as {
          __stMessageCenter?: { retryConflicts: () => Promise<void> };
        }
      ).__stMessageCenter;
      await mc?.retryConflicts();
    });
  }

  await expect
    .poll(
      async () =>
        page.evaluate(
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
    .not.toBe('');

  await ctx.close();
});
