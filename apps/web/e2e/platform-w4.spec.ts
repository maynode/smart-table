import { expect, test, request as apiRequest } from '@playwright/test';

const API = 'http://127.0.0.1:3000';

test('W4 members, share/more menu and dashboard widgets are real UI', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const password = 'Ab12_cd34';
  const ownerAccount = `w4o${String(stamp).slice(-8)}`;
  const guestAccountName = `w4g${String(stamp).slice(-8)}`;
  const api = await apiRequest.newContext({ baseURL: API });
  const owner = await (
    await api.post('/auth/register', {
      data: {
        account: ownerAccount,
        password,
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      },
    })
  ).json();
  const guest = await (
    await api.post('/auth/register', {
      data: {
        account: guestAccountName,
        password,
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      },
    })
  ).json();
  expect(owner.accessToken).toBeTruthy();
  const headers = { Authorization: `Bearer ${owner.accessToken}` };
  const workspace = await (
    await api.post('/workspaces', { headers, data: { name: 'W4 UI 工作区' } })
  ).json();
  const base = await (
    await api.post(`/workspaces/${workspace.id}/bases`, {
      headers,
      data: { name: 'W4 UI Base' },
    })
  ).json();
  // Use the base seed sheet so dashboard defaults to it (no sheet switch race).
  const sheetList = await (
    await api.get(`/bases/${base.id}/sheets`, { headers })
  ).json();
  const sheet = sheetList[0] as { id: string; name: string };
  const status = await (
    await api.post(`/sheets/${sheet.id}/fields`, {
      headers,
      data: {
        name: '阶段',
        type: 'select',
        options: {
          choices: [
            { id: 'lead', name: '线索', color: 'blue' },
            { id: 'won', name: '赢单', color: 'green' },
          ],
        },
      },
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
    data: { cells: { [status.id]: 'lead', [amount.id]: 100 } },
  });
  await api.post(`/sheets/${sheet.id}/records`, {
    headers,
    data: { cells: { [status.id]: 'won', [amount.id]: 300 } },
  });

  await page.addInitScript(
    ({ token, user }) => {
      localStorage.setItem('st.token', token);
      localStorage.setItem('st.user', JSON.stringify(user));
    },
    { token: owner.accessToken, user: owner.user },
  );
  // 成员是工作区能力：在 Hub 邀请 / 改角色 / 移除，不在表内顶栏。
  await page.goto(`/?ws=${workspace.id}`);
  await page.getByTestId('hub-members').click();
  await expect(page.getByTestId('members-panel')).toBeVisible();
  const guestAccount =
    guest.user.account ?? guest.user.email?.split('@')[0] ?? guest.user.email;
  await page.getByTestId('invite-account').fill(guestAccount);
  await page.getByTestId('invite-submit').click();
  const guestRow = page
    .getByTestId('member-row')
    .filter({ hasText: guestAccount });
  await expect(guestRow).toBeVisible();
  await guestRow.locator('.role-trigger').click();
  await page
    .getByTestId('invite-role-menu')
    .locator('button')
    .filter({ hasText: '只读' })
    .click({ force: true });
  await expect
    .poll(async () => {
      const members = await (
        await api.get(`/workspaces/${workspace.id}/members`, { headers })
      ).json();
      return members.find(
        (member: { userId: string }) => member.userId === guest.user.id,
      )?.role;
    })
    .toBe('viewer');
  await guestRow.getByTitle('移出工作区').click();
  await page.getByTestId('app-dialog-confirm').click();
  await expect
    .poll(async () => {
      const members = await (
        await api.get(`/workspaces/${workspace.id}/members`, { headers })
      ).json();
      return members.some(
        (member: { userId: string }) => member.userId === guest.user.id,
      );
    })
    .toBe(false);

  await page.goto(
    `/workspaces/${workspace.id}/bases/${base.id}?sheet=${sheet.id}`,
  );
  await expect(page.locator('[data-testid="canvas-grid"]')).toBeVisible();

  // Dashboard: add two different chart types, resize, and run a scheduled push.
  await page.getByTestId('dashboard-open').click();
  await expect(page.getByTestId('app-dialog')).toBeVisible();
  await page.getByTestId('app-dialog-input').fill('W4 看板');
  await page.getByTestId('app-dialog-confirm').click();
  await expect(page.getByTestId('dashboard-panel')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('dashboard-row').first()).toBeVisible();

  async function addWidget(
    type: string,
    title: string,
    opts: { metric?: boolean; expectCount: number; text?: string } = {
      expectCount: 1,
    },
  ) {
    await page.getByTestId('dashboard-widget-type').selectOption(type);
    await page.getByTestId('dashboard-widget-title').fill(title);
    if (type === 'text') {
      await page.getByTestId('dashboard-widget-text').fill(opts.text ?? title);
    } else {
      await expect
        .poll(async () =>
          page
            .getByTestId('dashboard-widget-dimension')
            .locator(`option[value="${status.id}"]`)
            .count(),
        )
        .toBe(1);
      await page
        .getByTestId('dashboard-widget-dimension')
        .selectOption(status.id);
      if (opts.metric) {
        await page
          .getByTestId('dashboard-widget-metric')
          .selectOption(amount.id);
        await page
          .getByTestId('dashboard-widget-aggregation')
          .selectOption('sum');
      }
    }
    await page.getByTestId('dashboard-widget-add').click();
    await expect
      .poll(
        async () => page.getByTestId('dashboard-widget-card').count(),
        { timeout: 20_000 },
      )
      .toBe(opts.expectCount);
  }
  await addWidget('pie', '阶段分布', { expectCount: 1 });
  await addWidget('horizontalBar', '阶段条形', { expectCount: 2 });
  await addWidget('text', '说明文字', {
    expectCount: 3,
    text: '仪表盘备注',
  });
  await expect(page.getByTestId('dashboard-text-widget').first()).toContainText(
    '仪表盘备注',
  );
  // Keep two charts for resize/delete assertions.
  await page
    .getByTestId('dashboard-widget-card')
    .nth(2)
    .getByTitle('删除图表')
    .click();
  await page.getByTestId('app-dialog-confirm').click();
  await expect(page.getByTestId('dashboard-widget-card')).toHaveCount(2);

  const dashboardFromApi = async () => {
    const list = await (
      await api.get(`/bases/${base.id}/dashboards`, { headers })
    ).json();
    return (
      await api.get(`/dashboards/${list[0].id}`, { headers })
    ).json();
  };
  await page
    .getByTestId('dashboard-widget-card')
    .first()
    .getByTitle('加宽')
    .click();
  await expect
    .poll(async () => (await dashboardFromApi()).widgets[0].layout.w)
    .toBe(8);
  await page
    .getByTestId('dashboard-widget-card')
    .first()
    .getByTitle('增高')
    .click();
  await expect
    .poll(async () => (await dashboardFromApi()).widgets[0].layout.h)
    .toBe(4);

  await page.getByTestId('dashboard-schedule-cron').fill('*/5 * * * *');
  await page.getByTestId('dashboard-schedule-add').click();
  await expect(page.getByTestId('dashboard-schedule-row')).toHaveCount(1);
  await page.getByTestId('dashboard-schedule-run').click();
  await expect(page.getByTestId('dashboard-schedule-row')).toContainText(
    'success',
  );

  await page
    .getByTestId('dashboard-widget-card')
    .nth(1)
    .getByTitle('删除图表')
    .click();
  await page.getByTestId('app-dialog-confirm').click();
  await expect(page.getByTestId('dashboard-widget-card')).toHaveCount(1);
  await expect
    .poll(async () => (await dashboardFromApi()).widgets.length)
    .toBe(1);
});
