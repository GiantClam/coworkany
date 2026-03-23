import type { Page } from '@playwright/test';
import type { TauriLogCollector } from '../tauriFixture';

export type BrowserBackendKind = 'agentbrowser' | 'playwright';
export type BrowserTargetSite = 'x' | 'reddit' | 'xiaohongshu';

type SidecarEvent = {
    type: string;
    taskId?: string;
    payload?: Record<string, unknown>;
    sequence?: number;
};

type TaskInput = {
    id: string;
    site: BrowserTargetSite;
    backend: BrowserBackendKind;
    title: string;
    marker: string;
    targetUrl: string;
    loginSensitive: boolean;
    expectedDomains: string[];
    query: string;
};

type StartTaskResponse = {
    success: boolean;
    taskId: string;
    error?: string;
};

export type BrowserTaskInventoryItem = {
    id: string;
    backend: BrowserBackendKind;
    site: BrowserTargetSite;
    targetUrl: string;
    loginSensitive: boolean;
    expectedDomains: string[];
    summary: string;
};

export type BrowserConcurrentScenario = {
    id: string;
    title: string;
    tasks: BrowserTaskInventoryItem[];
};

export type BrowserTaskRunResult = {
    taskId: string;
    taskLabel: string;
    marker: string;
    backend: BrowserBackendKind;
    site: BrowserTargetSite;
    submitted: boolean;
    started: boolean;
    finished: boolean;
    failed: boolean;
    failedError: string;
    browserToolCallCount: number;
    browserNavigateCallCount: number;
    browserAiActionCallCount: number;
    modeSetSmart: boolean;
    modeSetPrecise: boolean;
    targetDomainSeen: boolean;
    markerSeen: boolean;
    loginPrompted: boolean;
    suspendedCount: number;
    resumedCount: number;
    followUpSent: boolean;
    followUpSendError: string;
    resumedAfterFollowUp: boolean;
    browserCallsAfterResume: number;
    ownMarkerOnly: boolean;
    foreignMarkersSeen: string[];
    evidenceTextLength: number;
    externalFailure: boolean;
    backendExpectationMet: boolean;
    loginExpectationMet: boolean;
    completionExpectationMet: boolean;
};

export type BrowserConcurrentScenarioRunResult = {
    scenarioId: string;
    scenarioTitle: string;
    taskCount: number;
    allSubmitted: boolean;
    allStarted: boolean;
    allNoFailure: boolean;
    isolationOk: boolean;
    backendCoverageOk: boolean;
    loginCollaborationOk: boolean;
    completionOk: boolean;
    allTasksPassed: boolean;
    externalFailure: boolean;
    tasks: BrowserTaskRunResult[];
};

const TASK_LIBRARY: Record<string, BrowserTaskInventoryItem> = {
    x_agentbrowser: {
        id: 'x-agentbrowser',
        backend: 'agentbrowser',
        site: 'x',
        targetUrl: 'https://x.com/home',
        loginSensitive: true,
        expectedDomains: ['x.com', 'twitter.com'],
        summary: 'Use smart mode (agentbrowser) to open X, support login suspend/resume, then continue extraction.',
    },
    x_playwright: {
        id: 'x-playwright',
        backend: 'playwright',
        site: 'x',
        targetUrl: 'https://x.com/explore',
        loginSensitive: true,
        expectedDomains: ['x.com', 'twitter.com'],
        summary: 'Use precise mode (Playwright selectors/tools) on X and keep login-collaboration behavior.',
    },
    reddit_agentbrowser: {
        id: 'reddit-agentbrowser',
        backend: 'agentbrowser',
        site: 'reddit',
        targetUrl: 'https://www.reddit.com/r/artificial/',
        loginSensitive: false,
        expectedDomains: ['reddit.com'],
        summary: 'Use smart mode (agentbrowser) on Reddit and extract first visible post title.',
    },
    reddit_playwright: {
        id: 'reddit-playwright',
        backend: 'playwright',
        site: 'reddit',
        targetUrl: 'https://www.reddit.com/r/artificial/',
        loginSensitive: false,
        expectedDomains: ['reddit.com'],
        summary: 'Use precise mode (Playwright) on Reddit and extract first visible post title.',
    },
    xiaohongshu_agentbrowser: {
        id: 'xiaohongshu-agentbrowser',
        backend: 'agentbrowser',
        site: 'xiaohongshu',
        targetUrl: 'https://www.xiaohongshu.com/explore',
        loginSensitive: true,
        expectedDomains: ['xiaohongshu.com'],
        summary: 'Use smart mode (agentbrowser) on Xiaohongshu, request login when needed, then continue.',
    },
    xiaohongshu_playwright: {
        id: 'xiaohongshu-playwright',
        backend: 'playwright',
        site: 'xiaohongshu',
        targetUrl: 'https://www.xiaohongshu.com/explore',
        loginSensitive: true,
        expectedDomains: ['xiaohongshu.com'],
        summary: 'Use precise mode (Playwright) on Xiaohongshu with login suspend/resume path.',
    },
};

