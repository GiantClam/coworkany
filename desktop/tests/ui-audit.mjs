import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

/* global window */

const BASE_URL = 'http://127.0.0.1:4173';
const OUTPUT_DIR = path.resolve('test-results', 'ui-audit');

async function ensureDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function run() {
  await ensureDir();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.addInitScript(() => {
    localStorage.setItem('coworkany:setupCompleted', 'true');
    localStorage.setItem(
      'coworkany:uiPreferences',
      JSON.stringify({ version: 1, featureFlags: { newShellEnabled: true } })
    );
  });

  const report = {
    timingsMs: {},
    checks: {},
    screenshots: {},
    perf: {},
  };

  const t0 = Date.now();
  const perfStart = Date.now();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.chat-interface', { timeout: 20000 });
  report.timingsMs.launchToReady = Date.now() - t0;

  const homeShot = path.join(OUTPUT_DIR, '01-home.png');
  await page.screenshot({ path: homeShot, fullPage: true });
  report.screenshots.home = homeShot;

  const perf = await page.evaluate(() => {
    const perfObj = window.__coworkanyPerf || null;
    return perfObj;
  });
  report.perf = perf || {};
  report.timingsMs.auditSessionElapsed = Date.now() - perfStart;

  const paletteStart = Date.now();
  await page.keyboard.press('Control+KeyK');
  await page.waitForSelector('.command-palette-content', { timeout: 5000 });
  report.timingsMs.openPalette = Date.now() - paletteStart;

  const paletteShot = path.join(OUTPUT_DIR, '02-command-palette.png');
  await page.screenshot({ path: paletteShot, fullPage: true });
  report.screenshots.commandPalette = paletteShot;

  await page.fill('.command-palette-header input', 'settings');
  await page.keyboard.press('Enter');
  const settingsStart = Date.now();
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  report.timingsMs.openSettings = Date.now() - settingsStart;

  const settingsShot = path.join(OUTPUT_DIR, '03-settings-dialog.png');
  await page.screenshot({ path: settingsShot, fullPage: true });
  report.screenshots.settingsDialog = settingsShot;

  const shellToggleVisible = await page.getByText(/UI Shell|UI 壳层/).isVisible().catch(() => false);
  report.checks.shellToggleVisible = shellToggleVisible;

  // Close settings modal robustly
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(250);
  const dialogStillOpen = await page.locator('[role="dialog"]').isVisible().catch(() => false);
  if (dialogStillOpen) {
    const closeBtn = page.locator('[role="dialog"] button').first();
    await closeBtn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(250);
  }

  const actionStart = Date.now();
  const taskListButton = page.locator('.quick-action-card').nth(2);
  let quickActionError = null;
  try {
    await taskListButton.click({ timeout: 8000 });
    await page.waitForTimeout(700);
    report.timingsMs.quickActionClick = Date.now() - actionStart;
  } catch (err) {
    quickActionError = String(err);
    report.timingsMs.quickActionClick = -1;
    report.checks.quickActionBlocked = true;
    report.checks.quickActionError = quickActionError;
  }

  const postActionShot = path.join(OUTPUT_DIR, '04-after-quick-action.png');
  await page.screenshot({ path: postActionShot, fullPage: true });
  report.screenshots.afterQuickAction = postActionShot;

  const reportPath = path.join(OUTPUT_DIR, 'report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  await browser.close();

  console.log(JSON.stringify({ ok: true, reportPath, report }, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
