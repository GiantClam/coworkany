import type { Locator, Page } from '@playwright/test';
import type { TauriLogCollector } from '../tauriFixture';

const INPUT_SELECTORS = [
    '.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    'input[placeholder*="指令"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

const ADVICE_KEYWORDS = [
    '买入', '卖出', '持有', '加仓', '减仓',
    'buy', 'sell', 'hold', 'overweight', 'underweight',
    '评级', '建议', 'investment advice',
];

const PREDICTION_KEYWORDS = [
    '预测', '预期', '目标价', '未来', '走势', '概率',
    'forecast', 'projection', 'target price', 'upside', 'downside',
    'next quarter', 'next 3 months', 'next 6 months',
];

const READY_FOR_FOLLOW_UP = 'ready for follow-up';

const EXTERNAL_FAILURE_PATTERNS: RegExp[] = [
    /insufficient_quota/i,
    /rate_limit/i,
    /too many requests/i,
    /billing/i,
    /invalid api key/i,
    /missing api key/i,
    /provider not configured/i,
    /unauthorized|forbidden|payment required/i,
    /http[^.\n]{0,30}\b(401|402|403)\b/i,
];

export type StockEntityExpectation = {
    id: string;
    displayName: string;
    aliases: string[];
};

export type StockDesktopScenario = {
    id: string;
    title: string;
    entities: StockEntityExpectation[];
    horizon: string;
    focus: string;
    minSearchWebCalls: number;
    marker: string;
};

export type SidecarEvent = {
    type: string;
    payload?: Record<string, unknown>;
};

export type EntityCoverage = {
    id: string;
    displayName: string;
    matchedAliases: string[];
};

export type StockScenarioRunResult = {
    scenarioId: string;
    query: string;
    submitted: boolean;
    taskFinished: boolean;
    taskFailed: boolean;
    taskFailedError: string;
    searchWebCallCount: number;
    adviceKeywordHits: string[];
    predictionKeywordHits: string[];
    entityCoverage: EntityCoverage[];
    allEntitiesCovered: boolean;
    markerSeen: boolean;
    readyForFollowUpSeen: boolean;
    completedBySilence: boolean;
    completed: boolean;
    externalFailure: boolean;
    evidenceTextLength: number;
    rawLogLength: number;
};

const STOCK_LIBRARY: Record<string, StockEntityExpectation> = {
    cloudflare: {
        id: 'cloudflare',
        displayName: 'Cloudflare',
        aliases: ['cloudflare', 'net'],
    },
    reddit: {
        id: 'reddit',
        displayName: 'Reddit',
        aliases: ['reddit', 'rddt'],
    },
    nvidia: {
        id: 'nvidia',
        displayName: 'NVIDIA',
        aliases: ['nvidia', 'nvda', 'geforce', 'cuda', '英伟达'],
    },
    yankuang: {
        id: 'yankuang',
        displayName: '兖矿能源',
        aliases: ['兖矿能源', '衮矿能源', 'yankuang', 'yanzhou', 'yanzhou coal', '600188', '1171'],
    },
    minimax: {
        id: 'minimax',
        displayName: 'MiniMax',
        aliases: ['minimax', 'mini max', '稀宇科技'],
    },
    glm: {
        id: 'glm',
        displayName: 'GLM',
        aliases: ['glm', '智谱', 'zhipu', 'chatglm'],
    },
};

const SCENARIO_BLUEPRINTS: Array<{
    id: string;
    title: string;
    stockIds: string[];
    horizon: string;
    focus: string;
    minSearchWebCalls: number;
}> = [
    {
        id: 'legacy-us-ai-trio',
        title: 'Cloudflare/Reddit/NVIDIA 三股联动分析',
        stockIds: ['cloudflare', 'reddit', 'nvidia'],
        horizon: '未来 3 个月',
        focus: 'AI 行业新闻与美股成长股估值变化',
        minSearchWebCalls: 2,
    },
    {
        id: 'parallel-minimax-yankuang-glm-nvidia',
        title: '并行分析 minimax、衮矿能源、glm、nvidia',
        stockIds: ['minimax', 'yankuang', 'glm', 'nvidia'],
        horizon: '未来 3 个月',
        focus: '并行给出每个标的的方向性预测与买卖建议',
        minSearchWebCalls: 2,
    },
    {
        id: 'yankuang-vs-nvidia',
        title: '兖矿能源与 NVIDIA 对比',
        stockIds: ['yankuang', 'nvidia'],
        horizon: '未来 6 个月',
        focus: '能源周期与 AI 算力周期对冲关系',
        minSearchWebCalls: 1,
    },
    {
        id: 'minimax-glm-vs-nvidia',
        title: 'MiniMax/GLM/NVIDIA 组合判断',
        stockIds: ['minimax', 'glm', 'nvidia'],
        horizon: '未来 1 个季度',
        focus: 'AI 应用层与算力层的相对强弱预测',
        minSearchWebCalls: 1,
    },
];

export function buildStockDesktopScenarioMatrix(): StockDesktopScenario[] {
    return SCENARIO_BLUEPRINTS.map((blueprint) => {
        const entities = blueprint.stockIds
            .map((id) => STOCK_LIBRARY[id])
            .filter((entity): entity is StockEntityExpectation => Boolean(entity));

        return {
            id: blueprint.id,
            title: blueprint.title,
            entities,
            horizon: blueprint.horizon,
            focus: blueprint.focus,
            minSearchWebCalls: blueprint.minSearchWebCalls,
            marker: `STOCK_SCENARIO_${blueprint.id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
        };
    });
}

function normalize(text: string): string {
    return text.toLowerCase();
}

function findKeywordHits(text: string, keywords: string[]): string[] {
    const lower = normalize(text);
    return keywords.filter((keyword) => lower.includes(keyword.toLowerCase()));
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
            if (!event || typeof event.type !== 'string') {
                continue;
            }

            events.push(event);

            if (event.type === 'TASK_EVENT') {
                const payload = (event.payload ?? {}) as Record<string, unknown>;
                const taskEventType = String(payload.type ?? '').toLowerCase();
                if (taskEventType === 'tool_call') {
                    events.push({
                        type: 'TOOL_CALL',
                        payload: {
                            name: payload.toolName,
                            args: payload.args,
                        },
                    });
                } else if (taskEventType === 'tool_result') {
                    events.push({
                        type: 'TOOL_RESULT',
                        payload: {
                            name: payload.toolName,
                            result: payload.result,
                            resultSummary: payload.resultSummary,
                        },
                    });
                } else if (taskEventType === 'text_delta') {
                    events.push({
                        type: 'TEXT_DELTA',
                        payload: {
                            delta: payload.content,
                            role: payload.role,
                        },
                    });
                } else if (taskEventType === 'complete') {
                    events.push({
                        type: 'TASK_FINISHED',
                        payload: {
                            summary: payload.finishReason,
                        },
                    });
                }
            }
        } catch {
            // Ignore malformed lines.
        }
    }

    return events;
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

function buildEvidenceText(events: SidecarEvent[], fallback: string): string {
    const chunks: string[] = [];

    for (const event of events) {
        if (event.type === 'TEXT_DELTA') {
            chunks.push(stringifyPayloadValue(event.payload?.delta));
            continue;
        }
        if (event.type === 'TOOL_RESULT') {
            chunks.push(stringifyPayloadValue(event.payload?.result));
            chunks.push(stringifyPayloadValue(event.payload?.resultSummary));
            continue;
        }
        if (event.type === 'TASK_FINISHED') {
            chunks.push(stringifyPayloadValue(event.payload?.summary));
        }
    }

    const merged = chunks.join('\n').trim();
    return merged.length > 0 ? merged : fallback;
}

function collectEntityCoverage(text: string, entities: StockEntityExpectation[]): EntityCoverage[] {
    const lower = normalize(text);
    return entities.map((entity) => {
        const matchedAliases = entity.aliases.filter((alias) => lower.includes(alias.toLowerCase()));
        return {
            id: entity.id,
            displayName: entity.displayName,
            matchedAliases,
        };
    });
}

function hasExternalFailureSignal(logs: string, errorText: string, taskFailed: boolean): boolean {
    if (!taskFailed && errorText.trim().length === 0) {
        return false;
    }
    const combined = `${logs}\n${errorText}`;
    return EXTERNAL_FAILURE_PATTERNS.some((pattern) => pattern.test(combined));
}

async function findChatInput(page: Page): Promise<Locator | null> {
    for (const selector of INPUT_SELECTORS) {
        const candidate = page.locator(selector).first();
        const visible = await candidate.isVisible({ timeout: 1200 }).catch(() => false);
        if (visible) {
            return candidate;
        }
    }
    return null;
}

function buildScenarioQuery(scenario: StockDesktopScenario): string {
    const targetList = scenario.entities.map((entity) => entity.displayName).join('、');
    return [
        `请并行完成股票检索分析任务：${targetList}`,
        `分析重点：${scenario.focus}`,
        `预测周期：${scenario.horizon}`,
        '硬性要求：',
        '1) 必须先检索最新信息，再给结论；',
        '2) 对每个标的都给出买入/持有/卖出之一；',
        '3) 对每个标的都给出未来走势预测与主要不确定性；',
        '4) 输出一个结构化对比表。',
        `5) 回复末尾附带标记 ${scenario.marker}`,
    ].join('\n');
}

export async function runStockDesktopScenario(options: {
    page: Page;
    tauriLogs: TauriLogCollector;
    scenario: StockDesktopScenario;
    timeoutMs: number;
    pollIntervalMs: number;
}): Promise<StockScenarioRunResult> {
    const { page, tauriLogs, scenario, timeoutMs, pollIntervalMs } = options;

    const input = await findChatInput(page);
    if (!input) {
        throw new Error('desktop UI should expose chat input');
    }

    const query = buildScenarioQuery(scenario);
    tauriLogs.setBaseline();

    await input.fill(query);
    await input.press('Enter');
    await page.waitForTimeout(1200);

    if (!tauriLogs.containsSinceBaseline('send_task_message command received')) {
        const submitButton = page.locator('button[type="submit"], .send-button').first();
        const canClick = await submitButton.isVisible({ timeout: 1000 }).catch(() => false);
        if (canClick) {
            await submitButton.click({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(1200);
        }
    }

    let submitted = false;
    let taskFinished = false;
    let taskFailed = false;
    let taskFailedError = '';
    let readyForFollowUpSeen = false;
    let completedBySilence = false;

    let lastObservedLogLength = 0;
    let lastGrowthAt = Date.now();

    let searchWebCallCount = 0;
    let adviceKeywordHits: string[] = [];
    let predictionKeywordHits: string[] = [];
    let entityCoverage: EntityCoverage[] = scenario.entities.map((entity) => ({
        id: entity.id,
        displayName: entity.displayName,
        matchedAliases: [],
    }));
    let markerSeen = false;

    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        await page.waitForTimeout(pollIntervalMs);

        const rawLogs = tauriLogs.getRawSinceBaseline();
        if (rawLogs.length !== lastObservedLogLength) {
            lastObservedLogLength = rawLogs.length;
            lastGrowthAt = Date.now();
        }

        submitted = submitted
            || rawLogs.includes('send_task_message command received')
            || rawLogs.includes('start_task command received')
            || rawLogs.includes('"type":"start_task"');

        const events = parseSidecarEvents(rawLogs);
        const researchToolCalls = events.filter((event) => {
            if (event.type !== 'TOOL_CALL') return false;
            const toolName = String(event.payload?.name ?? '');
            if (toolName === 'search_web' || toolName === 'crawl_url') return true;
            if (toolName === 'agent-researcher') return true;
            return false;
        }).length;
        searchWebCallCount = Math.max(
            searchWebCallCount,
            researchToolCalls,
        );

        taskFinished = taskFinished
            || events.some((event) => event.type === 'TASK_FINISHED')
            || rawLogs.includes('"type":"TASK_FINISHED"')
            || rawLogs.includes('TASK_FINISHED');

        const failedEvent = events.find((event) => event.type === 'TASK_FAILED');
        if (failedEvent) {
            taskFailed = true;
            taskFailedError = stringifyPayloadValue(failedEvent.payload?.error);
        }
        taskFailed = taskFailed
            || rawLogs.includes('"type":"TASK_FAILED"')
            || rawLogs.includes('TASK_FAILED');

        const bodyText = await page.textContent('body').catch(() => '');
        readyForFollowUpSeen = readyForFollowUpSeen || normalize(bodyText ?? '').includes(READY_FOR_FOLLOW_UP);

        const evidenceText = buildEvidenceText(events, rawLogs);
        adviceKeywordHits = findKeywordHits(evidenceText, ADVICE_KEYWORDS);
        predictionKeywordHits = findKeywordHits(evidenceText, PREDICTION_KEYWORDS);
        entityCoverage = collectEntityCoverage(evidenceText, scenario.entities);
        markerSeen = markerSeen || normalize(evidenceText).includes(scenario.marker.toLowerCase());

        const allEntitiesCovered = entityCoverage.every((item) => item.matchedAliases.length > 0);
        const hasAdvice = adviceKeywordHits.length > 0;
        const hasPrediction = predictionKeywordHits.length > 0;
        const quietForMs = Date.now() - lastGrowthAt;
        const insufficientResearchEvidence = (
            searchWebCallCount < scenario.minSearchWebCalls
            || !allEntitiesCovered
            || !hasAdvice
            || !hasPrediction
        );

        if (taskFailed) {
            break;
        }

        // Fail fast when runtime already emitted terminal completion but
        // never produced expected stock-research evidence.
        if (taskFinished && insufficientResearchEvidence && quietForMs > 15_000) {
            break;
        }

        if (submitted
            && searchWebCallCount >= scenario.minSearchWebCalls
            && allEntitiesCovered
            && hasAdvice
            && hasPrediction
            && (taskFinished || readyForFollowUpSeen)
        ) {
            break;
        }

    }

    const finalLogs = tauriLogs.getRawSinceBaseline();
    const finalEvents = parseSidecarEvents(finalLogs);
    const finalEvidenceText = buildEvidenceText(finalEvents, finalLogs);

    const finalAdviceHits = findKeywordHits(finalEvidenceText, ADVICE_KEYWORDS);
    const finalPredictionHits = findKeywordHits(finalEvidenceText, PREDICTION_KEYWORDS);
    const finalCoverage = collectEntityCoverage(finalEvidenceText, scenario.entities);
    const allEntitiesCovered = finalCoverage.every((item) => item.matchedAliases.length > 0);

    const completed = taskFinished || readyForFollowUpSeen;

    return {
        scenarioId: scenario.id,
        query,
        submitted,
        taskFinished,
        taskFailed,
        taskFailedError,
        searchWebCallCount,
        adviceKeywordHits: finalAdviceHits,
        predictionKeywordHits: finalPredictionHits,
        entityCoverage: finalCoverage,
        allEntitiesCovered,
        markerSeen: normalize(finalEvidenceText).includes(scenario.marker.toLowerCase()) || markerSeen,
        readyForFollowUpSeen,
        completedBySilence,
        completed,
        externalFailure: hasExternalFailureSignal(finalLogs, taskFailedError, taskFailed),
        evidenceTextLength: finalEvidenceText.length,
        rawLogLength: finalLogs.length,
    };
}
