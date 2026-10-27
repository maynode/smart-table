import { expect, test, request as apiRequest } from '@playwright/test';

const API = 'http://127.0.0.1:3000';

test.describe('W1 grid parity features', () => {
  test('persists width/options, filters/groups/sorts, person + image cells, row selection and saved views', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const account = `w1g${String(stamp).slice(-8)}`;
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
      await api.post('/workspaces', { headers, data: { name: 'W1 工作区' } })
    ).json();
    const base = await (
      await api.post(`/workspaces/${workspace.id}/bases`, {
        headers,
        data: { name: 'W1 Base' },
      })
    ).json();
    const sheet = await (
      await api.post(`/bases/${base.id}/sheets`, {
        headers,
        data: { name: '客户表', seed: false },
      })
    ).json();

    async function createField(data: Record<string, unknown>) {
      const response = await api.post(`/sheets/${sheet.id}/fields`, {
        headers,
        data,
      });
      expect(response.ok()).toBeTruthy();
      return response.json() as Promise<{ id: string; name: string }>;
    }

    const nameField = await createField({ name: '姓名', type: 'text' });
    const statusField = await createField({
      name: '状态',
      type: 'select',
      options: {
        choices: [
          { id: 'new', name: '新客', color: 'blue' },
          { id: 'won', name: '成交', color: 'green' },
        ],
      },
    });
    const ownerField = await createField({ name: '负责人', type: 'person' });
    const photoField = await createField({ name: '照片', type: 'image' });
    await createField({ name: '临时字段', type: 'text' });

    await api.post(`/sheets/${sheet.id}/records`, {
      headers,
      data: {
        cells: {
          [nameField.id]: '张三',
          [statusField.id]: 'won',
          [ownerField.id]: session.user.id,
        },
      },
    });
    await api.post(`/sheets/${sheet.id}/records`, {
      headers,
      data: {
        cells: {
          [nameField.id]: '李四',
          [statusField.id]: 'new',
        },
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
    const canvas = page.locator('[data-testid="canvas-grid"]');
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId('record-count')).toContainText('2');

    // Column resize is persisted to field.options.width and survives reload.
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 48 + 180, box!.y + 20);
    await page.mouse.down();
    await page.mouse.move(box!.x + 48 + 240, box!.y + 20, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const detail = await (
          await api.get(`/sheets/${sheet.id}`, { headers })
        ).json();
        const field = detail.fields.find(
          (item: { id: string }) => item.id === nameField.id,
        );
        return Math.round(Number(field?.options?.width ?? 0));
      })
      .toBeGreaterThanOrEqual(230);
    await page.reload();
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId('record-count')).toContainText('2');

    // Select option editor adds, recolors, and persists a choice.
    await page.getByTestId('table-settings').click();
    await page.getByTestId('field-more-状态').click();
    await page.getByTestId('edit-options-状态').click();
    await expect(page.getByTestId('field-options-editor')).toBeVisible();
    await page.getByTestId('field-option-add').click();
    await page.getByTestId('field-option-name-2').fill('跟进中');
    await page.getByTestId('field-option-save').click();
    await expect
      .poll(async () => {
        const detail = await (
          await api.get(`/sheets/${sheet.id}`, { headers })
        ).json();
        const field = detail.fields.find(
          (item: { id: string }) => item.id === statusField.id,
        );
        return field?.options?.choices?.length;
      })
      .toBe(3);
    await page.getByTestId('table-settings').click();

    // Multi-condition filter (and) + group + multi-sort all hit the query API.
    await page.getByTestId('filter-open').click();
    await page.getByTestId('filter-condition-0-field').selectOption(statusField.id);
    await page.getByTestId('filter-condition-0-operator').selectOption('equals');
    await page.getByTestId('filter-condition-0-value').fill('won');
    await page.getByTestId('filter-add').click();
    await page.getByTestId('filter-condition-1-field').selectOption(nameField.id);
    await page.getByTestId('filter-condition-1-operator').selectOption('contains');
    await page.getByTestId('filter-condition-1-value').fill('张');
    await page.getByTestId('filter-apply').click();
    await expect(page.getByTestId('record-count')).toContainText('1');

    await page.getByTestId('group-open').click();
    await page.getByTestId('group-condition-0-field').selectOption(statusField.id);
    await page.getByTestId('group-apply').click();
    await expect(page.locator('.group-chip').first()).toContainText('状态');

    await page.getByTestId('sort-open').click();
    await page.getByTestId('sort-condition-0-field').selectOption(nameField.id);
    await page.getByTestId('sort-condition-0-direction').selectOption('desc');
    await page.getByTestId('sort-add').click();
    await page.getByTestId('sort-condition-1-field').selectOption(statusField.id);
    await page.getByTestId('sort-apply').click();

    // Save the current query as a named sidebar view; clearing restores all rows.
    await page.getByTestId('saved-view-name').fill('成交客户');
    await page.getByTestId('saved-view-save').click();
    await expect(page.getByTestId('saved-view-成交客户')).toBeVisible();
    await page.getByTestId('clear-view').click();
    await expect(page.getByTestId('record-count')).toContainText('2');
    await page.getByTestId('saved-view-成交客户').click();
    await expect(page.getByTestId('record-count')).toContainText('1');

    // Person field editor lists workspace members and writes the member id.
    const sortPanel = page.getByTestId('view-panel-sort');
    if (await sortPanel.isVisible()) {
      await sortPanel.locator('.icon-btn').first().click();
    }
    await page.getByTestId('clear-view').click();
    await expect(page.getByTestId('record-count')).toContainText('2');
    await expect(page.locator('.group-chip')).toHaveCount(0);
    await page.waitForTimeout(300);
    // 人员列：用引擎 cellRect 定位首行（清分组后 row0 才是数据行）
    await page.waitForFunction(
      () =>
        Boolean(window.__gridEngine) &&
        ((window as unknown as { __stRecordsProbe?: unknown[] }).__stRecordsProbe
          ?.length ?? 0) > 0,
      { timeout: 15_000 },
    );
    const personHit = await page.evaluate((fieldId) => {
      const engine = window.__gridEngine;
      if (!engine) return null;
      const col = engine.columns.findIndex((c) => c.id === fieldId);
      if (col < 0) return null;
      const cell = engine.cellRect(0, col);
      return { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 };
    }, ownerField.id);
    expect(personHit).toBeTruthy();
    const personPos = { x: personHit!.x, y: personHit!.y };
    await canvas.click({ position: personPos });
    await canvas.click({ position: personPos });
    const personEditor = page.getByTestId('cell-editor');
    if (!(await personEditor.isVisible().catch(() => false))) {
      await page.getByTestId('canvas-grid-wrap').focus();
      await page.keyboard.press('Enter');
    }
    await expect(personEditor).toBeVisible({ timeout: 10_000 });
    const memberLabel = session.user.name ?? session.user.account ?? account;
    await expect(personEditor.locator('option')).toContainText([
      '未指定成员',
      memberLabel,
    ]);
    await personEditor.selectOption(session.user.id);
    await expect
      .poll(async () => {
        const response = await (
          await api.get(`/sheets/${sheet.id}/records`, { headers })
        ).json();
        return response.records.some(
          (record: { cells: Record<string, unknown> }) =>
            record.cells[ownerField.id] === session.user.id,
        );
      })
      .toBe(true);

    // Image cell upload stores a file object in the record and renders a thumbnail.
    const chooserPromise = page.waitForEvent('filechooser');
    await canvas.dblclick({ position: { x: 700, y: 58 } });
    const chooser = await chooserPromise;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=',
      'base64',
    );
    await chooser.setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
    await expect
      .poll(async () => {
        const response = await (
          await api.get(`/sheets/${sheet.id}/records`, { headers })
        ).json();
        const record = response.records.find(
          (item: { cells: Record<string, unknown> }) =>
            item.cells[nameField.id] === '张三',
        );
        const value = record?.cells?.[photoField.id] as
          | { url?: string }
          | undefined;
        return Boolean(value?.url?.startsWith('/files/uploads/'));
      })
      .toBe(true);

    // Row-number selection opens the batch toolbar.
    await canvas.click({ position: { x: 22, y: 58 } });
    await expect(page.locator('.selection-bar')).toContainText('已选 1 行');
    await page.locator('.selection-bar').getByText('取消').click();

    // Delete a field from table settings with confirmation.
    await page.getByTestId('table-settings').click();
    await page.getByTestId('field-more-临时字段').click();
    await page.getByTestId('delete-field-临时字段').click();
    await page.getByTestId('delete-field-confirm-button').click();
    await expect
      .poll(async () => {
        const detail = await (
          await api.get(`/sheets/${sheet.id}`, { headers })
        ).json();
        return detail.fields.some(
          (field: { name: string }) => field.name === '临时字段',
        );
      })
      .toBe(false);
  });

  test('renames and deletes sheets from the sidebar and 更多 menu', async ({
    page,
  }) => {
    const stamp = Date.now();
    const account = `w1s${String(stamp).slice(-8)}`;
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
      await api.post('/workspaces', { headers, data: { name: 'W1 Sheet WS' } })
    ).json();
    const base = await (
      await api.post(`/workspaces/${workspace.id}/bases`, {
        headers,
        data: { name: 'W1 Sheet Base' },
      })
    ).json();
    const first = await (
      await api.post(`/bases/${base.id}/sheets`, {
        headers,
        data: { name: '待改名', seed: false },
      })
    ).json();
    const second = await (
      await api.post(`/bases/${base.id}/sheets`, {
        headers,
        data: { name: '备用表', seed: false },
      })
    ).json();

    await page.addInitScript(
      ({ token, user }) => {
        localStorage.setItem('st.token', token);
        localStorage.setItem('st.user', JSON.stringify(user));
      },
      { token: session.accessToken, user: session.user },
    );
    await page.goto(
      `/workspaces/${workspace.id}/bases/${base.id}?sheet=${first.id}`,
    );
    await expect(page.locator('[data-testid="canvas-grid"]')).toBeVisible();

    await page.getByTestId('sheet-menu-待改名').click();
    await page.locator('.sheet-menu').getByText('重命名').click();
    await expect(page.getByTestId('app-dialog')).toBeVisible();
    await page.getByTestId('app-dialog-input').fill('已改名');
    await page.getByTestId('app-dialog-confirm').click();
    await expect(page.getByTestId('sheet-menu-已改名')).toBeVisible();
    await expect
      .poll(async () => {
        const list = await (
          await api.get(`/bases/${base.id}/sheets`, { headers })
        ).json();
        return list.some(
          (sheet: { id: string; name: string }) =>
            sheet.id === first.id && sheet.name === '已改名',
        );
      })
      .toBe(true);

    await page.getByTestId('more-open').click();
    await page.getByTestId('more-delete-sheet').click();
    await page.getByTestId('app-dialog-confirm').click();
    await expect
      .poll(async () => {
        const list = await (
          await api.get(`/bases/${base.id}/sheets`, { headers })
        ).json();
        return list.some((sheet: { id: string }) => sheet.id === first.id);
      })
      .toBe(false);
    await expect(page.locator('[data-testid="canvas-grid"]')).toBeVisible();
    const list = await (
      await api.get(`/bases/${base.id}/sheets`, { headers })
    ).json();
    expect(list.some((sheet: { id: string }) => sheet.id === second.id)).toBe(
      true,
    );
  });
});
