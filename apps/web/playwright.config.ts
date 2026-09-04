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
  ...(externalBaseUrl ? {} : { webServer: [
    {
      command: 'npm run serve:api:e2e',
      url: 'http://127.0.0.1:3001/health',
      reuseExistingServer: true,
      timeout: 120_000,
      env: { DEMO_SESSION_CREATE_LIMIT: '100' },
    },
    {
      command: 'npm run serve:e2e',
      url: 'http://127.0.0.1:4273',
      reuseExistingServer: true,
    },
  ] }),
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1536, height: 1024 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    { name: 'screenshots', use: { ...devices['Desktop Chrome'], viewport: { width: 1536, height: 1024 } } },
  ],
});
