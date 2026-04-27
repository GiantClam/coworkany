import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export interface VisualAcceptanceOptions {
    maxDiffPixelRatio?: number;
    minWidth?: number;
    minHeight?: number;
    categoryHint?: string;
}

type VisualVerdict = {
    score: number;
    verdict: 'pass' | 'revise' | 'fail';
    category_match: boolean;
    differences: string[];
    suggestions: string[];
    reasoning: string;
    generated_screenshot: string;
    reference_image: string;
    threshold: number;
    category_hint?: string;
};

function writeVerdict(testInfo: TestInfo, screenshotName: string, verdict: VisualVerdict): void {
    const safeName = screenshotName.replace(/[^a-z0-9._-]+/giu, '-');
    const verdictPath = testInfo.outputPath(`${safeName}.visual-verdict.json`);
    fs.mkdirSync(path.dirname(verdictPath), { recursive: true });
    fs.writeFileSync(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`, 'utf-8');
}

function buildReferencePath(testInfo: TestInfo, screenshotName: string): string {
    const parsed = path.parse(testInfo.file);
    const projectPart = testInfo.project.name ? `-${testInfo.project.name}` : '';
    return path.join(
        parsed.dir,
        `${parsed.base}-snapshots`,
        `${path.parse(screenshotName).name}${projectPart}-${process.platform}${path.parse(screenshotName).ext}`,
    );
}

export async function stabilizeVisualAcceptanceFrame(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
        const styleId = 'coworkany-visual-acceptance-style';
        if (document.getElementById(styleId)) {
            return;
        }
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          *, *::before, *::after {
            animation: none !important;
            transition: none !important;
            caret-color: transparent !important;
          }
        `;
        document.head.appendChild(style);
    });
    await page.waitForTimeout(600);
}

export async function expectVisualScreenshotAccepted(
    locator: Locator,
    screenshotName: string,
    testInfo: TestInfo,
    options: VisualAcceptanceOptions = {},
): Promise<void> {
    const maxDiffPixelRatio = options.maxDiffPixelRatio ?? 0.01;
    const threshold = Math.round((1 - maxDiffPixelRatio) * 100);
    const referencePath = buildReferencePath(testInfo, screenshotName);

    await expect(locator).toBeVisible({ timeout: 30_000 });
    const box = await locator.boundingBox();
    const minWidth = options.minWidth ?? 320;
    const minHeight = options.minHeight ?? 160;
    if (!box || box.width < minWidth || box.height < minHeight) {
        const verdict: VisualVerdict = {
            score: 0,
            verdict: 'fail',
            category_match: false,
            differences: [`Target screenshot area is too small: ${box ? `${box.width}x${box.height}` : 'not measurable'}`],
            suggestions: ['Assert the correct visible container before taking the screenshot.'],
            reasoning: 'Screenshot target is missing or too small for visual acceptance.',
            generated_screenshot: testInfo.outputPath(screenshotName),
            reference_image: referencePath,
            threshold,
            category_hint: options.categoryHint,
        };
        writeVerdict(testInfo, screenshotName, verdict);
        throw new Error(verdict.reasoning);
    }

    try {
        await expect(locator).toHaveScreenshot(screenshotName, {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio,
        });
        writeVerdict(testInfo, screenshotName, {
            score: 100,
            verdict: 'pass',
            category_match: true,
            differences: [],
            suggestions: [],
            reasoning: 'Screenshot matched the reference within the configured pixel threshold.',
            generated_screenshot: testInfo.outputPath(screenshotName),
            reference_image: referencePath,
            threshold,
            category_hint: options.categoryHint,
        });
    } catch (error) {
        writeVerdict(testInfo, screenshotName, {
            score: 0,
            verdict: 'revise',
            category_match: false,
            differences: ['Screenshot differs from the checked-in reference snapshot.'],
            suggestions: ['Inspect the Playwright screenshot diff and update the UI or snapshot intentionally.'],
            reasoning: error instanceof Error ? error.message : String(error),
            generated_screenshot: testInfo.outputPath(screenshotName),
            reference_image: referencePath,
            threshold,
            category_hint: options.categoryHint,
        });
        throw error;
    }
}
