import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = 'http://127.0.0.1:5173';
const OUTPUT_DIR = path.resolve('test-results', 'ui-acceptance-audit');

async function ensureDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function collectLayoutAudit(page, label) {
  return page.evaluate((viewLabel) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const getSelector = (element) => {
      const id = element.id ? `#${element.id}` : '';
      const classes = typeof element.className === 'string'
        ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map((name) => `.${name}`).join('')
        : '';
      return `${element.tagName.toLowerCase()}${id}${classes}`;
    };

    const controls = Array.from(document.querySelectorAll('button, input, select, textarea, [role="button"]'))
      .filter((element) => isVisible(element))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const inViewport = (
          rect.left >= -1 &&
          rect.top >= -1 &&
          rect.right <= viewportWidth + 1 &&
          rect.bottom <= viewportHeight + 1
        );

        let centerReachable = false;
        if (
          centerX >= 0 &&
          centerX <= viewportWidth &&
          centerY >= 0 &&
          centerY <= viewportHeight
        ) {
          const topElement = document.elementFromPoint(centerX, centerY);
          centerReachable = !!topElement && (topElement === element || element.contains(topElement));
        }

        return {
          selector: getSelector(element),
          text: (element.textContent || '').trim().slice(0, 80),
          inViewport,
          centerReachable,
          rect: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      });

    const controlIssues = controls.filter((item) => !item.inViewport || !item.centerReachable);

    const overflowingElements = Array.from(document.querySelectorAll('h1, h2, h3, p, span, div, label, button, code'))
      .filter((element) => isVisible(element) && (element.textContent || '').trim().length > 0)
      .map((element) => {
        const style = window.getComputedStyle(element);
        const scrollOverflow = element.scrollWidth > element.clientWidth + 1;
        const widthConstrained = element.clientWidth > 0;
        const allowsVisibleOverflow = style.overflowX === 'visible' && style.whiteSpace !== 'normal';
        const rect = element.getBoundingClientRect();
        return {
          selector: getSelector(element),
          text: (element.textContent || '').trim().slice(0, 120),
          issue: widthConstrained && scrollOverflow && allowsVisibleOverflow,
          rectRight: Math.round(rect.right),
        };
      })
      .filter((item) => item.issue || item.rectRight > viewportWidth + 1);

    const doc = document.documentElement;

    return {
      view: viewLabel,
      viewport: { width: viewportWidth, height: viewportHeight },
      horizontalOverflow: doc.scrollWidth > viewportWidth + 1,
      verticalOverflow: doc.scrollHeight > viewportHeight + 1,
      controlIssueCount: controlIssues.length,
      controlIssues: controlIssues.slice(0, 12),
      overflowingElements: overflowingElements.slice(0, 12),
    };
  }, label);
}

async function captureScenario(browser, { label, viewport, openSettings = false, openTasks = false }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  await page.addInitScript(() => {
    localStorage.setItem('coworkany:setupCompleted', JSON.stringify(true));
    localStorage.setItem('coworkany:themeMode', JSON.stringify('dark'));
    localStorage.removeItem('coworkany:shortcuts');
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.layout-sidebar', { timeout: 20000 });
  await page.waitForSelector('.chat-interface, .task-list-view', { timeout: 20000 });

  if (openTasks) {
    await page.locator('.nav-item-collapsed').nth(1).click();
    await page.waitForSelector('.task-list-view, .task-list-empty-shell', { timeout: 10000 });
  }

  if (openSettings) {
    await page.locator('.sidebar-settings-btn').click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  }

  const screenshotPath = path.join(OUTPUT_DIR, `${label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const audit = await collectLayoutAudit(page, label);
  audit.screenshotPath = screenshotPath;

  await context.close();
  return audit;
}

async function run() {
  await ensureDir();

  const browser = await chromium.launch({ headless: true });

  const scenarios = [
    { label: 'desktop-home', viewport: { width: 1440, height: 960 } },
    { label: 'desktop-settings', viewport: { width: 1440, height: 960 }, openSettings: true },
    { label: 'desktop-task-board', viewport: { width: 1440, height: 960 }, openTasks: true },
    { label: 'narrow-home', viewport: { width: 1024, height: 768 } },
    { label: 'narrow-settings', viewport: { width: 1024, height: 768 }, openSettings: true },
  ];

  const results = [];
  for (const scenario of scenarios) {
    results.push(await captureScenario(browser, scenario));
  }

  await browser.close();

  const summary = {
    ok: results.every((result) =>
      !result.horizontalOverflow &&
      result.controlIssueCount === 0 &&
      result.overflowingElements.length === 0
    ),
    results,
  };

  const reportPath = path.join(OUTPUT_DIR, 'report.json');
  await fs.writeFile(reportPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(JSON.stringify({ reportPath, ...summary }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
