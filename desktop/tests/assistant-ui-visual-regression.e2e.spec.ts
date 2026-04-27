import { test, expect } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { seedPendingApprovalSession } from './utils/assistantUiApprovalSeed';
import {
    expectVisualScreenshotAccepted,
    stabilizeVisualAcceptanceFrame,
} from './utils/visualAcceptance';

type SeedEvent = {
    id: string;
    taskId: string;
    sequence: number;
    type: string;
    timestamp: string;
    payload: Record<string, unknown>;
};

type RealUiTimelineReplayCase = {
    id: string;
    sourceThreadId: string;
    session: {
        taskId: string;
        title: string;
        status: 'running' | 'finished' | 'failed' | 'suspended';
    };
    events: SeedEvent[];
    expectations: {
        expectedVisibleTextIncludes: string[];
        expectedFinalTaskStatus?: 'idle' | 'running' | 'finished' | 'failed' | 'suspended';
        forbiddenVisibleTextIncludes: string[];
    };
};

type RealUiTimelineReplayFixture = {
    cases: RealUiTimelineReplayCase[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadRealUiTimelineReplayCases(): RealUiTimelineReplayCase[] {
    const fixturePath = path.resolve(
        __dirname,
        '../../sidecar/tests/fixtures/real-ui-timeline-replay-cases.json',
    );
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as RealUiTimelineReplayFixture;
    return fixture.cases;
}

function realUiTimelineReplayTheme(caseId: string): 'light' | 'dark' {
    return caseId.includes('comm-004') ? 'dark' : 'light';
}

const realUiTimelineReplayCases = loadRealUiTimelineReplayCases();

async function seedSessionFromEvents(page: any, input: {
    taskId: string;
    title: string;
    status: 'running' | 'finished' | 'failed' | 'suspended';
    events: SeedEvent[];
}): Promise<void> {
    await page.evaluate(async ({ taskId, title, status, events }) => {
        const storeModule = await import('/src/stores/taskEvents/index.ts');
        const store = storeModule.useTaskEventStore.getState();
        const firstTimestamp = events[0]?.timestamp ?? '2026-03-31T12:00:00.000Z';
        const lastTimestamp = events[events.length - 1]?.timestamp ?? firstTimestamp;

        store.reset();
        store.ensureSession(taskId, {
            title,
            status,
            taskMode: 'immediate_task',
            createdAt: firstTimestamp,
            updatedAt: lastTimestamp,
        }, true);
        store.addEvents(events);
        store.setActiveTask(taskId);
    }, input);
}

async function setVisualPreferences(page: any, input: {
    theme: 'light' | 'dark';
    language: 'en' | 'zh';
}): Promise<void> {
    await page.evaluate(async ({ theme, language }) => {
        const themeModule = await import('/src/stores/themeStore.ts');
        themeModule.useThemeStore.getState().setMode(theme);

        const i18nModule = await import('/src/i18n/index.ts');
        await i18nModule.default.changeLanguage(language);
    }, input);
    await page.waitForTimeout(300);
}

function buildDenseTaskTimelineEvents(taskId: string): SeedEvent[] {
    const base = '2026-03-31T15:00:00';
    const event = (sequence: number, type: string, payload: Record<string, unknown>): SeedEvent => ({
        id: `assistant-ui-visual-dense-${sequence}`,
        taskId,
        sequence,
        type,
        timestamp: `${base}.${String(sequence).padStart(3, '0')}Z`,
        payload,
    });
    const taskProgress = [
        { taskId: 'collect', title: 'Collect multi-turn context and attachments', status: 'completed', dependencies: [] },
        { taskId: 'route', title: 'Verify chat/task route boundaries', status: 'completed', dependencies: ['collect'] },
        { taskId: 'tools', title: 'Run required filesystem and browser evidence tools', status: 'in_progress', dependencies: ['route'] },
        { taskId: 'artifact', title: 'Write final workspace/replay-report.json artifact', status: 'pending', dependencies: ['tools'] },
        { taskId: 'review', title: 'Summarize acceptance evidence without false completion', status: 'pending', dependencies: ['artifact'] },
    ];
    const events: SeedEvent[] = [
        event(1, 'CHAT_MESSAGE', {
            role: 'user',
            content: '请分析 4 轮上下文，执行工具，写入 replay-report.json，并说明证据。',
        }),
        event(2, 'TASK_PLAN_READY', {
            mode: 'task',
            summary: 'Multi-turn acceptance replay requires route, evidence, artifact, and UI checks.',
            intentRouting: {
                intent: 'task',
                forcedByUserSelection: true,
                reasonCodes: ['explicit_command'],
            },
            tasks: taskProgress.map((task) => ({
                id: task.taskId,
                title: task.title,
                status: task.status,
                dependencies: task.dependencies,
            })),
            deliverables: [
                { title: 'Replay report JSON artifact' },
                { title: 'Evidence summary in final answer' },
            ],
            checkpoints: [
                { title: 'Route classification locked' },
                { title: 'Tool evidence verified' },
            ],
            executionProfile: {
                primaryHardness: 'multi_step',
                requiredCapabilities: ['workspace_write', 'browser_interaction', 'human_review'],
                blockingRisk: 'manual_step',
                reasons: ['Multiple UI timeline states and output artifact are required.'],
            },
        }),
        event(3, 'PLAN_UPDATED', {
            summary: 'Collected transcript and normalized timeline messages.',
            taskProgress,
        }),
        event(4, 'TASK_RESEARCH_UPDATED', {
            summary: 'Checked live replay fixtures and slow-response samples.',
            sourcesChecked: [
                'real-session-replay-cases.json',
                'desktop timeline fixture',
            ],
        }),
        event(5, 'TOOL_CALLED', {
            toolId: 'read-replay',
            toolName: 'read_file',
            args: { path: 'sidecar/tests/fixtures/real-session-replay-cases.json' },
        }),
        event(6, 'TOOL_RESULT', {
            toolId: 'read-replay',
            success: true,
            resultSummary: 'Loaded 7 replay cases.',
        }),
        event(7, 'TOOL_CALLED', {
            toolId: 'browser-check',
            toolName: 'browser_screenshot',
            args: { target: 'assistant timeline' },
        }),
        event(8, 'TOOL_RESULT', {
            toolId: 'browser-check',
            success: true,
            resultSummary: 'Captured assistant UI state.',
        }),
        event(9, 'TASK_CHECKPOINT_REACHED', {
            title: 'Checkpoint: evidence gathered',
            summary: 'Route, browser, and file evidence are visible in the task card.',
        }),
        event(10, 'TASK_USER_ACTION_REQUIRED', {
            kind: 'manual_review',
            title: 'Manual review required',
            description: 'Confirm the dense timeline remains readable before finalizing.',
            reason: 'Dense timeline visual review',
            questions: ['Does the task card remain readable with multiple sections?'],
            instructions: ['Review the visual acceptance screenshot before approval.'],
            routeChoices: [
                { label: 'Looks good', value: 'approve_dense_timeline' },
                { label: 'Needs adjustment', value: 'revise_dense_timeline' },
            ],
        }),
        event(11, 'PLAN_UPDATED', {
            summary: 'Waiting for dense timeline visual review.',
            taskProgress: taskProgress.map((task) => task.taskId === 'review'
                ? { ...task, status: 'blocked' }
                : task),
        }),
        event(12, 'TASK_FINISHED', {
            summary: 'Dense timeline replay finished after route, evidence, artifact, and manual-review checks.',
            finishReason: 'stop',
            artifacts: ['workspace/replay-report.json'],
            files: ['workspace/replay-report.json'],
        }),
    ];
    return events;
}

test.describe('assistant-ui visual regression', () => {
    test.setTimeout(120_000);

    test('thinking state remains consistent', async ({ page }: any, testInfo) => {
        await seedSessionFromEvents(page, {
            taskId: 'assistant-ui-visual-thinking',
            title: 'assistant-ui visual thinking',
            status: 'running',
            events: [
                {
                    id: 'assistant-ui-visual-thinking-user',
                    taskId: 'assistant-ui-visual-thinking',
                    sequence: 1,
                    type: 'CHAT_MESSAGE',
                    timestamp: '2026-03-31T10:00:00.000Z',
                    payload: {
                        role: 'user',
                        content: '请开始执行任务',
                    },
                },
            ],
        });
        await setVisualPreferences(page, { theme: 'dark', language: 'zh' });
        await stabilizeVisualAcceptanceFrame(page);

        await expect(page.getByText('等待模型响应').first()).toBeVisible({
            timeout: 30_000,
        });
        await expectVisualScreenshotAccepted(page.locator('.chat-interface'), 'assistant-ui-thinking-state-dark-zh.png', testInfo, {
            maxDiffPixelRatio: 0.01,
            categoryHint: 'assistant-ui-thinking',
        });
    });

    test('response state remains consistent', async ({ page }: any, testInfo) => {
        const answer = '任务已完成：视觉回归流程正常。';
        await seedSessionFromEvents(page, {
            taskId: 'assistant-ui-visual-response',
            title: 'assistant-ui visual response',
            status: 'finished',
            events: [
                {
                    id: 'assistant-ui-visual-response-user',
                    taskId: 'assistant-ui-visual-response',
                    sequence: 1,
                    type: 'CHAT_MESSAGE',
                    timestamp: '2026-03-31T11:00:00.000Z',
                    payload: {
                        role: 'user',
                        content: '请给出结果总结',
                    },
                },
                {
                    id: 'assistant-ui-visual-response-delta',
                    taskId: 'assistant-ui-visual-response',
                    sequence: 2,
                    type: 'TEXT_DELTA',
                    timestamp: '2026-03-31T11:00:03.000Z',
                    payload: {
                        role: 'assistant',
                        delta: answer,
                    },
                },
                {
                    id: 'assistant-ui-visual-response-finish',
                    taskId: 'assistant-ui-visual-response',
                    sequence: 3,
                    type: 'TASK_FINISHED',
                    timestamp: '2026-03-31T11:00:03.500Z',
                    payload: {
                        summary: answer,
                        finishReason: 'stop',
                    },
                },
            ],
        });
        await setVisualPreferences(page, { theme: 'light', language: 'en' });
        await stabilizeVisualAcceptanceFrame(page);

        await expect(page.getByText(answer)).toBeVisible({ timeout: 30_000 });
        await expectVisualScreenshotAccepted(page.locator('.chat-interface'), 'assistant-ui-response-state-light-en.png', testInfo, {
            maxDiffPixelRatio: 0.01,
            categoryHint: 'assistant-ui-response',
        });
    });

    test('approval card state remains consistent', async ({ page }: any, testInfo) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000);

        await seedPendingApprovalSession(page, {
            taskId: 'assistant-ui-visual-approval',
            requestId: 'assistant-ui-visual-approval-request',
        });
        await setVisualPreferences(page, { theme: 'dark', language: 'en' });
        await stabilizeVisualAcceptanceFrame(page);

        await expect(page.getByText('High risk approvals')).toBeVisible({ timeout: 30_000 });
        await expectVisualScreenshotAccepted(page.locator('.chat-interface'), 'assistant-ui-approval-state-dark-en.png', testInfo, {
            maxDiffPixelRatio: 0.01,
            categoryHint: 'assistant-ui-approval',
        });
    });

    test('recoverable failure state remains understandable', async ({ page }: any, testInfo) => {
        const taskId = 'assistant-ui-visual-failure';
        await seedSessionFromEvents(page, {
            taskId,
            title: 'assistant-ui visual failure',
            status: 'failed',
            events: [
                {
                    id: 'assistant-ui-visual-failure-user',
                    taskId,
                    sequence: 1,
                    type: 'CHAT_MESSAGE',
                    timestamp: '2026-03-31T12:00:00.000Z',
                    payload: {
                        role: 'user',
                        content: '请写入 workspace/result.json',
                    },
                },
                {
                    id: 'assistant-ui-visual-failure-started',
                    taskId,
                    sequence: 2,
                    type: 'TASK_STARTED',
                    timestamp: '2026-03-31T12:00:01.000Z',
                    payload: {
                        title: 'assistant-ui visual failure',
                    },
                },
                {
                    id: 'assistant-ui-visual-failure-failed',
                    taskId,
                    sequence: 3,
                    type: 'TASK_FAILED',
                    timestamp: '2026-03-31T12:00:03.000Z',
                    payload: {
                        error: 'workflow_missing_required_tool_evidence:artifact_write',
                        errorCode: 'E_PROTOCOL_MISSING_TOOL_EVIDENCE',
                        recoverable: true,
                        suggestion: 'Retry this task and ensure required tools are invoked before completion.',
                    },
                },
            ],
        });
        await setVisualPreferences(page, { theme: 'light', language: 'en' });
        await stabilizeVisualAcceptanceFrame(page);

        await expect(page.getByText('Execution steps were not run')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('Retry').first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('workflow_missing_required_tool_evidence')).toHaveCount(0);
        await expectVisualScreenshotAccepted(page.locator('.chat-interface'), 'assistant-ui-recoverable-failure-state-light-en.png', testInfo, {
            maxDiffPixelRatio: 0.01,
            categoryHint: 'assistant-ui-recoverable-failure',
        });
    });

    test('configuration-required failure state remains actionable', async ({ page }: any, testInfo) => {
        const taskId = 'assistant-ui-visual-config-required';
        await seedSessionFromEvents(page, {
            taskId,
            title: 'assistant-ui visual config required',
            status: 'failed',
            events: [
                {
                    id: 'assistant-ui-visual-config-required-user',
                    taskId,
                    sequence: 1,
                    type: 'CHAT_MESSAGE',
                    timestamp: '2026-03-31T13:00:00.000Z',
                    payload: {
                        role: 'user',
                        content: '请用当前模型生成总结',
                    },
                },
                {
                    id: 'assistant-ui-visual-config-required-started',
                    taskId,
                    sequence: 2,
                    type: 'TASK_STARTED',
                    timestamp: '2026-03-31T13:00:01.000Z',
                    payload: {
                        title: 'assistant-ui visual config required',
                    },
                },
                {
                    id: 'assistant-ui-visual-config-required-failed',
                    taskId,
                    sequence: 3,
                    type: 'TASK_FAILED',
                    timestamp: '2026-03-31T13:00:03.000Z',
                    payload: {
                        error: 'unable to get issuer certificate',
                        errorCode: 'PROVIDER_TLS_TRUST_FAILURE',
                        failureClass: 'configuration_required',
                        recoverable: true,
                        suggestion: 'Update provider TLS trust settings, then retry.',
                    },
                },
            ],
        });
        await setVisualPreferences(page, { theme: 'light', language: 'en' });
        await stabilizeVisualAcceptanceFrame(page);

        await expect(page.getByText('Provider configuration required')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('Open LLM Settings').first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('workflow_missing_required_tool_evidence')).toHaveCount(0);
        await expectVisualScreenshotAccepted(page.locator('.chat-interface'), 'assistant-ui-configuration-required-state-light-en.png', testInfo, {
            maxDiffPixelRatio: 0.01,
            categoryHint: 'assistant-ui-configuration-required',
        });
    });

    test('suspended state remains recoverable and readable', async ({ page }: any, testInfo) => {
        const taskId = 'assistant-ui-visual-suspended';
        await seedSessionFromEvents(page, {
            taskId,
            title: 'assistant-ui visual suspended',
            status: 'suspended',
            events: [
                {
                    id: 'assistant-ui-visual-suspended-user',
                    taskId,
                    sequence: 1,
                    type: 'CHAT_MESSAGE',
                    timestamp: '2026-03-31T14:00:00.000Z',
                    payload: {
                        role: 'user',
                        content: '继续执行需要人工确认的任务',
                    },
                },
                {
                    id: 'assistant-ui-visual-suspended-started',
                    taskId,
                    sequence: 2,
                    type: 'TASK_STARTED',
                    timestamp: '2026-03-31T14:00:01.000Z',
                    payload: {
                        title: 'assistant-ui visual suspended',
                    },
                },
                {
                    id: 'assistant-ui-visual-suspended-event',
                    taskId,
                    sequence: 3,
                    type: 'TASK_SUSPENDED',
                    timestamp: '2026-03-31T14:00:03.000Z',
                    payload: {
                        reason: 'waiting_for_user',
                        userMessage: 'Waiting for confirmation before continuing.',
                        canAutoResume: false,
                    },
                },
            ],
        });
        await setVisualPreferences(page, { theme: 'dark', language: 'en' });
        await stabilizeVisualAcceptanceFrame(page);

        await expect(page.getByText('Suspended').first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('Task suspended')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('Waiting for confirmation before continuing.')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('Retry').first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('undefined')).toHaveCount(0);
        await expectVisualScreenshotAccepted(page.locator('.chat-interface'), 'assistant-ui-suspended-state-dark-en.png', testInfo, {
            maxDiffPixelRatio: 0.01,
            categoryHint: 'assistant-ui-suspended',
        });
    });

    test('dense multi-turn task timeline remains scannable', async ({ page }: any, testInfo) => {
        const taskId = 'assistant-ui-visual-dense-timeline';
        await seedSessionFromEvents(page, {
            taskId,
            title: 'assistant-ui visual dense timeline',
            status: 'finished',
            events: buildDenseTaskTimelineEvents(taskId),
        });
        await setVisualPreferences(page, { theme: 'light', language: 'en' });
        await stabilizeVisualAcceptanceFrame(page);

        await expect(page.getByText('Dense timeline replay finished after route, evidence, artifact, and manual-review checks.')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByLabel('task status finished').first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('progress: 5/5')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('undefined')).toHaveCount(0);
        await expectVisualScreenshotAccepted(page.locator('.chat-interface'), 'assistant-ui-dense-task-timeline-light-en.png', testInfo, {
            maxDiffPixelRatio: 0.01,
            categoryHint: 'assistant-ui-dense-task-timeline',
        });
    });

    test('dense task timeline remains usable on narrow viewport', async ({ page }: any, testInfo) => {
        const taskId = 'assistant-ui-visual-dense-mobile';
        await seedSessionFromEvents(page, {
            taskId,
            title: 'assistant-ui visual dense mobile',
            status: 'finished',
            events: buildDenseTaskTimelineEvents(taskId),
        });
        await setVisualPreferences(page, { theme: 'dark', language: 'en' });
        await stabilizeVisualAcceptanceFrame(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(600);

        await expect(page.getByText('Dense timeline replay finished after route, evidence, artifact, and manual-review checks.')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByLabel('task status finished').first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('progress: 5/5')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.chat-interface')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('undefined')).toHaveCount(0);
        await expectVisualScreenshotAccepted(page.locator('.chat-interface'), 'assistant-ui-dense-task-timeline-narrow-dark-en.png', testInfo, {
            maxDiffPixelRatio: 0.04,
            minWidth: 260,
            minHeight: 320,
            categoryHint: 'assistant-ui-dense-task-timeline-narrow',
        });
    });

    for (const replayCase of realUiTimelineReplayCases) {
        test(`real DB UI timeline replay remains visually diagnosable: ${replayCase.id}`, async ({ page }: any, testInfo) => {
            const theme = realUiTimelineReplayTheme(replayCase.id);
            await seedSessionFromEvents(page, {
                taskId: replayCase.session.taskId,
                title: replayCase.session.title,
                status: replayCase.session.status,
                events: replayCase.events,
            });
            await setVisualPreferences(page, { theme, language: 'en' });
            await stabilizeVisualAcceptanceFrame(page);

            if (replayCase.expectations.expectedFinalTaskStatus === 'finished') {
                const finishedEvent = [...replayCase.events].reverse().find((event) => event.type === 'TASK_FINISHED');
                const summary = typeof finishedEvent?.payload.summary === 'string' ? finishedEvent.payload.summary : '';
                await expect(page.getByText(summary).first()).toBeVisible({ timeout: 30_000 });
                await expect(page.getByLabel('task status finished').first()).toBeVisible({ timeout: 30_000 });
            }
            for (const text of replayCase.expectations.forbiddenVisibleTextIncludes) {
                await expect(page.getByText(text)).toHaveCount(0);
            }
            await expectVisualScreenshotAccepted(
                page.locator('.chat-interface'),
                `assistant-ui-real-db-${replayCase.id}.png`,
                testInfo,
                {
                    maxDiffPixelRatio: 0.01,
                    categoryHint: `assistant-ui-real-db-${replayCase.sourceThreadId}`,
                },
            );
        });
    }
});
