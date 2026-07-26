/**
 * MOCK_MODE click-through: signs in, visits every screen, exercises key
 * interactions, and saves screenshots to ./screenshots (desktop + mobile).
 * Usage: node scripts/clickthrough.mjs [baseUrl]
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = "screenshots";
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "owner@home.local";
const PASSWORD = "password123";

const PAGES = [
  ["dashboard", "/"],
  ["circuits", "/circuits"],
  ["heat", "/heat"],
  ["pump", "/pump"],
  ["chlorinator", "/chlorinator"],
  ["lights", "/lights"],
  ["schedules", "/schedules"],
  ["scenes", "/scenes"],
  ["chemistry", "/chemistry"],
  ["automations", "/automations"],
  ["history", "/history"],
  ["copilot", "/copilot"],
  ["settings", "/settings"],
  ["settings-equipment", "/settings/equipment"],
  ["settings-users", "/settings/users"],
  ["settings-audit", "/settings/audit"],
  ["settings-system", "/settings/system"],
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

async function run(tag, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("pageerror", (err) => errors.push(`[${tag}] pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("favicon")) {
      errors.push(`[${tag}] console: ${msg.text().slice(0, 200)}`);
    }
  });

  // Login flow (also screenshots it).
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/${tag}-00-login.png` });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  await page.waitForTimeout(2500); // let SSE land + dials render

  let index = 1;
  for (const [name, path] of PAGES) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `${OUT}/${tag}-${String(index).padStart(2, "0")}-${name}.png`, fullPage: true });
    } catch (err) {
      errors.push(`[${tag}] ${path}: ${err.message.split("\n")[0]}`);
    }
    index += 1;
  }

  // A couple of interactions on desktop only.
  if (tag === "desktop") {
    try {
      await page.goto(`${BASE}/circuits`, { waitUntil: "networkidle" });
      const sw = page.locator('button[role="switch"]').first();
      await sw.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/${tag}-interaction-toggle.png` });
    } catch (err) {
      errors.push(`[desktop] toggle interaction: ${err.message.split("\n")[0]}`);
    }
    try {
      await page.goto(`${BASE}/copilot`, { waitUntil: "networkidle" });
      const input = page.locator("textarea, input[placeholder]").last();
      await input.fill("what's the salt at?");
      await input.press("Enter");
      await page.waitForTimeout(3500);
      await page.screenshot({ path: `${OUT}/${tag}-interaction-copilot.png`, fullPage: true });
    } catch (err) {
      errors.push(`[desktop] copilot interaction: ${err.message.split("\n")[0]}`);
    }
  }

  await context.close();
}

await run("desktop", { width: 1360, height: 900 });
await run("mobile", { width: 390, height: 844 });
await browser.close();

if (errors.length) {
  console.log("ISSUES:");
  for (const e of [...new Set(errors)]) console.log(" -", e);
  process.exitCode = 1;
} else {
  console.log("Clickthrough clean — screenshots in ./screenshots");
}
