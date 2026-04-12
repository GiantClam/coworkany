/**
 * Desktop E2E: regression for minimax market query routing/output.
 *
 * Guards against:
 * 1) placeholder output like "Seeded from user request: ..."
 * 2) no tool invocation for market-data style queries
 * 3) silent/no-terminal state for the task
 */

import { test, expect } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';

const TASK_TIMEOUT_MS = 4 * 60 * 1000;
const POLL_INTERVAL_MS = 2500;
const QUERY = '今天 minimax 的港股股价怎么样？本周会有哪些趋势？';

const EXTERNAL_FAILURE_PATTERNS: RegExp[] = [
    /insufficient_quota/i,
    /billing/i,
    /missing api key/i,
    /invalid api key/i,
    /provider not configured/i,
    /unauthorized|forbidden|payment required/i,
    /http[^.\n]{0,30}\b(401|402|403)\b/i,
];

type StartTaskResponse = {
    success: boolean;
    taskId: string;
    error?: string;
};

type SidecarEvent = {
    type: string;
    taskId?: string;
    payload?: Record<string, unknown>;
};

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function stringifyPayloadValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value === null || value === undefined) return '';
    try {
        return JSON.stringify(value);
    } catch {
        return '';
    }
}

function parseSidecarEvents(rawLogs: string): SidecarEvent[] {
    const events: SidecarEvent[] = [];
    const marker = 'Received from sidecar: ';

    for (const line of rawLogs.split(/\r?\n/)) {
        const idx = line.indexOf(marker);
        if (idx < 0) continue;
        const jsonPart = line.slice(idx + marker.length).trim();
        if (!jsonPart.startsWith('{')) continue;
        try {
            const parsed = JSON.parse(jsonPart) as SidecarEvent;
            if (!parsed || typeof parsed.type !== 'string') continue;
            events.push(parsed);
        } catch {
            // Ignore malformed lines.
        }
    }

    return events;
}

function hasExternalFailureSignal(text: string): boolean {
    return EXTERNAL_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

async function invokeTauri<T>(page: any, cmd: string, input: Record<string, unknown>): Promise<T> {
    return await page.evaluate(
        async ({ c, i }) => {
            const tauri = (window as Window & {
                __TAURI_INTERNALS__?: {
                    invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
                };
            }).__TAURI_INTERNALS__;
            if (!tauri?.invoke) {
                throw new Error('__TAURI_INTERNALS__.invoke is unavailable');
            }
            return await tauri.invoke(c, { input: i });
        },
        { c: cmd, i: input },
    ) as T;
}

test.describe('Desktop minimax market routing regression', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 120_000);

    test('@critical @regression start_task market query should call tools and avoid seeded placeholder output', async ({ page, tauriLogs }) => {
        const testResultsDir = path.join(process.cwd(), 'test-results');
        ensureDir(testResultsDir);

        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(8_000);

        const workspacePath = await invokeTauri<string>(page, 'get_workspace_root', {});

        tauriLogs.setBaseline();
        const startResponse = await invokeTauri<StartTaskResponse>(page, 'start_task', {
            title: QUERY,
            userQuery: QUERY,
            workspacePath,
            config: {
                // Intentionally request workflow to verify sidecar still forces tool-first direct task path.
                executionPath: 'workflow',
            },
        });

        let taskFailed = false;
        let taskFailedError = '';
        let taskFinished = false;
        let finishReason = '';
        const toolCallNames = new Set<string>();
        const assistantChunks: string[] = [];

        const startAt = Date.now();
        while (Date.now() - startAt < TASK_TIMEOUT_MS) {
            await page.waitForTimeout(POLL_INTERVAL_MS);

            const rawLogs = tauriLogs.getRawSinceBaseline();
            const events = parseSidecarEvents(rawLogs).filter((event) => event.taskId === startResponse.taskId);

            for (const event of events) {
                if (event.type === 'TASK_EVENT') {
                    const payloadType = String(event.payload?.type ?? '').toLowerCase();
                    if (payloadType === 'tool_call') {
                        const toolName = String(event.payload?.toolName ?? '').trim();
                        if (toolName) {
                            toolCallNames.add(toolName);
                        }
                    }
                }

                if (event.type === 'TOOL_CALL') {
                    const toolName = String(event.payload?.name ?? '').trim();
                    if (toolName) {
                        toolCallNames.add(toolName);
                    }
                }

                if (event.type === 'TEXT_DELTA') {
                    const role = String(event.payload?.role ?? '').toLowerCase();
                    if (role === 'assistant') {
                        const delta = stringifyPayloadValue(event.payload?.delta);
                        if (delta.trim().length > 0) {
                            assistantChunks.push(delta);
                        }
                    }
                }

                if (event.type === 'TASK_FAILED') {
                    taskFailed = true;
                    taskFailedError = stringifyPayloadValue(event.payload?.error || event.payload);
                }

                if (event.type === 'TASK_FINISHED') {
                    taskFinished = true;
                    finishReason = stringifyPayloadValue(event.payload?.finishReason).trim();
                }
            }

            if (taskFinished || taskFailed) {
                break;
            }
        }

        const rawLogs = tauriLogs.getRawSinceBaseline();
        const events = parseSidecarEvents(rawLogs).filter((event) => event.taskId === startResponse.taskId);
        const taskText = [
            ...assistantChunks,
            ...events.map((event) => stringifyPayloadValue(event.payload)),
        ].join('\n');

        const summary = {
            query: QUERY,
            startResponse,
            taskFinished,
            taskFailed,
            taskFailedError,
            finishReason,
            toolCallNames: Array.from(toolCallNames),
            assistantTextLength: taskText.length,
            hasSeededPlaceholder: /Seeded from user request:/i.test(taskText),
        };

        fs.writeFileSync(
            path.join(testResultsDir, 'minimax-market-routing-regression-summary.json'),
            JSON.stringify(summary, null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(testResultsDir, 'minimax-market-routing-regression-logs.txt'),
            rawLogs,
            'utf-8',
        );
        await page.screenshot({
            path: path.join(testResultsDir, 'minimax-market-routing-regression-final.png'),
        }).catch(() => {});

        const combinedFailureText = `${startResponse.error ?? ''}\n${taskFailedError}\n${taskText}`;
        if (hasExternalFailureSignal(combinedFailureText)) {
            test.skip(true, `External dependency/config failure: ${taskFailedError || startResponse.error || 'see logs'}`);
            return;
        }

        expect(startResponse.success, `start_task should succeed: ${startResponse.error ?? 'unknown'}`).toBe(true);
        expect(taskFinished || taskFailed, 'task should reach terminal state').toBe(true);
        expect(taskFailed, `task should not fail: ${taskFailedError}`).toBe(false);

        expect(
            taskText.includes('Seeded from user request:'),
            'assistant narrative should never surface seeded placeholder text',
        ).toBe(false);

        const capabilityMissing = finishReason === 'capability_missing'
            || /required_capabilities=.*missing_capabilities=/i.test(taskText);
        if (capabilityMissing) {
            expect(
                /required_capabilities=.*missing_capabilities=/i.test(taskText),
                'capability gate should explain required/missing capabilities when tool runtime is unavailable',
            ).toBe(true);
            return;
        }

        const hasMarketToolCall = Array.from(toolCallNames).some((name) =>
            /search|finance|crawl|researcher/i.test(name),
        );
        expect(
            hasMarketToolCall,
            `market query should call research/data tools, got: ${Array.from(toolCallNames).join(', ') || '(none)'}`,
        ).toBe(true);

        expect(taskText.trim().length, 'assistant should emit non-empty narrative text').toBeGreaterThan(0);
    });
});
