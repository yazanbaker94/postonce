#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const rawBaseUrl = process.argv[2] ?? process.env.POSTONCE_BASE_URL ?? "http://127.0.0.1:5173";
const baseUrl = rawBaseUrl.replace(/\/$/, "");
const outputDir = resolve("docs/screenshots/web");

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
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

async function shot(name, fullPage = true) {
  await page.screenshot({ path: resolve(outputDir, name), fullPage });
}

try {
  await open("/");
  await page.getByRole("heading", { name: /Every payment posts once/i }).waitFor();
  await shot("landing.png");

  await open("/demo");
  await page.getByText("LIVE API", { exact: true }).waitFor({ timeout: 15_000 });
  await shot("demo-start.png");

  await page.getByRole("button", { name: /Run all chapters/i }).click();
  await page.getByText("READY", { exact: true }).first().waitFor({ timeout: 15_000 });
  await shot("close-ready.png");

  await page.getByRole("tab", { name: /Attempts/i }).click();
  const lostAttempt = page.getByRole("button").filter({ hasText: "RESPONSE_LOST" });
  await lostAttempt.waitFor();
  await lostAttempt.click();
  await page.getByText(/caller observed a timeout/i).waitFor();
  await shot("lost-response-evidence.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await shot("control-room-mobile.png");

  await open("/");
  const hero = page.locator(".hero h1");
  await hero.waitFor();
  const mobileFits = await hero.evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
  if (!mobileFits) throw new Error("mobile hero is visibly clipped");
  await shot("landing-mobile.png");
  await shot("landing-mobile-viewport.png", false);

  await page.setViewportSize({ width: 1600, height: 1000 });
  await open("/architecture");
  await page.getByRole("heading", { name: /Delivery is at least once/i }).waitFor();
  await shot("architecture.png");

  if (browserErrors.length > 0) {
    throw new Error(`browser errors observed:\n${browserErrors.join("\n")}`);
  }

  process.stdout.write(`Captured verified PostOnce evidence from ${baseUrl} in ${outputDir}\n`);
} finally {
  await browser.close();
}
