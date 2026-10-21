import { expect, test } from '@playwright/test';

test('10,000,000-row canvas stays viewport-bound and scrolls under p95 budget', async ({
  page,
}, testInfo) => {
  await page.goto('/dev/grid-bench?rows=10000000');
  await expect(page.locator('.canvas-grid__layer')).toHaveCount(3);

  const result = await page.evaluate(async () => {
    const engine = window.__gridEngine!;
    const samples: number[] = [];
    const totalHeight = 10_000_000 * 36;
    for (let index = 0; index < 240; index += 1) {
      const started = performance.now();
      engine.scrollTo(0, (index * 999_983 * 36) % totalHeight);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    const percentile = (p: number) =>
      samples[Math.min(samples.length - 1, Math.ceil((p / 100) * samples.length) - 1)];
    const stats = engine.lastFrameStats;
    return {
      rows: 10_000_000,
      p50: percentile(50),
      p95: percentile(95),
      max: samples[samples.length - 1],
      cellsDrawn: stats.cellsDrawn,
      visibleRows: stats.rows.end - stats.rows.start,
      usedOffscreen: stats.usedOffscreen,
    };
  });

  console.log(`GRID_PERF ${JSON.stringify(result)}`);
  await testInfo.attach('grid-perf.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });

  expect(result.visibleRows).toBeLessThan(60);
  expect(result.cellsDrawn).toBeLessThan(600);
  expect(result.usedOffscreen).toBe(true);
  expect(result.p95).toBeLessThan(50);
});
