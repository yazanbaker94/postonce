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

test('controller completes the canonical close and reconciliation journey', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/app\/close$/);
  await expect(page.getByRole('heading', { name: 'Friday Close' })).toBeVisible();
  await expect(page.locator('.po-close-heading').getByText('Northline Motor Group', { exact: true })).toBeVisible();
  await expect(page.locator('time.po-date-switcher')).toHaveText('Fri, Sep 4, 2026');
  const fordRail = page.locator('.po-close-rail').filter({ hasText: 'Northline Ford' });
  await expect(fordRail.getByText('27', { exact: true })).toBeVisible();
  await expect(fordRail.getByText('24', { exact: true })).toBeVisible();
  await expect(fordRail.getByText('Need review', { exact: true })).toBeVisible();
  await expect(fordRail.getByText('Payout pending')).toBeVisible();
  const blockedEndpoint = fordRail.getByRole('link', { name: '3 blockers' });
  await expect(blockedEndpoint).toBeVisible();
  await expect(blockedEndpoint).toHaveAttribute('href', '/app/exceptions?location=NLF&status=OPEN&sort=newest');
  await capture(page, testInfo, '01-close-initial.png');
  await assertNoPageOverflow(page);

  await blockedEndpoint.click();
  await expect(page.getByRole('heading', { name: 'Northline Ford' })).toBeVisible();
  await expect(page.getByText('3 items blocking close', { exact: true })).toBeVisible();
  const slips = page.locator('.po-work-slip');
  await expect(slips).toHaveCount(3);
  expect(await slips.allTextContents()).toEqual(expect.arrayContaining([
    expect.stringMatching(/^EX-104/),
    expect.stringMatching(/^EX-105/),
    expect.stringMatching(/^EX-106/),
  ]));
  const ids = await slips.locator('.po-work-slip__meta > span:first-child').allTextContents();
  expect(ids).toEqual(['EX-104', 'EX-105', 'EX-106']);
  await expect(slips.nth(0).getByText('18 min ago')).toBeVisible();
  await expect(slips.nth(1).getByText('37 min ago')).toBeVisible();
  await expect(slips.nth(2).getByText('46 min ago')).toBeVisible();
  await capture(page, testInfo, '02-ford-exceptions.png');

  await slips.nth(0).click();
  await expect(page.getByRole('heading', { name: 'EX-104' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ambiguous payment match' })).toBeVisible();
  await expect(page.locator('.po-source-card .po-bench-label')).toHaveText('Payment');
  await expect(page.locator('.po-candidate-panel .po-bench-label')).toHaveText('Match analysis');
  await expect(page.locator('.po-selected-card .po-bench-label')).toHaveText('Selected record');
  await expect(page.getByLabel(/RO-8004/)).toBeChecked();
  await expect(page.getByText('Terminal 04')).toBeVisible();
  await expect(page.getByText('J. Patel', { exact: true })).toBeVisible();
  await page.getByLabel(/RO-8031/).click();
  await expect(page.getByLabel(/RO-8031/)).toBeChecked();
  await expect(page.getByRole('button', { name: /Cannot apply · \$25\.00 over balance/i })).toBeDisabled();
  await expect(page.getByText('Balance does not support this payment')).toBeVisible();
  await expect(page.getByText(/\$25\.00 exceeds the remaining balance/i)).toBeVisible();
  await page.getByLabel(/RO-8004/).click();
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
  await expect(readyFord.getByText('27', { exact: true })).toHaveCount(2);
  await expect(readyFord.getByText('Verified', { exact: true })).toBeVisible();
  await readyFord.getByRole('button', { name: 'Close location' }).click();
  const dialog = page.getByRole('dialog', { name: /Close Northline Ford/i });
  await expect(dialog.getByText('Payout pending')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close location' }).click();
  await expect(readyFord.getByText('Closed by Maya Chen')).toBeVisible();
  await expect(readyFord.locator('.po-attestation')).toBeFocused();
  await expect(page.getByText(/Northline Ford operational close sealed by Maya Chen/i)).toBeAttached();

  await expect(page.getByRole('heading', { name: 'Prior settlements requiring attention' })).toBeVisible();
  await page.locator('.po-prior-settlement-row').click();
  await expect(page.getByRole('heading', { name: 'Northline Subaru' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Daily deposit reconciliation' })).toBeVisible();
  await expect(page.getByText('PAYOUT-9842', { exact: true })).toBeVisible();
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
  const paymentAmountHeading = page.getByRole('heading', { name: '1245.00 Canadian dollars' });
  await expect(paymentAmountHeading).toBeVisible();
  await expect(paymentAmountHeading).toHaveText('$1,245.00');
  await expect(page.getByText('Routine payment', { exact: true })).toBeVisible();
  await expect(page.locator('.po-payment-details').getByText('Riley Chen', { exact: true })).toBeVisible();
  await expect(page.getByText('Captured', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Posted · Verified', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Payout pending', { exact: true }).first()).toBeVisible();
  const evidence = page.locator('details.po-payment-evidence');
  await evidence.locator('summary').click();
  await expect(evidence).toHaveAttribute('open', '');
  await expect(evidence.locator('.po-proof-table')).toBeVisible();
  await expect(evidence.getByText('Financial mutations')).toBeVisible();
  await expect(evidence.locator('.po-proof-table__result strong')).toHaveText('1');
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
  await expect(page.getByRole('heading', { name: '1245.00 Canadian dollars' })).toBeVisible();
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

test('product shell remains usable at narrow widths', async ({ page }) => {
  for (const width of [1240, 1181, 1000, 901, 801]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/app/exceptions');
    await expect(page.getByRole('heading', { name: 'Northline Ford' })).toBeVisible();
    await assertNoPageOverflow(page);
    await page.goto('/app/exceptions/EX-104');
    await expect(page.getByRole('heading', { name: 'Ambiguous payment match' })).toBeVisible();
    await assertNoPageOverflow(page);
    await page.goto('/app/payments/PAY-1017');
    await expect(page.getByRole('heading', { name: '1245.00 Canadian dollars' })).toBeVisible();
    await page.locator('details.po-payment-evidence summary').click();
    await assertNoPageOverflow(page);
    await page.goto('/app/deposits/payout_9842');
    await expect(page.getByRole('heading', { name: 'Daily deposit reconciliation' })).toBeVisible();
    await expect(page.locator('time.po-deposit-date')).toHaveText('Thu, Sep 3, 2026');
    await assertNoPageOverflow(page);
    if (width === 1240) {
      await page.goto('/app/deposits/payout_pending_nlt');
      await expect(page.locator('time.po-deposit-date')).toHaveText('Fri, Sep 4, 2026');
      await assertNoPageOverflow(page);
    }
    await expect(page.locator('.po-mobile-nav')).toBeVisible();
    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('menuitem', { name: 'Reset workspace' })).toBeVisible();
    await page.getByRole('button', { name: 'More' }).click();
  }

  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/app/close');
    await expect(page.getByRole('heading', { name: 'Friday Close' })).toBeVisible();
    await assertNoPageOverflow(page);
    await page.getByRole('link', { name: 'Exceptions' }).first().click();
    await expect(page.getByRole('heading', { name: 'Northline Ford' })).toBeVisible();
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
