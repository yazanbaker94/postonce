import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const screenshotDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/screenshots/product');

async function capture(page: Page, testInfo: TestInfo, name: string) {
  if (testInfo.project.name !== 'screenshots') return;
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: resolve(screenshotDir, name), fullPage: false });
}

async function assertNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/case-study');
  await page.evaluate(() => window.localStorage.clear());
});

test('controller completes the canonical close and reconciliation journey', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/app\/close$/);
  await expect(page.getByRole('heading', { name: 'Daily close' })).toBeVisible();
  await expect(page.getByText(/2 locations ready · 1 blocked .* 3 open operational exceptions/i)).toBeVisible();
  const fordRail = page.locator('.po-close-rail').filter({ hasText: 'Northline Ford' });
  await expect(fordRail.getByText('24 / 27 verified')).toBeVisible();
  await expect(fordRail.getByText('Payout pending')).toBeVisible();
  await expect(fordRail.getByRole('button', { name: '3 blockers' })).toBeDisabled();
  await capture(page, testInfo, '01-close-initial.png');
  await assertNoPageOverflow(page);

  await fordRail.getByRole('link', { name: /Review exceptions/i }).click();
  await expect(page.getByRole('heading', { name: 'Open work' })).toBeVisible();
  const slips = page.locator('.po-work-slip');
  await expect(slips).toHaveCount(3);
  expect(await slips.allTextContents()).toEqual(expect.arrayContaining([
    expect.stringMatching(/^EX-104/),
    expect.stringMatching(/^EX-105/),
    expect.stringMatching(/^EX-106/),
  ]));
  const ids = await slips.locator('.po-work-slip__meta > span:first-child').allTextContents();
  expect(ids).toEqual(['EX-104', 'EX-105', 'EX-106']);
  await expect(slips.nth(0).getByText('18 min')).toBeVisible();
  await expect(slips.nth(1).getByText('37 min')).toBeVisible();
  await expect(slips.nth(2).getByText('46 min')).toBeVisible();
  await capture(page, testInfo, '02-ford-exceptions.png');

  await slips.nth(0).click();
  await expect(page.getByRole('heading', { name: 'Ambiguous payment match' })).toBeVisible();
  await expect(page.getByLabel(/RO-8004/)).toBeChecked();
  await expect(page.getByText('Terminal 04')).toBeVisible();
  await expect(page.getByText('J. Patel', { exact: true })).toBeVisible();
  await page.locator('.po-candidate').filter({ hasText: 'RO-8031' }).click();
  await expect(page.getByLabel(/RO-8031/)).toBeChecked();
  await expect(page.getByRole('button', { name: /Cannot apply · \$25\.00 over balance/i })).toBeDisabled();
  await expect(page.getByText(/RO-8031 has \$25\.00 less open balance/i)).toBeVisible();
  await page.locator('.po-candidate').filter({ hasText: 'RO-8004' }).click();
  await expect(page.getByLabel(/RO-8004/)).toBeChecked();
  await capture(page, testInfo, '03-ex104-decision-bench.png');
  await page.getByRole('button', { name: /Apply \$1,125\.00 to RO-8004/i }).click();
  await expect(page.getByText('Dealership-system write verified')).toBeVisible();

  await page.getByRole('link', { name: 'Exceptions' }).first().click();
  await page.locator('.po-work-slip').filter({ hasText: 'EX-105' }).click();
  await expect(page.getByRole('heading', { name: 'Refund needs original transaction' })).toBeVisible();
  await expect(page.getByLabel(/P-18401/)).toBeChecked();
  await page.getByRole('button', { name: /Link \$219\.00 refund to P-18401/i }).click();
  await expect(page.getByText('Dealership-system write verified')).toBeVisible();

  await page.getByRole('link', { name: 'Exceptions' }).first().click();
  await page.locator('.po-work-slip').filter({ hasText: 'EX-106' }).click();
  await expect(page.getByRole('heading', { name: 'Likely second half of split tender' })).toBeVisible();
  await expect(page.getByText('$1,550.00', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('$2,450.00', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('$4,000.00', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /Apply \$2,450\.00 remainder to RO-8018/i }).click();
  await expect(page.getByText('Dealership-system write verified')).toBeVisible();

  await page.getByRole('link', { name: 'Close' }).first().click();
  const readyFord = page.locator('.po-close-rail').filter({ hasText: 'Northline Ford' });
  await expect(readyFord.getByText('Ready')).toBeVisible();
  await expect(readyFord.getByText('27 / 27 verified')).toBeVisible();
  await readyFord.getByRole('button', { name: 'Close location' }).click();
  const dialog = page.getByRole('dialog', { name: /Close Northline Ford/i });
  await expect(dialog.getByText('Payout pending')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close location' }).click();
  await expect(readyFord.getByText('Closed by Maya Chen')).toBeVisible();
  await expect(readyFord.locator('.po-attestation')).toBeFocused();
  await expect(page.getByText(/Northline Ford operational close sealed by Maya Chen/i)).toBeAttached();

  await expect(page.getByRole('heading', { name: 'Prior settlements requiring attention' })).toBeVisible();
  await page.locator('.po-prior-settlement-row').click();
  await expect(page.getByRole('heading', { name: 'PAYOUT-9842' })).toBeVisible();
  await expect(page.getByText('Variance').last()).toBeVisible();
  await expect(page.getByText('$25.00').last()).toBeVisible();
  await page.evaluate(async () => {
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    root.style.scrollBehavior = previous;
  });
  await capture(page, testInfo, '05-subaru-variance.png');
  await page.getByRole('button', { name: /Record .*25\.00 network assessment adjustment/i }).click();
  await expect(page.getByRole('heading', { name: 'Deposit reconciled' })).toBeVisible();
  await expect(page.locator('.po-adjustment-complete').getByText('Reconciled', { exact: true })).toBeVisible();
  await expect(page.locator('.po-ledger-variance--clear .po-money')).toHaveText('$0.00');
  await expect(page.getByText('Original expected preserved')).toContainText('$18,742.61');

  await page.goto('/app/payments/PAY-1017');
  await expect(page.getByRole('heading', { name: 'Riley Chen' })).toBeVisible();
  await expect(page.getByText('Captured', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Posted · Verified', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Payout pending', { exact: true }).first()).toBeVisible();
  const evidence = page.locator('summary').filter({ hasText: 'Evidence · response recovery' });
  await evidence.click();
  await expect(page.getByText('One effect, proven across two attempts')).toBeVisible();
  await expect(page.getByText('Financial mutations')).toBeVisible();
  await expect(page.locator('.po-proof-result strong')).toHaveText('1');
  await page.locator('.po-state-ribbon').evaluate(async (element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, Math.max(0, top - 74));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    root.style.scrollBehavior = previous;
  });
  await capture(page, testInfo, '04-pay1017-evidence.png');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Riley Chen' })).toBeVisible();
  await page.goto('/app/close');
  await expect(page.locator('.po-close-rail').filter({ hasText: 'Northline Ford' }).getByText('Closed by Maya Chen')).toBeVisible();

  const isolation = await page.evaluate(async () => {
    const currentSessionId = window.localStorage.getItem('postonce.workspace.session.v1');
    if (!currentSessionId) throw new Error('The canonical workspace session was not stored.');

    const createResponse = await fetch('/api/demo/sessions', { method: 'POST' });
    if (!createResponse.ok) throw new Error(`A second workspace could not be created (${createResponse.status}).`);
    const created = await createResponse.json() as {
      sessionId: string;
      state: { session: { version: number }; exceptions: Array<{ status: string }> };
    };

    const originalResponse = await fetch('/api/workspace', {
      headers: { 'X-Demo-Session': currentSessionId },
    });
    if (!originalResponse.ok) throw new Error(`The original workspace could not be reloaded (${originalResponse.status}).`);
    const original = await originalResponse.json() as {
      operationalCloses: Array<{ rooftopId: string; status: string }>;
      payouts: Array<{ id: string; status: string }>;
    };

    return {
      distinctIds: created.sessionId !== currentSessionId,
      freshVersion: created.state.session.version,
      freshOpenExceptions: created.state.exceptions.filter((item) => item.status === 'OPEN').length,
      originalFordStatus: original.operationalCloses.find((item) => item.rooftopId === 'roof_nlf')?.status,
      originalSubaruPayoutStatus: original.payouts.find((item) => item.id === 'payout_9842')?.status,
    };
  });
  expect(isolation).toEqual({
    distinctIds: true,
    freshVersion: 0,
    freshOpenExceptions: 3,
    originalFordStatus: 'CLOSED',
    originalSubaruPayoutStatus: 'RECONCILED',
  });

  await page.goto(`/app/payments?q=${encodeURIComponent('$1,125.00')}`);
  await expect(page.locator('.po-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.po-table tbody tr').getByText('PAY-104', { exact: true })).toBeVisible();
  await assertNoPageOverflow(page);
});

