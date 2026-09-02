import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.POSTONCE_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 8_000 },
  outputDir: './test-results/playwright',
  use: {
    baseURL: externalBaseUrl ?? 'http://127.0.0.1:4273',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  ...(externalBaseUrl ? {} : { webServer: {
      command: 'npm run serve:e2e',
      url: 'http://127.0.0.1:4273',
      reuseExistingServer: true,
    } }),
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'screenshots', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } } },
  ],
});
