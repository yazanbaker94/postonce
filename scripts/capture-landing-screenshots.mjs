#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const rawBaseUrl = process.argv[2] ?? process.env.POSTONCE_BASE_URL ?? 'http://127.0.0.1:5173';
const baseUrl = rawBaseUrl.replace(/\/$/, '');
const outputDir = resolve('docs/screenshots/web');
const ogPreview = resolve('apps/web/public/og-preview.png');

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const browserErrors = [];

page.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
});
page.on('requestfailed', (request) => {
  browserErrors.push(`request: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`);
});

async function openLanding() {
  const response = await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`Landing page returned ${response?.status() ?? 'no response'}`);
  await page.getByRole('heading', { name: /Every payment posts once/i }).waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    const step = Math.max(420, Math.floor(window.innerHeight * .72));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((done) => setTimeout(done, 80));
    }
    window.scrollTo(0, 0);
    await Promise.all([...document.images].map(async (image) => {
      if (!image.complete || image.naturalWidth === 0) {
        await new Promise((done) => {
          image.addEventListener('load', done, { once: true });
          image.addEventListener('error', done, { once: true });
        });
      }
      if (image.decode) await image.decode().catch(() => {});
      if (image.naturalWidth === 0) throw new Error(`Image failed to load: ${image.currentSrc || image.src}`);
    }));
  });
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  if (!fits) throw new Error(`Landing page overflows horizontally at ${await page.evaluate(() => window.innerWidth)}px`);
}

try {
  await openLanding();
  await page.screenshot({ path: resolve(outputDir, 'landing.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await openLanding();
  await page.screenshot({ path: resolve(outputDir, 'landing-mobile.png'), fullPage: true });
  await page.screenshot({ path: resolve(outputDir, 'landing-mobile-viewport.png') });

  await page.setViewportSize({ width: 1200, height: 630 });
  await openLanding();
  await page.screenshot({ path: ogPreview });

  if (browserErrors.length > 0) throw new Error(`Browser errors observed:\n${browserErrors.join('\n')}`);
  process.stdout.write(`Captured PostOnce landing evidence from ${baseUrl}\n`);
} finally {
  await browser.close();
}
