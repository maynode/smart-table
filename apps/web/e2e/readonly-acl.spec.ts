import { expect, test, request as apiRequest } from '@playwright/test';

const API = 'http://127.0.0.1:3000';

test.describe('frontend write gates vs workspace role / object ACL', () => {
  test('viewer: shell hides create/edit entry points and shows readonly banner', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const password = 'Ab12_cd34';
    const ownerAccount = `rov${String(stamp).slice(-8)}`;
    const viewerAccount = `rvv${String(stamp).slice(-8)}`;
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
    const headers = { Authorization: `Bearer ${owner.accessToken}` };

    const viewerRes = await api.post('/auth/register', {
      data: {
        account: viewerAccount,
        password,
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      },
    });
    expect(viewerRes.ok()).toBeTruthy();
    const viewer = await viewerRes.json();

    const workspace = await (
      await api.post('/workspaces', {
        headers,
        data: { name: `只读壳层${stamp}` },
      })
    ).json();
    await api.post(`/workspaces/${workspace.id}/members`, {
      headers,
      data: { account: viewerAccount, role: 'viewer' },
    });
    const base = await (
      await api.post(`/workspaces/${workspace.id}/bases`, {
        headers,
        data: { name: '只读 Base' },
      })
    ).json();
    const sheet = await (
      await api.post(`/bases/${base.id}/sheets`, {
        headers,
        data: { name: '数据表', seed: false },
      })
    ).json();
    await api.post(`/sheets/${sheet.id}/fields`, {
      headers,
      data: { name: '标题', type: 'text' },
    });
    const dashboard = await (
      await api.post(`/bases/${base.id}/dashboards`, {
        headers,
        data: { name: '看板' },
      })
    ).json();

    await page.addInitScript(
      ({ token, user }) => {
        localStorage.setItem('st.token', token);
        localStorage.setItem('st.user', JSON.stringify(user));
      },
      { token: viewer.accessToken, user: viewer.user },
    );

    await page.goto(
      `/workspaces/${workspace.id}/bases/${base.id}?sheet=${sheet.id}`,
    );
    await expect(page.getByTestId('canvas-grid')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('readonly-banner')).toBeVisible();
    await expect(page.getByTestId('add-row')).toHaveCount(0);
    await expect(page.getByTestId('add-field')).toHaveCount(0);
    await expect(page.getByTestId('create-menu')).toHaveCount(0);
    await expect(page.getByTestId('create-sheet')).toHaveCount(0);
    await expect(page.getByTestId('automation-open')).toHaveCount(0);
    await expect(page.getByTestId('forms-open')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-open')).toHaveCount(0);
    await expect(page.getByTestId('report-open')).toHaveCount(0);

    await page.getByTestId('more-open').click();
    await expect(page.getByTestId('more-menu')).toBeVisible();
    await expect(page.getByTestId('public-view-open')).toHaveCount(0);
    await expect(page.getByTestId('more-delete-sheet')).toHaveCount(0);
    await expect(page.getByTestId('permissions-open')).toBeVisible();

    await page
      .getByTestId('dashboard-row')
      .filter({ hasText: dashboard.name })
      .click();
    await expect(page.getByTestId('dashboard-panel')).toBeVisible();
    await expect(page.getByTestId('readonly-banner')).toBeVisible();
    await expect(page.getByTestId('dashboard-ai-toggle')).toHaveCount(0);
  });

  test('editor + sheet ACL view: grid readonly; dashboard still editable', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const password = 'Ab12_cd34';
    const ownerAccount = `roe${String(stamp).slice(-8)}`;
    const editorAccount = `ree${String(stamp).slice(-8)}`;
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
    const headers = { Authorization: `Bearer ${owner.accessToken}` };

    const editorRes = await api.post('/auth/register', {
      data: {
        account: editorAccount,
        password,
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      },
    });
    expect(editorRes.ok()).toBeTruthy();
    const editor = await editorRes.json();

    const workspace = await (
      await api.post('/workspaces', {
        headers,
        data: { name: `对象ACL壳层${stamp}` },
      })
    ).json();
    await api.post(`/workspaces/${workspace.id}/members`, {
      headers,
      data: { account: editorAccount, role: 'editor' },
    });
    const base = await (
      await api.post(`/workspaces/${workspace.id}/bases`, {
        headers,
        data: { name: 'ACL Base' },
      })
    ).json();
    const sheet = await (
      await api.post(`/bases/${base.id}/sheets`, {
        headers,
        data: { name: '只读表', seed: false },
      })
    ).json();
    await api.post(`/sheets/${sheet.id}/fields`, {
      headers,
      data: { name: '标题', type: 'text' },
    });
    const dashboard = await (
      await api.post(`/bases/${base.id}/dashboards`, {
        headers,
        data: { name: '可写看板' },
      })
    ).json();

    const putSheet = await api.put(`/permissions/sheet/${sheet.id}`, {
      headers,
      data: {
        everyone: {
          level: 'view',
          recordRule: { mode: 'all', canAdd: false, canDelete: false },
          fieldRule: { mode: 'all' },
        },
      },
    });
    expect(putSheet.ok()).toBeTruthy();

    await page.addInitScript(
      ({ token, user }) => {
        localStorage.setItem('st.token', token);
        localStorage.setItem('st.user', JSON.stringify(user));
      },
      { token: editor.accessToken, user: editor.user },
    );

    await page.goto(
      `/workspaces/${workspace.id}/bases/${base.id}?sheet=${sheet.id}`,
    );
    await expect(page.getByTestId('canvas-grid')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('readonly-banner')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('add-row')).toHaveCount(0);
    // 工作区仍是 editor：侧栏新建入口保留
    await expect(page.getByTestId('create-menu')).toBeVisible();

    await page
      .getByTestId('dashboard-row')
      .filter({ hasText: dashboard.name })
      .click();
    await expect(page.getByTestId('dashboard-panel')).toBeVisible();
    // 仪表盘默认 full/edit：横幅应消失，配置区可见
    await expect(page.getByTestId('readonly-banner')).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.locator('.widget-builder')).toBeVisible();
  });
});
