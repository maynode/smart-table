import { expect, test, request as apiRequest } from '@playwright/test';

const API = 'http://127.0.0.1:3000';

test('W2 visual form builder: fields, cover, conditions, share, success preview', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const account = `w2f${String(stamp).slice(-8)}`;
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
  await page.getByTestId('form-name-input').blur();
  await expect
    .poll(async () => {
      const forms = await (
        await api.get(`/forms?baseId=${base.id}`, { headers })
      ).json();
      return forms[0]?.name;
    })
    .toBe('到访登记表');

  // Remove and re-add a field to prove visual field management.
  await page.getByTestId(`form-remove-${noteField.id}`).click();
  await expect(page.getByTestId(`form-field-${noteField.id}`)).toHaveCount(0);
  await page.locator('.available-row', { hasText: '备注' }).click();
  await expect(page.getByTestId(`form-field-${noteField.id}`)).toBeVisible();

  // Reorder: move 备注 above 状态, then select it and add a display condition.
  await page
    .getByTestId(`form-field-${noteField.id}`)
    .locator('button[title="上移"]')
    .click();
  // 上移会重排 DOM，重新取行
  const noteRow = page.getByTestId(`form-field-${noteField.id}`);
  await noteRow.click({ force: true });
  const settings = page.getByTestId('form-field-settings');
  await expect(settings).toBeVisible({ timeout: 15_000 });
  await settings.getByTestId('form-add-condition').click({ force: true });
  const conditionRow = settings.getByTestId('form-condition-row').last();
  // Vue 受控 select 在重渲染下对 Playwright selectOption 易挂死：直接派发 change
  await conditionRow.getByTestId('form-condition-field').evaluate((el, id) => {
    const select = el as HTMLSelectElement;
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, statusField.id);
  await expect(conditionRow.getByTestId('form-condition-field')).toHaveValue(
    statusField.id,
  );
  await expect(conditionRow.getByTestId('form-condition-operator')).toHaveValue(
    'equals',
  );
  await conditionRow.getByTestId('form-condition-value').fill('won');
  // 必填勾选在 field-row-actions，常需 hover / force
  await noteRow.hover();
  await noteRow.getByTestId(`form-required-${noteField.id}`).check({ force: true });
  await expect(
    page.getByTestId(`form-required-${noteField.id}`),
  ).toBeChecked();

  // 封面上传会自动 save：先传封面，再改 audience/到期，避免被自动保存盖掉
  await page.getByTestId('form-cover-input').setInputFiles({
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.locator('.cover-preview')).toBeVisible();
  await expect
    .poll(async () => {
      const forms = await (
        await api.get(`/forms?baseId=${base.id}`, { headers })
      ).json();
      return Boolean(forms[0]?.coverUrl);
    })
    .toBe(true);
  // 封面自动保存结束后再改分享配置，并重新确认必填（防 live 回刷）
  await noteRow.hover();
  await noteRow.getByTestId(`form-required-${noteField.id}`).check({ force: true });
  await page.getByTestId('form-audience').selectOption('workspace');
  await page.getByTestId('form-expires-at').fill('2026-12-31');
  await expect(page.getByTestId('form-audience')).toHaveValue('workspace');
  await expect(page.getByTestId('form-expires-at')).toHaveValue('2026-12-31');
  await expect(
    page.getByTestId(`form-required-${noteField.id}`),
  ).toBeChecked();
  // 嵌入模式分享链接在「分享表单」对话框里（填写设置已自动保存）
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
        condition: (() => {
          const field = form?.fields?.find(
            (item: { fieldId: string }) => item.fieldId === noteField.id,
          );
          return (
            field?.displayConditions?.[0] ??
            field?.displayRule?.conditions?.[0]
          );
        })(),
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

  // Switch back to anyone so the public fill flow can run unauthenticated.
  await page.getByTestId('form-tab-edit').click();
  await page.getByTestId('form-audience').selectOption('anyone');
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
  const shareRaw =
    (await page.getByTestId('form-share-url-dialog').textContent()) ?? '';
  const shareMatch = shareRaw.match(/https?:\/\/\S+\/fill\/\S+/);
  const shareUrl = (shareMatch?.[0] ?? shareRaw).trim();
  expect(shareUrl).toContain('/fill/');
  const token = shareUrl.split('/fill/')[1]?.split(/[?#]/)[0];
  expect(token).toBeTruthy();
  await expect
    .poll(async () => {
      const pub = await (await api.get(`/public/forms/${token}`)).json();
      const note = pub.fields?.find(
        (item: { fieldId: string }) => item.fieldId === noteField.id,
      );
      return (
        note?.displayRule?.conditions?.[0] ?? note?.displayConditions?.[0]
      );
    })
    .toMatchObject({
      fieldId: statusField.id,
      operator: 'equals',
      value: 'won',
    });
  await page.goto(shareUrl);
  await expect(page.getByRole('heading', { name: '到访登记表' })).toBeVisible();
  await expect(page.locator('[data-field-name="备注"]')).toHaveCount(0);
  // 文本字段公开填写页用 textarea
  await page.locator('[data-field-name="姓名"] textarea').fill('张三');
  const statusSelect = page.getByTestId('form-select');
  await expect(statusSelect.locator('option[value="won"]')).toHaveCount(1);
  await statusSelect.selectOption('won');
  await expect(statusSelect).toHaveValue('won');
  await expect(page.locator('[data-field-name="备注"]')).toBeVisible({
    timeout: 15_000,
  });
  await page.locator('[data-field-name="备注"] textarea').fill('已到访');
  const submitResponse = page.waitForResponse(
    (res) =>
      res.url().includes(`/public/forms/${token}/submit`) &&
      res.request().method() === 'POST',
    { timeout: 20_000 },
  );
  await page.getByTestId('form-submit').click();
  const submitted = await submitResponse;
  const submitBody = await submitted.json().catch(() => null);
  expect(
    submitted.ok(),
    `submit ${submitted.status()} ${JSON.stringify(submitBody)}`,
  ).toBeTruthy();
  await expect(page.getByTestId('form-success')).toBeVisible({
    timeout: 20_000,
  });
  // 成功页可能是默认模板或自动化「发送消息」正文
  await expect(page.getByTestId('form-success')).toContainText(
    /提交成功|发送消息|序列号/,
  );
});