const SCENARIO_BLUEPRINTS: Array<{
    id: string;
    title: string;
    taskIds: Array<keyof typeof TASK_LIBRARY>;
}> = [
    {
        id: 'social-mixed-triple',
        title: 'X/Reddit/Xiaohongshu mixed parallel run (agentbrowser + playwright)',
        taskIds: ['x_agentbrowser', 'reddit_playwright', 'xiaohongshu_agentbrowser'],
    },
    {
        id: 'social-mixed-quad',
        title: 'Cross-backend social stress run (4 parallel tasks)',
        taskIds: ['x_agentbrowser', 'reddit_agentbrowser', 'xiaohongshu_agentbrowser', 'reddit_playwright'],
    },
];

const EXTERNAL_FAILURE_PATTERNS: RegExp[] = [
    /browser-use-service is not available/i,
    /smart mode is unavailable/i,
    /smartmodeavailable":false/i,
    /no shared cdp chrome session/i,
    /shared browser session/i,
    /requires a shared browser session/i,
    /missing api key|invalid api key|openai api key/i,
    /insufficient_quota|rate_limit|too many requests/i,
    /unauthorized|forbidden|payment required/i,
    /http[^.\n]{0,30}\b(401|402|403)\b/i,
];

const LOGIN_HINT_PATTERNS: RegExp[] = [
    /login/i,
    /sign in/i,
    /please login/i,
    /waiting for user login/i,
    /task suspended/i,
    /登录/,
    /请先登录/,
];

const READY_FOR_FOLLOW_UP = 'ready for follow-up';

function normalize(text: string): string {
    return text.toLowerCase();
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
            const event = JSON.parse(jsonPart) as SidecarEvent;
            if (event && typeof event.type === 'string') {
                events.push(event);
            }
        } catch {
            // Ignore malformed lines.
        }
    }

    return events;
}

function collectEvidenceText(taskEvents: SidecarEvent[]): string {
    const chunks: string[] = [];
    for (const event of taskEvents) {
        if (event.type === 'TEXT_DELTA') {
            chunks.push(stringifyPayloadValue(event.payload?.delta));
            continue;
        }
        if (event.type === 'TOOL_RESULT') {
            chunks.push(stringifyPayloadValue(event.payload?.result));
            chunks.push(stringifyPayloadValue(event.payload?.resultSummary));
            continue;
        }
        if (event.type === 'TASK_SUSPENDED' || event.type === 'TASK_RESUMED' || event.type === 'TASK_FAILED') {
            chunks.push(stringifyPayloadValue(event.payload));
        }
    }
    return chunks.join('\n').trim();
}

function isBrowserToolCall(event: SidecarEvent): boolean {
    if (event.type !== 'TOOL_CALL') return false;
    const name = String(event.payload?.name ?? '');
    return name.startsWith('browser_') || name === 'open_in_browser';
}

