import { expect, test, request as apiRequest } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test('record list cards do not clip meta', async ({ page }) => {
  test.setTimeout(120_000);
  const api = await apiRequest.newContext({ baseURL: 'http://127.0.0.1:3000' });
  const stamp = Date.now();
  const account = `rcl${String(stamp).slice(-8)}`;
  const password = 'Ab12_cd34';
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
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const workspace = await (
    await api.post('/workspaces', { headers, data: { name: '卡列表' } })
  ).json();
  const base = await (
    await api.post(`/workspaces/${workspace.id}/bases`, {
      headers,
      data: { name: '卡' },
    })
  ).json();
  const sheet = await (
    await api.post(`/bases/${base.id}/sheets`, {
      headers,
      data: { name: '码库', seed: false },
    })
  ).json();
  const serial = await (
    await api.post(`/sheets/${sheet.id}/fields`, {
      headers,
      data: { name: '序列号', type: 'text' },
    })
  ).json();
  const status = await (
    await api.post(`/sheets/${sheet.id}/fields`, {
      headers,
      data: {
        name: '状态',
        type: 'select',
        options: {
          choices: [
            { id: 'claimed', name: '已领', color: 'green' },
            { id: 'open', name: '未领', color: 'yellow' },
          ],
        },
      },
    })
  ).json();
  const phone = await (
    await api.post(`/sheets/${sheet.id}/fields`, {
      headers,
      data: { name: '领取手机号', type: 'phone' },
    })
  ).json();
  for (let i = 1; i <= 8; i++) {
    await api.post(`/sheets/${sheet.id}/records`, {
      headers,
      data: {
        cells: {
          [serial.id]: `DEMO-${String(i).padStart(4, '0')}`,
          [status.id]: 'claimed',
          [phone.id]: `1370000${1000 + i}`,
        },
      },
    });
  }

  await page.addInitScript(
    ({ token, user }) => {
      localStorage.setItem('st.token', token);
      localStorage.setItem('st.user', JSON.stringify(user));
    },
    { token: session.accessToken, user: session.user },
  );
  await page.goto(
    `/workspaces/${workspace.id}/bases/${base.id}?face=data&sheet=${sheet.id}&oid=${sheet.id}`,
  );
  await expect(page.getByTestId('base-face-tabs')).toBeVisible({
    timeout: 60_000,
  });
  // Ensure list layout (default) even if a prior run left compact in memory.
  const listBtn = page.getByTestId('phone-layout-list');
  if (await listBtn.isVisible().catch(() => false)) {
    await listBtn.click();
  }
  await expect(page.getByTestId('record-list')).toBeVisible({
    timeout: 60_000,
  });
  const card = page.locator('[data-testid^="record-card-"]').first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText('DEMO-0001', { timeout: 15_000 });
  const out = resolve(process.cwd(), '../../.data/mobile-audit');
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: resolve(out, 'record-list-cards-fixed.png') });

  const html = await card.innerHTML();
  expect(html, html).toMatch(/状态|已领|领取手机号|137/);
  await expect(card.locator('.record-card-meta')).toBeVisible();

  const box = await card.boundingBox();
  const titleBox = await card.locator('.record-card-title').boundingBox();
  const metaBox = await card.locator('.record-card-meta').boundingBox();
  expect(box && titleBox && metaBox).toBeTruthy();
  expect(metaBox!.y).toBeGreaterThan(titleBox!.y + titleBox!.height - 1);
  expect(metaBox!.y + metaBox!.height).toBeLessThanOrEqual(
    box!.y + box!.height + 1,
  );

  const second = page.locator('[data-testid^="record-card-"]').nth(1);
  const secondBox = await second.boundingBox();
  expect(secondBox!.y).toBeGreaterThanOrEqual(box!.y + box!.height - 1);
});