test('case-study geometry and product shell remain usable at narrow widths', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/case-study');
  await expect(page.getByRole('heading', { name: /Every payment posts once/i })).toBeVisible();
  const measuredSections = await page.locator('body').evaluate(() => {
    const selectors = ['.home-header', '.home-hero', '.home-state-strip', '.home-flow', '.home-control-plane', '.home-evidence', '.home-control-room', '.home-final-cta', '.home-footer'];
    return selectors.map((selector) => {
      const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return { selector, top: rect.top + window.scrollY, height: rect.height };
    });
  });
  const approvedGeometry = [
    ['.home-header', 0, 118], ['.home-hero', 118, 842], ['.home-state-strip', 960, 190],
    ['.home-flow', 1150, 570], ['.home-control-plane', 1720, 619], ['.home-evidence', 2339, 581],
    ['.home-control-room', 2920, 726], ['.home-final-cta', 3646, 209], ['.home-footer', 3855, 378],
  ] as const;
  for (const [index, [selector, top, height]] of approvedGeometry.entries()) {
    expect(measuredSections[index]?.selector).toBe(selector);
    expect(measuredSections[index]?.top).toBeCloseTo(top, 0);
    expect(measuredSections[index]?.height).toBeCloseTo(height, 0);
  }
  expect(await page.locator('img[src*="control-room-dashboard"]').count()).toBe(0);

  for (const width of [900, 801]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/app/deposits');
    await expect(page.getByRole('heading', { name: 'Deposits' })).toBeVisible();
    await assertNoPageOverflow(page);
  }

  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/case-study');
    await expect(page.locator('.home-hero h1')).toBeVisible();
    await assertNoPageOverflow(page);
    if (testInfo.project.name === 'screenshots' && width === 390) await page.screenshot({ path: resolve(screenshotDir, 'landing-mobile-viewport.png') });

    await page.goto('/app/close');
    await expect(page.getByRole('heading', { name: 'Daily close' })).toBeVisible();
    await assertNoPageOverflow(page);
    await page.getByRole('link', { name: 'Exceptions' }).first().click();
    await expect(page.getByRole('heading', { name: 'Open work' })).toBeVisible();
    await assertNoPageOverflow(page);
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Integrations' }).click();
    await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
    await assertNoPageOverflow(page);
    await page.getByRole('link', { name: 'Deposits' }).first().click();
    await expect(page.getByRole('heading', { name: 'Deposits' })).toBeVisible();
    await assertNoPageOverflow(page);
  }
});
