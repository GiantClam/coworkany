/**
 * Desktop E2E: Batch stock-research scenarios with a unified runner.
 *
 * Goals:
 * 1) Trigger stock-research tasks from desktop chat input
 * 2) Reuse one scenario framework for query generation and assertions
 * 3) Batch-generate scenarios (including minimax / 衮矿能源 / glm / nvidia)
 * 4) Verify search usage + analysis + prediction quality per scenario
 */

import { test, expect } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';
import {
    buildStockDesktopScenarioMatrix,
    runStockDesktopScenario,
} from './utils/stockScenarioFramework';

const TASK_TIMEOUT_MS = Number(process.env.COWORKANY_STOCK_SCENARIO_TIMEOUT_MS ?? 8 * 60 * 1000);
const POLL_INTERVAL_MS = 3000;

const ARTIFACT_DIR = path.join(process.cwd(), '..', 'artifacts', 'stock-research-desktop-scenarios');

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

test.describe('Desktop stock-research scenarios (batch)', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 240_000);

    const scenarios = buildStockDesktopScenarioMatrix();

    for (const scenario of scenarios) {
        test(`stock scenario: ${scenario.id}`, async ({ page, tauriLogs }) => {
            ensureDir(ARTIFACT_DIR);

            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(10_000);

            const result = await runStockDesktopScenario({
                page,
                tauriLogs,
                scenario,
                timeoutMs: TASK_TIMEOUT_MS,
                pollIntervalMs: POLL_INTERVAL_MS,
            });

            const rawLogs = tauriLogs.getRawSinceBaseline();
            const summary = {
                scenario: {
                    id: scenario.id,
                    title: scenario.title,
                    entities: scenario.entities.map((item) => item.displayName),
                    horizon: scenario.horizon,
                    focus: scenario.focus,
                    minSearchWebCalls: scenario.minSearchWebCalls,
                },
                result,
            };

            fs.writeFileSync(
                path.join(ARTIFACT_DIR, `stock-scenario-${scenario.id}-summary.json`),
                JSON.stringify(summary, null, 2),
                'utf-8',
            );
            fs.writeFileSync(
                path.join(ARTIFACT_DIR, `stock-scenario-${scenario.id}-logs.txt`),
                rawLogs,
                'utf-8',
            );
            await page.screenshot({
                path: path.join(ARTIFACT_DIR, `stock-scenario-${scenario.id}-final.png`),
            }).catch(() => {});

            if (result.externalFailure) {
                test.skip(true, `External dependency/config failure: ${result.taskFailedError || 'see logs'}`);
                return;
            }

            expect(result.submitted, 'desktop chat message should be submitted').toBe(true);
            expect(result.taskFailed, `task should not fail: ${result.taskFailedError}`).toBe(false);
            expect(
                result.searchWebCallCount,
                `search_web should be called at least ${scenario.minSearchWebCalls} times`,
            ).toBeGreaterThanOrEqual(scenario.minSearchWebCalls);
            expect(result.allEntitiesCovered, 'all target stocks should be covered in analysis evidence').toBe(true);
            expect(result.adviceKeywordHits.length, 'analysis should include buy/sell/hold style advice').toBeGreaterThan(0);
            expect(result.predictionKeywordHits.length, 'analysis should include forecast/prediction terms').toBeGreaterThan(0);
            expect(result.completed, 'task should reach finish/ready/quiet completion state').toBe(true);
        });
    }
});
