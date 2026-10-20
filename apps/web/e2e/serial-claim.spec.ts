import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

interface SeedSummary {
  shareUrl: string;
  workspaceId: string;
  baseId: string;
  formId: string;
  demoEmail: string;
  demoPassword: string;
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const summaryPath = resolve(repoRoot, '.data/serial-claim-seed.json');

let seed: SeedSummary;

test.beforeAll(() => {
  execSync('pnpm --filter api seed:serial-claim', {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  });
  seed = JSON.parse(readFileSync(summaryPath, 'utf8')) as SeedSummary;
});

test('share link claims a serial and the admin sees the automation run', async ({
  page,
  browser,
}) => {
  const share = new URL(seed.shareUrl);
  share.host = '127.0.0.1:5173';

  await page.goto(share.toString());
  await expect(
    page.getByRole('heading', { name: '序列号领取' }),
  ).toBeVisible();

  // Unique phone per run so the duplicate guard does not reject reruns.
  const phone = `137${String(Date.now()).slice(-8)}`;
  await page.locator('[data-field-name="手机号"] input').fill(phone);
  await page.getByTestId('form-submit').click();

  const success = page.getByTestId('form-success');
  await expect(success).toBeVisible({ timeout: 20_000 });
  await expect(success).toContainText(/DEMO-\d{4}/);

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await admin.goto('/login');
  await admin.getByTestId('email-input').fill(seed.demoEmail);
  await admin.getByTestId('password-input').fill(seed.demoPassword);
  await admin.getByTestId('auth-submit').click();
  await expect(admin).toHaveURL(/\/$/);

  await admin.goto(
    `/workspaces/${seed.workspaceId}/bases/${seed.baseId}`,
  );
  await admin.getByTestId('automation-open').click();

  const successRun = admin.locator(
    '[data-testid="automation-run-row"][data-status="success"]',
  );
  await expect(successRun.first()).toBeVisible({ timeout: 20_000 });

  await adminContext.close();
});
