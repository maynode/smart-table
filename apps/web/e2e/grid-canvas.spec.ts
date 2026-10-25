import { expect, test, request as apiRequest } from '@playwright/test';

const API = 'http://127.0.0.1:3000';

test.describe('Canvas grid + enterprise shell', () => {
  test('renders 100k rows through canvas layers with no per-cell DOM', async ({
    page,
  }) => {
    await page.goto('/dev/grid-bench');

    await expect(page.locator('.canvas-grid__layer')).toHaveCount(3);
    await expect(page.locator('.grid-cell')).toHaveCount(0);

    const stats = await page.evaluate(() => window.__gridEngine?.lastFrameStats);
    expect(stats).toBeTruthy();
    expect(stats!.usedOffscreen).toBe(true);
    expect(stats!.cellsDrawn).toBeGreaterThan(0);
    expect(stats!.cellsDrawn).toBeLessThan(600);
    expect(stats!.rows.end).toBeLessThan(60);
  });

  test('edits a cell, comments, and opens content permissions in the shell', async ({
    page,
  }) => {
    const stamp = Date.now();
    const api = await apiRequest.newContext({ baseURL: API });

    const registerResponse = await api.post('/auth/register', {
      data: {
        email: `grid-e2e-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: '网格测试员',
      },
    });
    expect(registerResponse.ok()).toBeTruthy();
    const session = (await registerResponse.json()) as {
      accessToken: string;
      user: { id: string; email: string; name: string };
    };
    const headers = { Authorization: `Bearer ${session.accessToken}` };

    const workspace = await (
      await api.post('/workspaces', {
        headers,
        data: { name: 'E2E 工作区' },
      })
    ).json();
    const base = await (
      await api.post(`/workspaces/${workspace.id}/bases`, {
        headers,
        data: { name: '序列号领取' },
      })
    ).json();
    const sheet = await (
      await api.post(`/bases/${base.id}/sheets`, {
        headers,
        data: { name: '码库', seed: false },
      })
    ).json();

    const serialField = await (
      await api.post(`/sheets/${sheet.id}/fields`, {
        headers,
        data: { name: '序列号', type: 'text' },
      })
    ).json();
    const statusField = await (
      await api.post(`/sheets/${sheet.id}/fields`, {
        headers,
        data: {
          name: '状态',
          type: 'select',
          options: {
            choices: [
              { id: 'unclaimed', name: '未领', color: 'yellow' },
              { id: 'claimed', name: '已领', color: 'green' },
            ],
          },
        },
      })
    ).json();

    await api.post(`/sheets/${sheet.id}/records`, {
      headers,
      data: {
        cells: { [serialField.id]: 'SN-001', [statusField.id]: 'unclaimed' },
      },
    });

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
    await expect(page.locator('[data-testid="canvas-grid"]')).toBeVisible();
    await expect(page.locator('.canvas-grid__layer')).toHaveCount(3);

    // Add a field via WeCom-style type picker.
    await page.locator('[data-testid="add-field"]').click();
    await expect(page.locator('[data-testid="field-type-picker"]')).toBeVisible();
    await page.locator('[data-testid="field-name-input"]').fill('备注');
    await page.locator('[data-testid="field-type-text"]').click();
    await expect(page.locator('[data-testid="field-type-picker"]')).toBeHidden();
    await expect
      .poll(async () => {
        const response = await api.get(`/sheets/${sheet.id}`, { headers });
        const body = (await response.json()) as {
          fields: Array<{ name: string; type: string }>;
        };
        return body.fields.some(
          (field) => field.name === '备注' && field.type === 'text',
        );
      })
      .toBe(true);

    // 列头点击打开列菜单 → 编辑字段 → 字段选择器改名
    await page.locator('[data-testid="canvas-grid"]').click({
      position: { x: 120, y: 20 },
    });
    await expect(page.getByTestId('column-menu')).toBeVisible();
    await page.getByTestId('column-menu-edit').click();
    await expect(page.locator('[data-testid="field-type-picker"]')).toBeVisible();
    await page.locator('[data-testid="field-name-input"]').fill('序列号改');
    await page.locator('[data-testid="field-name-input"]').press('Enter');
    await expect
      .poll(async () => {
        const response = await api.get(`/sheets/${sheet.id}`, { headers });
        const body = (await response.json()) as {
          fields: Array<{ name: string }>;
        };
        return body.fields.some((field) => field.name === '序列号改');
      })
      .toBe(true);

    // Double-click the first data cell (header is 40px; row height 36px).
    await page.locator('[data-testid="canvas-grid"]').dblclick({
      position: { x: 90, y: 58 },
    });
    const editor = page.locator('[data-testid="cell-editor"]');
    await expect(editor).toBeVisible();
    await editor.fill('SN-002');
    await editor.press('Enter');

    await expect
      .poll(async () => {
        const response = await api.get(`/sheets/${sheet.id}/records`, {
          headers,
        });
        const body = (await response.json()) as {
          records: Array<{ cells: Record<string, unknown> }>;
        };
        return body.records[0]?.cells[serialField.id];
      })
      .toBe('SN-002');

    // Comments / permissions / public view live under 更多.
    await page.locator('[data-testid="more-open"]').click();
    await page.locator('[data-testid="comments-toggle"]').click();
    await page.locator('[data-testid="comment-input"]').fill('第一条评论');
    await page.locator('[data-testid="comment-send"]').click();
    await expect(page.locator('.comments-drawer')).toContainText('第一条评论');

    // Close comments before opening content permissions.
    await page.locator('.comments-drawer .icon-btn').click();

    // Content permissions: home lists objects; drill into detail for ACL level.
    await page.locator('[data-testid="more-open"]').click();
    await page.locator('[data-testid="permissions-open"]').click();
    await expect(page.locator('[data-testid="permissions-panel"]')).toBeVisible();
    await page
      .locator('[data-testid="permission-object-row"]')
      .filter({ hasText: '码库' })
      .click();
    await expect(page.locator('[data-testid="permission-level"]')).toBeVisible();
    await page.locator('[data-testid="permissions-close"]').click();
    await expect(page.locator('[data-testid="permissions-panel"]')).toBeHidden();

    // Dashboard canvas creates an object and exposes chart + schedule builders.
    await page.locator('[data-testid="dashboard-open"]').click();
    await page.getByTestId('app-dialog-confirm').click();
    await expect(page.locator('[data-testid="dashboard-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-row"]').first()).toContainText(
      '仪表盘',
    );
    await expect(
      page.locator('[data-testid="dashboard-widget-sheet"]'),
    ).toBeVisible();

    // Object templates add a sheet/dashboard/form/report into the current base.
    await page.locator('[data-testid="template-open"]').click();
    await expect(page.locator('[data-testid="template-card"]').first()).toBeVisible();
    await page
      .locator('[data-testid="template-card"][data-key="obj-sheet-tasks"]')
      .locator('[data-testid="template-use"]')
      .click();
    await page.getByTestId('app-dialog-confirm').click();
    await expect(page.locator('[data-testid="canvas-grid"]')).toBeVisible();
    await expect(page.getByText('项目任务').first()).toBeVisible();

    // Public read-only link renders a table and offers no editing surface.
    await page.locator('[data-testid="more-open"]').click();
    await page.locator('[data-testid="public-view-open"]').click();
    await expect(page.locator('[data-testid="public-view-panel"]')).toBeVisible();
    await page.locator('[data-testid="public-view-close"]').click();
    const viewResponse = await api.post(`/sheets/${sheet.id}/public-views`, {
      headers,
      data: { name: 'E2E 只读视图' },
    });
    const publicView = (await viewResponse.json()) as { token: string };
    await page.goto(`/view/${publicView.token}`);
    await expect(page.locator('[data-testid="public-view-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="cell-editor"]')).toHaveCount(0);

    await api.dispose();
  });
});
