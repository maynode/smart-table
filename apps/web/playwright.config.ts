import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter api build && node apps/api/dist/main.js',
      url: 'http://127.0.0.1:3000/health',
      cwd: '../..',
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command:
        'pnpm --filter web exec vite --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173',
      cwd: '../..',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
