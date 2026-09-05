#!/usr/bin/env node
// Capture real UI states in a fresh, isolated synthetic workspace.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = (process.argv[2] ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const output = resolve('docs/screenshots/review');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`${request.url()}: ${request.failure()?.errorText}`); });
async function open(path) {
  const response = await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  expect(response?.ok(), path).toBeTruthy();
  await page.locator(path === '/architecture' ? 'h1' : '.po-page').first().waitFor();
}
async function shot(name, fullPage = true, scrollTop = true) {
  await page.evaluate(async (resetScroll) => { await document.fonts.ready; if (resetScroll) window.scrollTo({ top: 0, behavior: 'instant' }); }, scrollTop);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage, animations: 'disabled' });
  console.log(`Captured ${name}`);
}
try {
  await open('/app/close');
  await shot('01-close');
  await open('/app/exceptions?location=NLF&status=OPEN&sort=newest');
  await shot('02-exceptions');
  for (const [id, name] of [['EX-104', '03-payment-match'], ['EX-105', '04-refund-link'], ['EX-106', '05-split-tender']]) {
    await open(`/app/exceptions/${id}`);
    await shot(name);
  }
  await open('/app/payments');
  await shot('06-payments', false);
  await open('/app/payments/PAY-1001');
  await shot('07-payment-detail');
  await open('/app/payments/PAY-1017');
  await page.locator('.po-payment-evidence summary').click();
  await shot('08-payment-recovery');
  await open('/app/payments/PAY-1006');
  await page.locator('.po-technical-evidence summary').click();
  await shot('09-duplicate-delivery');
  await open('/app/deposits');
  await shot('10-deposits');
  await open('/app/deposits/payout_9842');
  await shot('11-deposit-variance');
  await open('/app/deposits/payout_9834');
  await shot('12-matched-deposit');
  await open('/app/deposits/payout_pending_nlt');
  await shot('13-pending-deposit');
  await open('/app/integrations');
  for (const summary of await page.locator('.po-integrations summary').all()) await summary.click();
  await shot('14-integrations');
  await open('/app/close');
  await page.getByLabel('Search workspace', { exact: true }).fill('Daniel Harper');
  await expect(page.locator('.po-search-results a').first()).toBeVisible();
  await shot('15-search', false);
  for (const [id, action] of [
    ['EX-104', /Apply \$1,125\.00 to RO-8004/i],
    ['EX-105', /Link \$219\.00 refund to P-18401/i],
    ['EX-106', /Apply \$2,450\.00 remainder to RO-8018/i],
  ]) {
    await open(`/app/exceptions/${id}`);
    await page.getByRole('button', { name: action }).click();
    await expect(page.getByText('Dealership-system write verified')).toBeVisible();
    if (id === 'EX-104') await shot('16-resolved-exception');
  }
  await open('/app/close');
  const ford = page.locator('.po-close-rail').filter({ hasText: 'Northline Ford' });
  await ford.getByRole('button', { name: 'Close location' }).click();
  const dialog = page.getByRole('dialog', { name: /Close Northline Ford/i });
  await expect(dialog).toBeVisible();
  await shot('17-close-confirmation', false);
  await dialog.getByRole('button', { name: 'Close location' }).click();
  await expect(ford.getByText('Closed by Maya Chen')).toBeVisible();
  await shot('18-closed-location');
  await open('/app/deposits/payout_9842');
  await page.getByRole('button', { name: /Record .*25\.00 network assessment adjustment/i }).click();
  await expect(page.getByRole('heading', { name: 'Deposit reconciled' })).toBeVisible();
  await shot('19-reconciled-adjustment');
  await open('/app/activity');
  await shot('20-activity');
  await open('/architecture');
  await shot('21-architecture');
  // Start a new isolated workspace for the initial responsive views.
  await page.context().clearCookies();
  await open('/app/close');
  await page.evaluate(() => localStorage.clear());
  await page.setViewportSize({ width: 390, height: 844 });
  await open('/app/close');
  await shot('22-mobile-close', false);
  await open('/app/payments');
  await page.locator('.po-table').evaluate(element => window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 74, behavior: 'instant' }));
  await shot('23-mobile-payments', false, false);
  await open('/app/exceptions/EX-104');
  await page.locator('.po-candidate-panel').evaluate(element => window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 74, behavior: 'instant' }));
  await shot('24-mobile-decision', false, false);
  expect(errors, 'No browser errors during capture').toEqual([]);
  console.log(`Reviewer tour: 24 screenshots captured from ${base}.`);
} finally {
  await browser.close();
}
