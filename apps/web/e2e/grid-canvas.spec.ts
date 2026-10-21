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

  test('edits a cell, comments, and lists members in the shell', async ({
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
        data: { name: '码库' },
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

    // Comments are sheet-scoped and visible in the drawer.
    await page.locator('[data-testid="comments-toggle"]').click();
    await page.locator('[data-testid="comment-input"]').fill('第一条评论');
    await page.locator('[data-testid="comment-send"]').click();
    await expect(page.locator('.comments-drawer')).toContainText('第一条评论');

    // The drawer mask covers the top bar; close it before using 成员.
    await page.locator('.comments-drawer .icon-btn').click();

    // Members dialog reflects the workspace owner.
    await page.getByRole('button', { name: '成员', exact: true }).click();
    await expect(page.locator('.modal')).toContainText('网格测试员');
    await page.locator('.modal .icon-btn').click();

    // Content permissions lists this base's sheet and exposes the ACL editor.
    await page.locator('[data-testid="permissions-open"]').click();
    await expect(page.locator('[data-testid="permissions-panel"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="permission-object-row"]').first(),
    ).toContainText('码库');
    await expect(page.locator('[data-testid="permission-level"]')).toBeVisible();
    await page.locator('[data-testid="permissions-close"]').click();
    await expect(page.locator('[data-testid="permissions-panel"]')).toBeHidden();

    // Dashboard canvas creates an object and exposes chart + schedule builders.
    await page.locator('[data-testid="dashboard-open"]').click();
    await expect(page.locator('[data-testid="dashboard-panel"]')).toBeVisible();
    await page.locator('[data-testid="dashboard-create"]').click();
    await expect(page.locator('[data-testid="dashboard-row"]').first()).toContainText(
      '仪表盘',
    );
    await expect(
      page.locator('[data-testid="dashboard-widget-sheet"]'),
    ).toBeVisible();
    await page.locator('[data-testid="dashboard-close"]').click();

    // Folders nest and can own the current base.
    await page.locator('[data-testid="folder-open"]').click();
    await expect(page.locator('[data-testid="folder-panel"]')).toBeVisible();
    await page.locator('[data-testid="folder-create-name"]').fill('E2E 文件夹');
    await page.locator('[data-testid="folder-create-root"]').click();
    await expect(page.locator('[data-testid="folder-row"]').first()).toContainText(
      'E2E 文件夹',
    );
    await page.locator('[data-testid="folder-move-base"]').click();
    await expect(page.locator('[data-testid="folder-panel"]')).toContainText(
      '序列号领取',
    );
    await page.locator('[data-testid="folder-close"]').click();

    // Cross-workspace sharing UI is available from the top bar.
    await page.locator('[data-testid="share-open"]').click();
    await expect(page.locator('[data-testid="share-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="share-type"]')).toBeVisible();
    await page.locator('[data-testid="share-close"]').click();

    // Template library creates a new base and navigates into it.
    await page.locator('[data-testid="template-open"]').click();
    await expect(page.locator('[data-testid="template-card"]')).toHaveCount(3);
    await page
      .locator('[data-testid="template-card"][data-key="project-tasks"]')
      .locator('[data-testid="template-use"]')
      .click();
    await expect(page.locator('[data-testid="canvas-grid"]')).toBeVisible();
    await expect(page).toHaveURL(/\/bases\/[0-9a-f-]+/);

    // Public read-only link renders a table and offers no editing surface.
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
