import { expect, test, request as apiRequest } from '@playwright/test';

const API = 'http://127.0.0.1:3000';

test('W2 visual form builder: fields, cover, conditions, share, success preview', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const api = await apiRequest.newContext({ baseURL: API });
  const session = await (
    await api.post('/auth/register', {
      data: {
        email: `w2-form-${stamp}@example.com`,
        password: 'Passw0rd!123',
        name: 'W2 表单员',
      },
    })
  ).json();
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const workspace = await (
    await api.post('/workspaces', { headers, data: { name: 'W2 工作区' } })
  ).json();
  const base = await (
    await api.post(`/workspaces/${workspace.id}/bases`, {
      headers,
      data: { name: 'W2 Base' },
    })
  ).json();
  // 产品模型：收集表单是独立 sheet（名「收集表单」），不再对普通表弹 FormBuilder
  const sheet = await (
    await api.post(`/bases/${base.id}/sheets`, {
      headers,
      data: { name: '收集表单', seed: false },
    })
  ).json();
  async function createField(data: Record<string, unknown>) {
    return (
      await api.post(`/sheets/${sheet.id}/fields`, { headers, data })
    ).json() as Promise<{ id: string; name: string }>;
  }
  const nameField = await createField({ name: '姓名', type: 'text', required: true });
  await createField({ name: '手机号', type: 'phone' });
  const statusField = await createField({
    name: '状态',
    type: 'select',
    options: {
      choices: [
        { id: 'won', name: '到访', color: 'green' },
        { id: 'new', name: '未到访', color: 'gray' },
      ],
    },
  });
  const noteField = await createField({ name: '备注', type: 'text' });

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
  await expect(page.getByTestId('form-builder')).toBeVisible();
  await expect(page.getByTestId(`form-field-${noteField.id}`)).toBeVisible();

  await page.getByTestId('form-name-input').fill('到访登记表');

  // Remove and re-add a field to prove visual field management.
  await page.getByTestId(`form-remove-${noteField.id}`).click();
  await expect(page.getByTestId(`form-field-${noteField.id}`)).toHaveCount(0);
  await page.locator('.available-row', { hasText: '备注' }).click();
  await expect(page.getByTestId(`form-field-${noteField.id}`)).toBeVisible();

  // Reorder: move 备注 above 状态, then select it and add a display condition.
  const noteRow = page.getByTestId(`form-field-${noteField.id}`);
  await noteRow.locator('button[title="上移"]').click();
  await noteRow.click();
  await expect(page.getByTestId('form-field-settings')).toBeVisible();
  await page.getByTestId('form-add-condition').click();
  await page.getByTestId('form-condition-field').selectOption(statusField.id);
  await page.getByTestId('form-condition-operator').selectOption('equals');
  await page.getByTestId('form-condition-value').fill('won');
  await page.getByTestId(`form-required-${noteField.id}`).check();

  await expect(page.getByTestId('form-success-hint')).toContainText('发送消息');
  await page.getByTestId('form-audience').selectOption('workspace');
  await page.getByTestId('form-expires-at').fill('2026-12-31');
  await page.getByTestId('form-cover-input').setInputFiles({
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.locator('.cover-preview')).toBeVisible();
  await page.getByTestId('form-builder-save').click();
  // 嵌入模式分享链接在「分享表单」对话框里
  await page.getByTestId('form-share-open').click();
  await expect(page.getByTestId('form-share-url-dialog')).toContainText('/fill/');
  await expect(page.getByTestId('form-share-qr-dialog')).toBeVisible();
  await page.getByTestId('form-share-dialog').getByLabel('关闭').click();

  await expect
    .poll(async () => {
      const forms = await (
        await api.get(`/forms?baseId=${base.id}`, { headers })
      ).json();
      const form = forms[0];
      return {
        name: form?.name,
        audience: form?.share?.audience,
        expires: Boolean(form?.share?.expiresAt),
        cover: Boolean(form?.coverUrl),
        order: form?.fields?.map((item: { fieldId: string }) => item.fieldId),
        condition:
          form?.fields?.find(
            (item: { fieldId: string }) => item.fieldId === noteField.id,
          )?.displayConditions?.[0],
        required:
          form?.fields?.find(
            (item: { fieldId: string }) => item.fieldId === noteField.id,
          )?.required,
      };
    })
    .toMatchObject({
      name: '到访登记表',
      audience: 'workspace',
      expires: true,
      cover: true,
      required: true,
      condition: {
        fieldId: statusField.id,
        operator: 'equals',
        value: 'won',
      },
    });
  await expect
    .poll(async () => {
      const forms = await (
        await api.get(`/forms?baseId=${base.id}`, { headers })
      ).json();
      return forms[0]?.fields?.findIndex(
        (item: { fieldId: string }) => item.fieldId === noteField.id,
      );
    })
    .toBeLessThan(3);

  await page.getByTestId('form-tab-fill').click();
  await expect(page.getByTestId('form-success-preview')).toContainText(
    '发送消息',
  );

  // Switch back to anyone so the public fill flow can run unauthenticated.
  await page.getByTestId('form-tab-edit').click();
  await page.getByTestId('form-audience').selectOption('anyone');
  await page.getByTestId('form-builder-save').click();
  await expect
    .poll(async () => {
      const forms = await (
        await api.get(`/forms?baseId=${base.id}`, { headers })
      ).json();
      return forms[0]?.share?.audience;
    })
    .toBe('anyone');

  // Public form respects the visual display condition.
  await page.getByTestId('form-share-open').click();
  const shareUrl = await page.getByTestId('form-share-url-dialog').textContent();
  await page.goto(shareUrl!.trim());
  await expect(page.getByRole('heading', { name: '到访登记表' })).toBeVisible();
  await expect(page.locator('[data-field-name="备注"]')).toHaveCount(0);
  // 文本字段公开填写页用 textarea
  await page.locator('[data-field-name="姓名"] textarea').fill('张三');
  await page.getByTestId('form-select').selectOption('won');
  await expect(page.locator('[data-field-name="备注"]')).toBeVisible();
  await page.locator('[data-field-name="备注"] textarea').fill('已到访');
  await page.getByTestId('form-submit').click();
  await expect(page.getByTestId('form-success')).toContainText('提交成功');
});
