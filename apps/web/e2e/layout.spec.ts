import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const screenshotDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/screenshots/product');

test('payment columns and row actions stay aligned', async ({ page }, testInfo) => {
  await page.goto('/app/payments');
  await expect(page.getByRole('heading', { name: 'Payments', exact: true })).toBeVisible();
  const geometry = await page.locator('.po-table').evaluate((table) => {
    const headers = [...table.querySelectorAll('th')].map((cell) => cell.getBoundingClientRect());
    const row = table.querySelector('tbody tr')!;
    const cells = [...row.children].map((cell) => cell.getBoundingClientRect());
    const action = row.querySelector('.po-row-link')!.getBoundingClientRect();
    const arrow = row.querySelector('.po-row-link svg')!.getBoundingClientRect();
    return {
      headerDeltas: cells.map((cell, i) => Math.abs(cell.x - headers[i].x)),
      rowDeltas: cells.map((cell) => Math.abs(cell.y - cells[0].y)),
      actionDeltaX: Math.abs(action.x + action.width / 2 - arrow.x - arrow.width / 2),
      actionDeltaY: Math.abs(action.y + action.height / 2 - arrow.y - arrow.height / 2),
      tableOverflow: table.scrollWidth - table.clientWidth,
    };
  });
  expect(geometry.actionDeltaX).toBeLessThan(1);
  expect(geometry.actionDeltaY).toBeLessThan(1);
  if (testInfo.project.name === 'mobile') {
    expect(geometry.tableOverflow).toBeLessThanOrEqual(1);
  } else {
    expect(Math.max(...geometry.headerDeltas)).toBeLessThan(1);
    expect(Math.max(...geometry.rowDeltas)).toBeLessThan(1);
  }
});

test('all work surfaces and expanded evidence fit their available width', async ({ page }, testInfo) => {
  const routes = [
    '/app/close', '/app/exceptions', '/app/exceptions/EX-104',
    '/app/exceptions/EX-105', '/app/exceptions/EX-106', '/app/payments',
    '/app/payments/PAY-1017', '/app/deposits', '/app/deposits/payout_9842',
    '/app/deposits/payout_9834', '/app/deposits/payout_pending_nlt',
    '/app/activity', '/app/integrations',
  ];
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator('.po-page')).toBeVisible();
    if (route === '/app/exceptions') await page.locator('.po-filter-menu summary').click();
    if (route === '/app/payments/PAY-1017') await page.locator('.po-payment-evidence summary').click();
    if (route === '/app/integrations') {
      for (const summary of await page.locator('.po-integrations summary').all()) await summary.click();
    }
    const escaped = await page.locator('.po-main').evaluate((main) => {
      const bounds = main.getBoundingClientRect();
      return [...main.querySelectorAll<HTMLElement>('.po-status, .po-row-link, .po-filterbar, .po-candidate-panel fieldset, .po-table-cell')]
        .filter((element) => element.checkVisibility())
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
        })
        .map((element) => element.className);
    });
    expect(escaped, route).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), route).toBe(true);
    if (testInfo.project.name === 'screenshots') {
      const extraScreens: Record<string, string> = {
        '/app/payments': '06-payment-ledger.png',
        '/app/deposits': '07-deposit-ledger.png',
        '/app/activity': '08-activity.png',
        '/app/integrations': '09-integrations.png',
      };
      if (extraScreens[route]) {
        await mkdir(screenshotDir, { recursive: true });
        await page.screenshot({ path: resolve(screenshotDir, extraScreens[route]), fullPage: false });
      }
    }
  }
});

test('tablet filters open inside the page', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto('/app/exceptions');
  await page.locator('.po-filter-menu summary').click();
  const bounds = await page.locator('.po-filter-menu .po-filterbar').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1000);
  await page.goto('/app/close');
  await expect(page.getByRole('heading', { name: 'Friday Close' })).toBeVisible();
  const rail = page.locator('.po-close-rail').first();
  const settlement = await rail.locator('.po-close-step--settlement').boundingBox();
  const boundsRail = await rail.boundingBox();
  expect(Math.abs(settlement!.x + settlement!.width - boundsRail!.x - boundsRail!.width)).toBeLessThan(2);
});

test('missing payout components are not presented as zero', async ({ page }) => {
  await page.goto('/app/deposits/payout_9834');
  const ledger = page.locator('.po-ledger-lines');
  for (const label of ['Captured payments', 'Refunds', 'Processor fees']) {
    const row = ledger.locator(':scope > div').filter({ has: page.getByText(label, { exact: true }) });
    await expect(row).toContainText('Not available');
    await expect(row).not.toContainText('$0.00');
  }
  await expect(ledger.locator('.po-ledger-observed')).toContainText('$14,884.92');
  await expect(ledger.locator('.po-ledger-variance')).toContainText('$0.00');
});
