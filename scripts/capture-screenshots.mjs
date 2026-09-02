#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const rawBaseUrl = process.argv[2] ?? process.env.POSTONCE_BASE_URL ?? "http://127.0.0.1:5173";
const baseUrl = rawBaseUrl.replace(/\/$/, "");
const outputDir = resolve("docs/screenshots/web");
const resolverIp = process.env.POSTONCE_RESOLVE_IP?.trim();
const resolverIpVersion = resolverIp ? isIP(resolverIp) : 0;

if (resolverIp && resolverIpVersion === 0) {
  throw new Error("POSTONCE_RESOLVE_IP must be a valid IPv4 or IPv6 address");
}

const resolverTarget = resolverIpVersion === 6 ? `[${resolverIp}]` : resolverIp;

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: resolverTarget
    ? [`--host-resolver-rules=MAP ${new URL(baseUrl).hostname} ${resolverTarget}`]
    : [],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
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

async function settleLandingAssets() {
  await page.evaluate(async () => {
    const step = Math.max(420, Math.floor(window.innerHeight * .72));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((done) => setTimeout(done, 80));
    }
    window.scrollTo(0, 0);
    await Promise.all([...document.images].map(async (image) => {
      if (image.decode) await image.decode().catch(() => {});
      if (image.naturalWidth === 0) throw new Error(`Image failed to load: ${image.currentSrc || image.src}`);
    }));
  });
}

try {
  await open("/");
  await page.getByRole("heading", { name: /Every payment posts once/i }).waitFor();
  await settleLandingAssets();
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
  const hero = page.locator(".home-hero h1");
  await hero.waitFor();
  await settleLandingAssets();
  const mobileFits = await hero.evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
  if (!mobileFits) throw new Error("mobile hero is visibly clipped");
  await shot("landing-mobile.png");
  await shot("landing-mobile-viewport.png", false);

  await page.setViewportSize({ width: 1440, height: 1000 });
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
