#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const rawBaseUrl = process.argv[2] ?? process.env.POSTONCE_BASE_URL ?? "http://127.0.0.1:5173";
const baseUrl = rawBaseUrl.replace(/\/$/, "");
const webOutputDir = resolve("docs/screenshots/web");
const productOutputDir = resolve("docs/screenshots/product");
const resolverIp = process.env.POSTONCE_RESOLVE_IP?.trim();
const resolverIpVersion = resolverIp ? isIP(resolverIp) : 0;

if (resolverIp && resolverIpVersion === 0) {
  throw new Error("POSTONCE_RESOLVE_IP must be a valid IPv4 or IPv6 address");
}

const resolverTarget = resolverIpVersion === 6 ? `[${resolverIp}]` : resolverIp;
await Promise.all([mkdir(webOutputDir, { recursive: true }), mkdir(productOutputDir, { recursive: true })]);

const browser = await chromium.launch({
  headless: true,
  args: resolverTarget
    ? [`--host-resolver-rules=MAP ${new URL(baseUrl).hostname} ${resolverTarget}`]
    : [],
});
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1 });
const browserErrors = [];

page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
});
page.on("requestfailed", (request) => {
  const failure = request.failure()?.errorText ?? "unknown";
  browserErrors.push(`request: ${request.method()} ${request.url()} (${failure})`);
});

async function open(path) {
  const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error(`${path} returned ${response?.status() ?? "no response"}`);
}

async function productShot(name, fullPage = false) {
  await page.screenshot({ path: resolve(productOutputDir, name), fullPage });
}

async function webShot(name, fullPage = true) {
  await page.screenshot({ path: resolve(webOutputDir, name), fullPage });
}

async function resolveException(id, heading, buttonName) {
  await page.getByRole("link", { name: "Exceptions" }).first().click();
  await page.locator(".po-work-slip").filter({ hasText: id }).click();
  await page.getByRole("heading", { name: heading }).waitFor();
  await page.getByRole("button", { name: buttonName }).click();
  await page.getByText("Dealership-system write verified").waitFor();
}

try {
  await open("/app/close");
  await page.getByRole("heading", { name: "Friday Close" }).waitFor({ timeout: 15_000 });
  await productShot("01-close-initial.png");

  await open("/app/exceptions?location=NLF&status=OPEN&sort=newest");
  await page.getByRole("heading", { name: "Northline Ford" }).waitFor();
  await productShot("02-ford-exceptions.png");

  await open("/app/exceptions/EX-104");
  await page.locator(".po-decision-heading h2").filter({ hasText: "Ambiguous payment match" }).waitFor();
  await productShot("03-ex104-decision-bench.png");
  await page.getByRole("button", { name: /Apply \$1,125\.00 to RO-8004/i }).click();
  await page.getByText("Dealership-system write verified").waitFor();

  await resolveException("EX-105", "Refund needs original transaction", /Link \$219\.00 refund to P-18401/i);
  await resolveException("EX-106", "Likely second half of split tender", /Apply \$2,450\.00 remainder to RO-8018/i);

  await page.getByRole("link", { name: "Close" }).first().click();
  const readyFord = page.locator(".po-close-rail").filter({ hasText: "Northline Ford" });
  await readyFord.getByText("Ready").waitFor();
  await readyFord.getByRole("button", { name: "Close location" }).click();
  await page.getByRole("dialog", { name: /Close Northline Ford/i }).getByRole("button", { name: "Close location" }).click();
  await readyFord.getByText("Closed by Maya Chen").waitFor();

  await page.locator(".po-prior-settlement-row").click();
  await page.getByRole("heading", { name: "Daily deposit reconciliation" }).waitFor();
  await page.evaluate(async () => {
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    root.style.scrollBehavior = previous;
  });
  await productShot("05-subaru-variance.png");
  await page.getByRole("button", { name: /Record .*25\.00 network assessment adjustment/i }).click();
  await page.getByRole("heading", { name: "Deposit reconciled" }).waitFor();

  await open("/app/payments/PAY-1017");
  await page.locator(".po-payment-heading h1").waitFor();
  await page.locator("summary").filter({ hasText: "Evidence · response recovery" }).click();
  await page.getByText("One effect, proven across two attempts").waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await productShot("04-pay1017-evidence.png");

  await page.locator(".po-profile").click();
  await page.getByRole("button", { name: "Reset workspace" }).first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await open("/app/close");
  await page.getByRole("heading", { name: "Friday Close" }).waitFor();
  await productShot("mobile-close.png");

  await page.setViewportSize({ width: 1536, height: 1024 });
  await open("/architecture");
  await page.getByRole("heading", { name: /Delivery is at least once/i }).waitFor();
  await webShot("architecture.png");

  if (browserErrors.length > 0) {
    throw new Error(`browser errors observed:\n${browserErrors.join("\n")}`);
  }

  process.stdout.write(`Captured verified PostOnce product evidence from ${baseUrl}\n`);
} finally {
  await browser.close();
}
