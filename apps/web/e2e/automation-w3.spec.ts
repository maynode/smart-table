import { expect, test, request as apiRequest } from '@playwright/test';

const API = 'http://127.0.0.1:3000';

test('W3 visual automation editor builds a runnable claim chain', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const api = await apiRequest.newContext({ baseURL: API });
  const session = await (
    await api.post('/auth/register', {
      data: {
        email: `w3-auto-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: 'W3 自动化员',
      },
    })
  ).json();
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const workspace = await (
    await api.post('/workspaces', { headers, data: { name: 'W3 工作区' } })
  ).json();
  const base = await (
    await api.post(`/workspaces/${workspace.id}/bases`, {
      headers,
      data: { name: 'W3 Base' },
    })
  ).json();
  const codeSheet = await (
    await api.post(`/bases/${base.id}/sheets`, {
      headers,
      data: { name: '码库', seed: false },
    })
  ).json();
  const leadSheet = await (
    await api.post(`/bases/${base.id}/sheets`, {
      headers,
      data: { name: '领取登记', seed: false },
    })
  ).json();
  async function createField(
    sheetId: string,
    data: Record<string, unknown>,
  ) {
    return (
      await api.post(`/sheets/${sheetId}/fields`, { headers, data })
    ).json() as Promise<{ id: string; name: string }>;
  }
  const codeSerial = await createField(codeSheet.id, {
    name: '序列号',
    type: 'text',
  });
  const codeStatus = await createField(codeSheet.id, {
    name: '状态',
    type: 'select',
    options: {
      choices: [
        { id: 'unclaimed', name: '未领', color: 'yellow' },
        { id: 'claimed', name: '已领', color: 'green' },
      ],
    },
  });
  await createField(leadSheet.id, { name: '手机号', type: 'phone' });
  await api.post(`/sheets/${codeSheet.id}/records`, {
    headers,
    data: { cells: { [codeSerial.id]: 'SN-W3-001', [codeStatus.id]: 'unclaimed' } },
  });

  await page.addInitScript(
    ({ token, user }) => {
      localStorage.setItem('st.token', token);
      localStorage.setItem('st.user', JSON.stringify(user));
    },
    { token: session.accessToken, user: session.user },
  );
  await page.goto(
    `/workspaces/${workspace.id}/bases/${base.id}?sheet=${leadSheet.id}`,
  );
  await page.getByTestId('automation-open').click();
  await expect(page.getByTestId('automation-panel')).toBeVisible();
  await page.getByTestId('automation-create').click();
  await expect(page.getByTestId('automation-editor')).toBeVisible();

  await page.getByTestId('automation-name').fill('W3 领取自动化');
  await page.getByTestId('trigger-sheet').selectOption(leadSheet.id);

  // Step 1: find the first unclaimed code, limit defaults to 1.
  await page.getByTestId('automation-add-step').click();
  await page.getByTestId('add-step-findRecords').click();
  const findStep = page.getByTestId('automation-step-findRecords');
  await findStep.getByTestId('step-sheet').selectOption(codeSheet.id);
  await findStep.getByTestId('step-open-filter').click();
  const filterDialog = page.getByTestId('filter-editor-dialog');
  await filterDialog.getByTestId('step-filter-field').selectOption(codeStatus.id);
  await filterDialog.getByTestId('step-filter-operator').selectOption('equals');
  await filterDialog.getByTestId('step-filter-value').fill('unclaimed');
  await expect(filterDialog.getByTestId('step-filter-limit')).toHaveValue('1');
  await filterDialog.getByRole('button', { name: '完成' }).click();

  // Step 2: modify the found record and bind the prior find step.
  await page.getByTestId('automation-add-step').click();
  await page.getByTestId('add-step-modifyRecords').click();
  const modifyStep = page.getByTestId('automation-step-modifyRecords');
  await modifyStep.getByTestId('step-target-from').selectOption({ index: 1 });
  await modifyStep.getByTestId('step-open-content').click();
  const contentDialog = page.getByTestId('content-editor-dialog');
  const mapping = contentDialog.locator('.mapping-row').first();
  await mapping.locator('select').first().selectOption(codeStatus.id);
  await mapping.locator('select').nth(1).selectOption('literal');
  await mapping.locator('input').fill('claimed');
  await contentDialog.getByRole('button', { name: '完成' }).click();

  // Step 3: send a message with an inserted variable.
  await page.getByTestId('automation-add-step').click();
  await page.getByTestId('add-step-sendMessage').click();
  const messageStep = page.getByTestId('automation-step-sendMessage');
  await messageStep.getByTestId('step-message-text').fill('领取成功 ');
  await messageStep.getByTestId('message-insert-variable').click();
  await page.getByRole('button', { name: /第2步/ }).click();
  await page.getByTestId('variable-submenu').getByRole('button', { name: '序列号' }).click();
  await expect(messageStep.getByTestId('step-message-preview')).toContainText(
    '领取成功',
  );
  await expect(messageStep.getByTestId('step-message-preview')).toContainText(
    '序列号',
  );

  await page.getByTestId('automation-save-enable').click();
  await expect(page.getByTestId('automation-panel')).toBeVisible();

  let automation: any = null;
  await expect
    .poll(async () => {
      const list = await (
        await api.get(`/automations?baseId=${base.id}`, { headers })
      ).json();
      automation = list.find(
        (item: { name: string }) => item.name === 'W3 领取自动化',
      );
      return Boolean(automation);
    })
    .toBe(true);
  expect(automation).toBeTruthy();
  expect(automation.enabled).toBe(true);
  expect(
    automation.steps.map((step: { type: string }) => step.type),
  ).toEqual(['findRecords', 'modifyRecords', 'sendMessage']);
  expect(automation.steps[0].limit).toBe(1);
  expect(automation.steps[0].filters.conditions[0]).toMatchObject({
    fieldId: codeStatus.id,
    operator: 'equals',
    value: 'unclaimed',
  });
  expect(automation.steps[1].target).toEqual({
    mode: 'fromStep',
    stepId: automation.steps[0].id,
  });
  expect(automation.steps[1].cells[codeStatus.id]).toEqual({
    kind: 'literal',
    value: 'claimed',
  });
  expect(automation.steps[2].content.text).toBe('领取成功 {{第2步.序列号}}');

  // Enable/disable round-trips through the real API.
  await page.getByTestId('automation-toggle').first().click();
  await expect
    .poll(async () => {
      const list = await (
        await api.get(`/automations?baseId=${base.id}`, { headers })
      ).json();
      return list.find(
        (item: { name: string }) => item.name === 'W3 领取自动化',
      )?.enabled;
    })
    .toBe(false);
  await page.getByTestId('automation-toggle').first().click();
  await expect
    .poll(async () => {
      const list = await (
        await api.get(`/automations?baseId=${base.id}`, { headers })
      ).json();
      return list.find(
        (item: { name: string }) => item.name === 'W3 领取自动化',
      )?.enabled;
    })
    .toBe(true);

  // Trigger the chain by creating a lead record through the real API.
  // Blank-sheet seed rows sit ahead of our SN row — assert by serial, not [0].
  await api.post(`/sheets/${leadSheet.id}/records`, {
    headers,
    data: { cells: {} },
  });
  await expect
    .poll(
      async () => {
        const records = await (
          await api.get(`/sheets/${codeSheet.id}/records`, { headers })
        ).json();
        const target = (records.records as Array<{ cells?: Record<string, unknown> }>).find(
          (row) => row.cells?.[codeSerial.id] === 'SN-W3-001',
        );
        return target?.cells?.[codeStatus.id];
      },
      { timeout: 30_000 },
    )
    .toBe('claimed');

  await page.getByTestId('automation-more').first().click();
  await page.getByTestId('automation-runs-open').click();
  await expect(page.getByTestId('automation-runs-panel')).toBeVisible();
  const runRow = page.getByTestId('automation-run-row').first();
  await expect(runRow).toHaveAttribute('data-status', 'success');
  await runRow.getByRole('button', { name: '详情' }).click();
  await expect(page.locator('.run-detail-row')).toContainText('查找记录');
  await expect(page.locator('.run-detail-row')).toContainText('修改记录');
  await expect(page.locator('.run-detail-row')).toContainText('发送消息');

  await page.getByTestId('automation-runs-back').click();

  // Edit and delete are real CRUD operations.
  await page.getByTestId('automation-more').first().click();
  await page.getByTestId('automation-edit').click();
  await page.getByTestId('automation-name').fill('W3 领取自动化（已编辑）');
  await page.getByTestId('automation-save').click();
  await expect
    .poll(async () => {
      const list = await (
        await api.get(`/automations?baseId=${base.id}`, { headers })
      ).json();
      return list.some(
        (item: { name: string }) => item.name === 'W3 领取自动化（已编辑）',
      );
    })
    .toBe(true);
  await page.getByTestId('automation-more').first().click();
  await page.getByTestId('automation-delete').click();
  await page.getByTestId('app-dialog-confirm').click();
  await expect
    .poll(async () => {
      const list = await (
        await api.get(`/automations?baseId=${base.id}`, { headers })
      ).json();
      return list.length;
    })
    .toBe(0);
});
