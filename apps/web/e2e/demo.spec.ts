import { expect, test } from '@playwright/test';
import { makeSeedState, runLocalAction } from '../src/demoData';
import type { ActionKey, DemoState } from '../src/types';

test.beforeEach(async ({ page }) => {
  let state: DemoState = makeSeedState('3dfcb7a4-1f63-42e7-8755-22ef762d7ae1');
  await page.route('**/api/demo/**', async (route) => {
    const url = new URL(route.request().url());
    const action = url.pathname.split('/actions/')[1] as ActionKey | undefined;
    if (action) state = runLocalAction(state, action);
    const body = url.pathname.endsWith('/sessions')
      ? { sessionId: state.session.id, sessionHeader: 'X-Demo-Session', state }
      : action ? { action, replayed: false, chapter: state.currentChapter, result: {}, state } : state;
    await route.fulfill({ status: url.pathname.endsWith('/sessions') ? 201 : 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
});

test('reviewer can complete the close and inspect evidence', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Every payment posts once/i })).toBeVisible();
  if (testInfo.project.name === 'screenshots') await page.screenshot({ path: 'test-results/screenshots/01-landing.png', fullPage: true });

  await page.getByRole('link', { name: /Run the close/i }).first().click();
  await expect(page.getByText('LIVE API')).toBeVisible();
  await page.getByRole('button', { name: /Run all chapters/i }).click();
  await expect(page.getByText('READY', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Gross minus fees and refunds equals the deposit/i })).toBeVisible();
  if (testInfo.project.name === 'screenshots') await page.screenshot({ path: 'test-results/screenshots/02-close-ready.png', fullPage: true });

  await page.getByRole('tab', { name: /Attempts/i }).click();
  const lostResponse = page.getByRole('button').filter({ hasText: 'RESPONSE_LOST' });
  await expect(lostResponse).toBeVisible();
  await lostResponse.click();
  await expect(page.getByText(/op_3dfcb7a4_pay_1003/i).first()).toBeVisible();
  await expect(page.getByTestId('logical-attempt-count')).toHaveText('2');
  if (testInfo.project.name === 'screenshots') await page.screenshot({ path: 'test-results/screenshots/03-integration-evidence.png', fullPage: true });

  if (testInfo.project.name === 'screenshots') {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/screenshots/04-mobile-control-room.png', fullPage: true });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/architecture');
    await page.screenshot({ path: 'test-results/screenshots/05-architecture.png', fullPage: true });
  }
});

test('landing and control room do not clip at tablet or narrow phone widths', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/');
  for (const selector of ['.home-hero', '.home-flow__inner', '.home-control-plane', '.home-evidence', '.home-control-room']) {
    expect(await page.locator(selector).evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left >= -1 && rect.right <= window.innerWidth + 1 && node.scrollWidth <= node.clientWidth + 1;
    })).toBe(true);
  }

  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const h1 = page.locator('.home-hero h1');
    await expect(h1).toBeVisible();
    expect(await h1.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(await page.locator('.home-header').evaluate((node) => {
      const viewport = window.innerWidth;
      return node.getBoundingClientRect().right <= viewport;
    })).toBe(true);
    expect(await page.locator('.home-state-strip').evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (testInfo.project.name === 'screenshots') {
      await page.screenshot({ path: `test-results/screenshots/0${width === 390 ? 6 : 7}-landing-mobile-${width}.png`, fullPage: true });
      await page.screenshot({ path: `test-results/screenshots/0${width === 390 ? 8 : 9}-landing-mobile-viewport-${width}.png` });
    }
  }

  await page.goto('/demo');
  await expect(page.getByText('CLOSE STATE')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
