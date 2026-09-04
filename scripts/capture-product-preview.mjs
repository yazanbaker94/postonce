#!/usr/bin/env node

import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const rawBaseUrl = process.argv[2] ?? process.env.POSTONCE_BASE_URL ?? 'http://127.0.0.1:5173';
const baseUrl = rawBaseUrl.replace(/\/$/, '');
const previewPath = resolve('apps/web/public/og-preview.png');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
const browserErrors = [];

page.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
});
page.on('requestfailed', (request) => {
  browserErrors.push(`request: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`);
});

try {
  const response = await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`Product root returned ${response?.status() ?? 'no response'}`);
  await page.getByRole('heading', { name: 'Friday Close' }).waitFor();
  await page.screenshot({ path: previewPath });

  if (browserErrors.length > 0) throw new Error(`Browser errors observed:\n${browserErrors.join('\n')}`);
  process.stdout.write(`Captured PostOnce product preview from ${baseUrl}\n`);
} finally {
  await browser.close();
}
