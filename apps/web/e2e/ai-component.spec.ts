import { expect, test, request as apiRequest } from '@playwright/test';

const API = 'http://127.0.0.1:3000';

test.describe('aiComponent field', () => {
  test('chat/generate/publish + gridContract sort; host opens after publish', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const account = `aic${String(stamp).slice(-8)}`;
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
      await api.post('/workspaces', { headers, data: { name: 'AI组件工作区' } })
    ).json();
    const base = await (
      await api.post(`/workspaces/${workspace.id}/bases`, {
        headers,
        data: { name: 'AI Base' },
      })
    ).json();
    const sheet = await (
      await api.post(`/bases/${base.id}/sheets`, {
        headers,
        data: { name: '评分表', seed: false },
      })
    ).json();

    const titleField = await (
      await api.post(`/sheets/${sheet.id}/fields`, {
        headers,
        data: { name: '标题', type: 'text' },
      })
    ).json();
    const ratingField = await (
      await api.post(`/sheets/${sheet.id}/fields`, {
        headers,
        data: {
          name: '评分',
          type: 'aiComponent',
          options: { aiComponent: { status: 'draft' } },
        },
      })
    ).json();

    const badPublish = await api.post(
      `/fields/${ratingField.id}/ai-component/publish`,
      { headers },
    );
    expect(badPublish.status()).toBe(400);

    const chat = await (
      await api.post(`/fields/${ratingField.id}/ai-component/chat`, {
        headers,
        data: { text: '做一个可点击的五星评分' },
      })
    ).json();
    expect(chat.canGenerate).toBeTruthy();

    const generated = await (
      await api.post(`/fields/${ratingField.id}/ai-component/generate`, {
        headers,
      })
    ).json();
    expect(generated.status).toBe('draft');
    expect(generated.gridContract?.sortKey?.path).toBe('rating');
    expect(generated.bundle?.html).toBeTruthy();

    const published = await (
      await api.post(`/fields/${ratingField.id}/ai-component/publish`, {
        headers,
      })
    ).json();
    expect(published.status).toBe('published');

    await api.post(`/sheets/${sheet.id}/records`, {
      headers,
      data: {
        cells: {
          [titleField.id]: '低分',
          [ratingField.id]: { rating: 2 },
        },
      },
    });
    await api.post(`/sheets/${sheet.id}/records`, {
      headers,
      data: {
        cells: {
          [titleField.id]: '高分',
          [ratingField.id]: { rating: 5 },
        },
      },
    });

    const sorted = await (
      await api.post(`/sheets/${sheet.id}/query`, {
        headers,
        data: {
          sorts: [
            { fieldId: ratingField.id, direction: 'desc', mode: 'value' },
          ],
        },
      })
    ).json();
    expect(sorted.records?.[0]?.cells?.[ratingField.id]?.rating).toBe(5);
    expect(sorted.records?.[1]?.cells?.[ratingField.id]?.rating).toBe(2);

    await page.addInitScript(
      ({ token, user }) => {
        localStorage.setItem('st.token', token);
        localStorage.setItem('st.user', JSON.stringify(user));
      },
      { token: session.accessToken, user: session.user },
    );
    await page.goto(
      `/workspaces/${workspace.id}/bases/${base.id}?sheet=${sheet.id}`,
    );
    await expect(page.locator('[data-testid="canvas-grid"]')).toBeVisible({
      timeout: 30_000,
    });

    await page.waitForFunction(
      () =>
        Boolean(window.__gridEngine) &&
        ((window as unknown as { __stRecordsProbe?: unknown[] }).__stRecordsProbe
          ?.length ?? 0) > 0,
      { timeout: 20_000 },
    );

    const hit = await page.evaluate((fieldId) => {
      const engine = window.__gridEngine;
      if (!engine) return null;
      const col = engine.columns.findIndex((c) => c.id === fieldId);
      if (col < 0) return null;
      const cell = engine.cellRect(0, col);
      return {
        x: cell.x + cell.width / 2,
        y: cell.y + cell.height / 2,
      };
    }, ratingField.id);
    expect(hit).toBeTruthy();
    const grid = page.locator('[data-testid="canvas-grid"]');
    const pos = { x: hit!.x, y: hit!.y };
    await grid.click({ position: pos });
    await grid.click({ position: pos });
    await expect(page.getByTestId('ai-component-host')).toBeVisible({
      timeout: 10_000,
    });
  });
});

