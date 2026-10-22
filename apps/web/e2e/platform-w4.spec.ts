import { expect, test, request as apiRequest } from '@playwright/test';

const API = 'http://127.0.0.1:3000';

test('W4 members, share/more menu and dashboard widgets are real UI', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const api = await apiRequest.newContext({ baseURL: API });
  const owner = await (
    await api.post('/auth/register', {
      data: {
        email: `w4-owner-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: 'W4 拥有者',
      },
    })
  ).json();
  const guest = await (
    await api.post('/auth/register', {
      data: {
        email: `w4-guest-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: 'W4 受邀者',
      },
    })
  ).json();
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
  const sheet = await (
    await api.post(`/bases/${base.id}/sheets`, {
      headers,
      data: { name: '商机' },
    })
  ).json();
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
  await page.goto(
    `/workspaces/${workspace.id}/bases/${base.id}?sheet=${sheet.id}`,
  );
  await expect(page.locator('[data-testid="canvas-grid"]')).toBeVisible();

  // Share panel is a real, closable surface.
  await page.getByTestId('share-open').click();
  await expect(page.getByTestId('share-panel')).toBeVisible();
  await page.getByTestId('share-close').click();
  await expect(page.getByTestId('share-panel')).toHaveCount(0);

  // Invite, change role, then remove a workspace member.
  await page.getByTestId('more-open').click();
  await page.getByTestId('more-menu').getByText('成员与邀请').click();
  await expect(page.getByTestId('members-panel')).toBeVisible();
  await page.getByTestId('invite-email').fill(guest.user.email);
  await page.getByTestId('invite-role').selectOption('editor');
  await page.getByTestId('invite-submit').click();
  const guestRow = page
    .getByTestId('member-row')
    .filter({ hasText: guest.user.email });
  await expect(guestRow).toBeVisible();
  await guestRow.getByRole('combobox').selectOption('viewer');
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
  page.once('dialog', (dialog) => dialog.accept());
  await guestRow.getByTitle('移出工作区').click();
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
  await page.getByTestId('members-panel').locator('.icon-btn').first().click();

  // Dashboard: add two different chart types, resize, and run a scheduled push.
  await page.getByTestId('create-menu-toggle').click();
  await page.getByTestId('dashboard-open').click();
  await expect(page.getByTestId('dashboard-panel')).toBeVisible();
  await page.getByTestId('dashboard-create').click();
  await expect(page.getByTestId('dashboard-row').first()).toBeVisible();

  async function addWidget(type: string, title: string, metric: boolean) {
    await page.getByTestId('dashboard-widget-type').selectOption(type);
    await page.getByTestId('dashboard-widget-title').fill(title);
    await page.getByTestId('dashboard-widget-sheet').selectOption(sheet.id);
    await page
      .getByTestId('dashboard-widget-dimension')
      .selectOption(status.id);
    if (metric) {
      await page.getByTestId('dashboard-widget-metric').selectOption(amount.id);
      await page.getByTestId('dashboard-widget-aggregation').selectOption('sum');
    }
    await page.getByTestId('dashboard-widget-add').click();
    await expect(page.getByTestId('dashboard-widget-card')).toHaveCount(
      type === 'pie' ? 1 : 2,
    );
  }
  await addWidget('pie', '阶段分布', false);
  await addWidget('bar', '阶段金额', true);

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

  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByTestId('dashboard-widget-card')
    .nth(1)
    .getByTitle('删除图表')
    .click();
  await expect(page.getByTestId('dashboard-widget-card')).toHaveCount(1);
  await expect
    .poll(async () => (await dashboardFromApi()).widgets.length)
    .toBe(1);
});