function getStartedDescription(taskEvents: SidecarEvent[]): string {
    const started = taskEvents.find((event) => event.type === 'TASK_STARTED');
    return stringifyPayloadValue(started?.payload?.description);
}

function hasExternalFailureSignal(text: string): boolean {
    return EXTERNAL_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

function hasLoginHint(text: string): boolean {
    return LOGIN_HINT_PATTERNS.some((pattern) => pattern.test(text));
}

async function invokeTauri<T>(page: Page, cmd: string, input: Record<string, unknown>): Promise<T> {
    return await page.evaluate(
        async ({ c, i }) => {
            const tauri = (window as Window & {
                __TAURI_INTERNALS__?: {
                    invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
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

function buildScenarioQuery(input: TaskInput): string {
    const header = [
        `You are executing a desktop browser regression task with marker ${input.marker}.`,
        `Target website: ${input.targetUrl}`,
        `Required backend: ${input.backend}`,
    ];

    const backendConstraints = input.backend === 'agentbrowser'
        ? [
            '1) You MUST call browser_set_mode with mode="smart" before browser actions.',
            '2) You MUST execute at least one browser_ai_action call.',
            '3) Reach the target page primarily via browser_ai_action and then extract current URL + title.',
        ]
        : [
            '1) You MUST call browser_set_mode with mode="precise" before browser actions.',
            '2) Use precise browser tools (browser_navigate/browser_get_content/browser_execute_script/browser_click/browser_fill).',
            '3) Navigate to the target URL and extract current page URL + title.',
        ];

    const loginConstraints = input.loginSensitive
        ? [
            'If account-gated access appears, use the built-in user-assistance suspend workflow.',
        ]
        : [
            'No account-gated flow is expected. Proceed directly unless the site blocks content.',
        ];

    return [
        ...header,
        'Hard requirements:',
        ...backendConstraints,
        '4) Keep browser operations minimal and deterministic; do not switch to unrelated websites.',
        ...loginConstraints,
        `5) Final response must include marker ${input.marker} exactly once.`,
    ].join('\n');
}

function buildTaskInputs(scenario: BrowserConcurrentScenario): TaskInput[] {
    return scenario.tasks.map((task, index) => {
        const marker = `BROWSER_SCENARIO_${scenario.id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_${index + 1}`;
        const title = `Browser concurrency ${scenario.id} ${task.site} ${task.backend} #${index + 1}`;
        const query = buildScenarioQuery({
            id: task.id,
            site: task.site,
            backend: task.backend,
            title,
            marker,
            targetUrl: task.targetUrl,
            loginSensitive: task.loginSensitive,
            expectedDomains: task.expectedDomains,
            query: '',
        });
        return {
            id: task.id,
            site: task.site,
            backend: task.backend,
            title,
            marker,
            targetUrl: task.targetUrl,
            loginSensitive: task.loginSensitive,
            expectedDomains: task.expectedDomains,
            query,
        };
    });
}

function evaluateTaskResult(input: TaskInput, taskId: string, taskEvents: SidecarEvent[], allMarkers: string[]): BrowserTaskRunResult {
    const toolCalls = taskEvents.filter((event) => event.type === 'TOOL_CALL');
    const browserToolCalls = toolCalls.filter(isBrowserToolCall);
    const navigateCalls = toolCalls.filter((event) => String(event.payload?.name ?? '') === 'browser_navigate');
    const aiActionCalls = toolCalls.filter((event) => String(event.payload?.name ?? '') === 'browser_ai_action');
    const modeCalls = toolCalls.filter((event) => String(event.payload?.name ?? '') === 'browser_set_mode');
    const modeSetSmart = modeCalls.some((event) => String((event.payload?.input as Record<string, unknown> | undefined)?.mode ?? '') === 'smart');
    const modeSetPrecise = modeCalls.some((event) => String((event.payload?.input as Record<string, unknown> | undefined)?.mode ?? '') === 'precise');

    const started = taskEvents.some((event) => event.type === 'TASK_STARTED');
    const finished = taskEvents.some((event) => event.type === 'TASK_FINISHED');
    const failedEvent = taskEvents.find((event) => event.type === 'TASK_FAILED');
    const failed = Boolean(failedEvent);
    const failedError = stringifyPayloadValue(failedEvent?.payload?.error);

    const suspendedEvents = taskEvents.filter((event) => event.type === 'TASK_SUSPENDED');
    const resumedEvents = taskEvents.filter((event) => event.type === 'TASK_RESUMED');
    const suspendedCount = suspendedEvents.length;
    const resumedCount = resumedEvents.length;

    const evidenceText = collectEvidenceText(taskEvents);
    const startedDescription = getStartedDescription(taskEvents);
    const mergedText = `${startedDescription}\n${evidenceText}`;
    const lowerText = normalize(mergedText);

    const markerSeen = lowerText.includes(input.marker.toLowerCase());
    const loginPrompted = hasLoginHint(mergedText);

    const targetDomainSeen = input.expectedDomains.some((domain) => {
        const fromNavigate = navigateCalls.some((event) => {
            const url = stringifyPayloadValue((event.payload?.input as Record<string, unknown> | undefined)?.url);
            return normalize(url).includes(domain);
        });
        return fromNavigate || lowerText.includes(domain.toLowerCase());
    });

    const foreignMarkersSeen = allMarkers
        .filter((marker) => marker !== input.marker)
        .filter((marker) => lowerText.includes(marker.toLowerCase()));

    const firstResumeIndex = taskEvents.findIndex((event) => event.type === 'TASK_RESUMED');
    const browserCallsAfterResume = firstResumeIndex < 0
        ? 0
        : taskEvents.slice(firstResumeIndex + 1).filter(isBrowserToolCall).length;

    const resumedAfterFollowUp = resumedCount > 0;
    const backendExpectationMet = input.backend === 'agentbrowser'
        ? modeSetSmart && aiActionCalls.length > 0
        : modeSetPrecise && navigateCalls.length > 0;

    const loginExpectationMet = !input.loginSensitive
        ? true
        : (
            !loginPrompted
            || suspendedCount > 0
            || resumedCount > 0
        );

    const completionExpectationMet = failed
        ? false
        : (
            finished
            || suspendedCount > 0
            || (
                input.loginSensitive
                && loginPrompted
                && (suspendedCount > 0 || (resumedAfterFollowUp && browserCallsAfterResume > 0))
            )
        );

    const externalFailure = hasExternalFailureSignal(`${failedError}\n${mergedText}`);

    return {
        taskId,
        taskLabel: `${input.site}-${input.backend}`,
        marker: input.marker,
        backend: input.backend,
        site: input.site,
        submitted: true,
        started,
        finished,
        failed,
        failedError,
        browserToolCallCount: browserToolCalls.length,
        browserNavigateCallCount: navigateCalls.length,
        browserAiActionCallCount: aiActionCalls.length,
        modeSetSmart,
        modeSetPrecise,
        targetDomainSeen,
        markerSeen,
        loginPrompted,
        suspendedCount,
        resumedCount,
        followUpSent: false,
        followUpSendError: '',
        resumedAfterFollowUp,
        browserCallsAfterResume,
        ownMarkerOnly: foreignMarkersSeen.length === 0,
        foreignMarkersSeen,
        evidenceTextLength: mergedText.length,
        externalFailure,
        backendExpectationMet,
        loginExpectationMet,
        completionExpectationMet,
    };
}

export function buildBrowserTaskInventory(): BrowserTaskInventoryItem[] {
    return Object.values(TASK_LIBRARY).map((item) => ({ ...item }));
}

export function buildBrowserConcurrentScenarioMatrix(): BrowserConcurrentScenario[] {
    return SCENARIO_BLUEPRINTS.map((blueprint) => ({
        id: blueprint.id,
        title: blueprint.title,
        tasks: blueprint.taskIds.map((id) => ({ ...TASK_LIBRARY[id] })),
    }));
}

export async function runConcurrentBrowserDesktopScenario(options: {
    page: Page;
    tauriLogs: TauriLogCollector;
    scenario: BrowserConcurrentScenario;
    timeoutMs: number;
    pollIntervalMs: number;
    workspacePath: string;
}): Promise<BrowserConcurrentScenarioRunResult> {
    const { page, tauriLogs, scenario, timeoutMs, pollIntervalMs, workspacePath } = options;
    const taskInputs = buildTaskInputs(scenario);

    tauriLogs.setBaseline();

    const startResponses = await Promise.all(
        taskInputs.map(async (input): Promise<{ input: TaskInput; response: StartTaskResponse }> => {
            const response = await invokeTauri<StartTaskResponse>(page, 'start_task', {
                title: input.title,
                userQuery: input.query,
                workspacePath,
            });
            return { input, response };
        }),
    );

    const taskLookup = new Map<string, TaskInput>();
    for (const item of startResponses) {
        taskLookup.set(item.response.taskId, item.input);
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        await page.waitForTimeout(pollIntervalMs);

        const rawLogs = tauriLogs.getRawSinceBaseline();
        const events = parseSidecarEvents(rawLogs);

        const bodyText = await page.textContent('body').catch(() => '');
        const bodyReady = normalize(bodyText ?? '').includes(READY_FOR_FOLLOW_UP);

        const allSettled = startResponses.every(({ response }) => {
            const taskId = response.taskId;
            const input = taskLookup.get(taskId);
            if (!input) return false;
            const taskEvents = events.filter((event) => event.taskId === taskId);
            const failed = taskEvents.some((event) => event.type === 'TASK_FAILED');
            const finished = taskEvents.some((event) => event.type === 'TASK_FINISHED');
            if (failed || finished) {
                return true;
            }

            const suspended = taskEvents.some((event) => event.type === 'TASK_SUSPENDED');
            if (suspended) {
                return true;
            }

            return bodyReady && taskEvents.some((event) => event.type === 'TEXT_DELTA');
        });

        if (allSettled) {
            break;
        }
    }

    const finalLogs = tauriLogs.getRawSinceBaseline();
    const finalEvents = parseSidecarEvents(finalLogs);
    const allMarkers = taskInputs.map((task) => task.marker);

    const taskResults: BrowserTaskRunResult[] = startResponses.map(({ input, response }) => {
        const taskEvents = finalEvents.filter((event) => event.taskId === response.taskId);
        const result = evaluateTaskResult(input, response.taskId, taskEvents, allMarkers);
        return {
            ...result,
            submitted: Boolean(response.success),
            failed: result.failed || !response.success,
            failedError: response.success ? result.failedError : String(response.error ?? 'start_task_failed'),
            externalFailure: result.externalFailure || hasExternalFailureSignal(String(response.error ?? '')),
        };
    });

    const allSubmitted = taskResults.every((item) => item.submitted);
    const allStarted = taskResults.every((item) => item.started);
    const allNoFailure = taskResults.every((item) => !item.failed);
    const isolationOk = taskResults.every((item) => item.ownMarkerOnly && item.markerSeen);
    const backendCoverageOk = taskResults.every((item) => item.backendExpectationMet);
    const loginCollaborationOk = taskResults.every((item) => item.loginExpectationMet);
    const completionOk = taskResults.every((item) => item.completionExpectationMet);
    const externalFailure = taskResults.some((item) => item.externalFailure);

    return {
        scenarioId: scenario.id,
        scenarioTitle: scenario.title,
        taskCount: taskResults.length,
        allSubmitted,
        allStarted,
        allNoFailure,
        isolationOk,
        backendCoverageOk,
        loginCollaborationOk,
        completionOk,
        allTasksPassed: allSubmitted && allStarted && allNoFailure && isolationOk && backendCoverageOk && loginCollaborationOk && completionOk,
        externalFailure,
        tasks: taskResults,
    };
}
