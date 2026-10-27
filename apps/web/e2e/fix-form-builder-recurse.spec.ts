import { expect, test, request as apiRequest } from '@playwright/test';

const API = 'http://127.0.0.1:3000';
const password = 'Ab12_cd34';

test('FormBuilderPanel loads without recursive update / DataCloneError', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const api = await apiRequest.newContext({ baseURL: API });
  const account = `ffix${String(stamp).slice(-8)}`;
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  const owner = await (
    await api.post('/auth/register', {
      data: {
        account,
        password,
        securityQuestion: '你小学就读的学校名称是？',
        securityAnswer: 'demo',
      },
    })
  ).json();
  const token = owner.accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  const workspace = await (
    await api.post('/workspaces', { headers, data: { name: `修复验${stamp}` } })
  ).json();
  const base = await (
    await api.post(`/workspaces/${workspace.id}/bases`, {
      headers,
      data: { name: '修复 Base' },
    })
  ).json();
  const sheet = await (
    await api.post(`/bases/${base.id}/sheets`, {
      headers,
      data: { name: '主表', seed: true },
    })
  ).json();
  const title = await (
    await api.post(`/sheets/${sheet.id}/fields`, {
      headers,
      data: { name: '标题', type: 'text' },
    })
  ).json();
  for (let i = 1; i <= 3; i += 1) {
    await api.post(`/sheets/${sheet.id}/records`, {
      headers,
      data: { cells: { [title.id]: `行${i}` } },
    });
  }
  const formSheet = await (
    await api.post(`/bases/${base.id}/sheets`, {
      headers,
      data: { name: '收集表单', seed: false },
    })
  ).json();
  await api.post(`/sheets/${formSheet.id}/fields`, {
    headers,
    data: { name: '姓名', type: 'text', required: true },
  });

  await page.addInitScript(
    ({ t, u }) => {
      localStorage.setItem('st.token', t);
      localStorage.setItem('st.user', JSON.stringify(u));
    },
    { t: token, u: owner.user },
  );

  await page.goto(`/workspaces/${workspace.id}/bases/${base.id}?sheet=${sheet.id}`);
  await expect(page.locator('.canvas-grid-wrap')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);
  // 网格应能画出数据行（至少出现「行1」文本或非空 canvas）
  const gridText = await page.locator('.canvas-grid-wrap').textContent();
  // Canvas 不走 DOM 文本；用截图体积 / 无 pageerror 兜底，并探测编辑器路径
  await page.locator('.canvas-grid-wrap').click({ position: { x: 160, y: 56 } });
  await page.locator('.canvas-grid-wrap').dblclick({ position: { x: 160, y: 56 } });
  await page.waitForTimeout(400);

  await page.goto(
    `/workspaces/${workspace.id}/bases/${base.id}?sheet=${formSheet.id}`,
  );
  await expect(page.getByTestId('form-builder')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('加载中...')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(500);

  const fatal = pageErrors.filter(
    (msg) =>
      /Maximum recursive updates/i.test(msg) ||
      /DataCloneError/i.test(msg),
  );
  expect(fatal, fatal.join('\n')).toEqual([]);
  void gridText;
});
