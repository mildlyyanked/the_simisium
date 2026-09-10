/**
 * Screenshot the exported web build at phone size.
 *   npm run export:web && node scripts/screenshot.mjs
 * Requires a global `playwright` (present in the CI image) and `serve`.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require(path.join(process.env.NPM_GLOBAL_ROOT ?? '/opt/node22/lib/node_modules', 'playwright'));
}

const PORT = 4173;
const OUT = process.env.SHOT_DIR ?? 'scratch/shots';
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['serve', '-s', 'dist', '-l', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));

const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

const steps = JSON.parse(process.env.SHOT_STEPS ?? '[]');
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/01-title.png` });
let i = 2;
for (const step of steps) {
  try {
    if (step.click) await page.getByText(step.click, { exact: false }).first().click({ timeout: 8000 });
    if (step.fill) await page.getByPlaceholder(step.fill.placeholder).fill(step.fill.value);
    if (step.wait) await page.waitForTimeout(step.wait);
    if (step.eval) await page.evaluate(step.eval);
  } catch (e) {
    errors.push(`step ${JSON.stringify(step)} failed: ${e.message}`);
  }
  await page.screenshot({ path: `${OUT}/${String(i).padStart(2, '0')}-${step.name ?? 'step'}.png` });
  i++;
}
console.log(JSON.stringify({ shots: i - 1, errors }, null, 2));
await browser.close();
server.kill();
process.exit(errors.some((e) => e.startsWith('pageerror')) ? 1 : 0);
