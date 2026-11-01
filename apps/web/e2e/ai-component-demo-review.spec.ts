import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const summary = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../../.data/ai-component-demo/summary.json'),
    'utf8',
  ),
);

const OUT = resolve(process.cwd(), '../../.data/ai-component-demo');

test.use({
  viewport: { width: 1400, height: 900 },
});

test('open published complex AI components and screenshot', async ({
  page,
}) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });

  await page.addInitScript(
    ({ token, user }) => {
      localStorage.setItem('st.token', token);
      localStorage.setItem('st.user', JSON.stringify(user));
    },
    {
      token: summary.token,
      user: { id: 'demo', account: summary.account },
    },
  );

  await page.goto(summary.openUrl);
  await expect(page.locator('[data-testid="canvas-grid"]')).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: resolve(OUT, '01-grid-overview.png'),
    fullPage: false,
  });

  // Click first data row cells for each AI field (col order: 事项,负责人,SLA,审批,清单)
  // Prefer engine hit-test by field id
  for (const [idx, field] of summary.results.entries()) {
    const hit = await page.evaluate((fieldId) => {
      const engine = (
        window as unknown as {
          __gridEngine?: {
            columns: { id: string }[];
            cellRect: (
              row: number,
              col: number,
            ) => { x: number; y: number; width: number; height: number };
          };
        }
      ).__gridEngine;
      if (!engine) return null;
      const col = engine.columns.findIndex((c) => c.id === fieldId);
      if (col < 0) return null;
      const cell = engine.cellRect(0, col);
      return {
        x: cell.x + Math.min(40, cell.width / 2),
        y: cell.y + Math.min(24, cell.height / 2),
        col,
      };
    }, field.fieldId as string);
    expect(hit, `column for ${field.fieldName}`).toBeTruthy();
    const grid = page.locator('[data-testid="canvas-grid"]');
    await grid.click({ position: { x: hit!.x, y: hit!.y } });
    await page.waitForTimeout(400);
    await grid.click({ position: { x: hit!.x, y: hit!.y } });
    await expect(page.getByTestId('ai-component-host')).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(800);
    await page.screenshot({
      path: resolve(OUT, `02-host-${idx + 1}-${field.key}.png`),
      fullPage: false,
    });

    // Light interaction probes inside iframe is hard (sandbox); click host area then close via Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // Phone-size pass: open record list and open AI from detail if possible
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId('phone-layout-toggle')).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(800);
  await page.screenshot({
    path: resolve(OUT, '03-phone-list.png'),
    fullPage: false,
  });
  const card = page.locator('.record-card').first();
  if (await card.isVisible()) {
    await card.click();
    await page.waitForTimeout(600);
    await page.screenshot({
      path: resolve(OUT, '04-phone-detail.png'),
      fullPage: false,
    });
    const openBtn = page.getByTestId('record-detail-ai-open').first();
    if (await openBtn.isVisible()) {
      await openBtn.click();
      await expect(page.getByTestId('ai-component-host')).toBeVisible({
        timeout: 10_000,
      });
      await page.waitForTimeout(700);
      await page.screenshot({
        path: resolve(OUT, '05-phone-ai-host.png'),
        fullPage: false,
      });
    }
  }
});
