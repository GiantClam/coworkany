import { randomUUID } from 'crypto';
import * as fs from 'fs';
import {
    type FrozenWorkRequest,
    type NormalizedWorkRequest,
    type ResearchEvidence,
    type ResearchQuery,
    type UncertaintyItem,
} from './workRequestSchema';
import { WorkRequestStore } from './workRequestStore';

export type ResearchLoopResolvers = {
    webSearch?: (query: string) => Promise<{
        success: boolean;
        summary: string;
        resultCount?: number;
        provider?: string;
        error?: string;
    }>;
    webContent?: (input: {
        url: string;
        objective: string;
    }) => Promise<{
        success: boolean;
        summary: string;
        title?: string;
        excerpt?: string;
        error?: string;
    }>;
    connectedAppStatus?: (input: {
        workspacePath: string;
        sourceText: string;
        objective: string;
    }) => Promise<{
        success: boolean;
        summary: string;
        connectedApps: string[];
        error?: string;
    }>;
};

export type ResearchLoopOptions = {
    webSearchTimeoutMs?: number;
    webContentTimeoutMs?: number;
    connectedAppTimeoutMs?: number;
};

const DEFAULT_WEB_RESEARCH_TIMEOUT_MS = 4000;
const DEFAULT_WEB_CONTENT_TIMEOUT_MS = 6000;
const DEFAULT_CONNECTED_APP_TIMEOUT_MS = 2500;
const REQUIRED_RESEARCH_BLOCKING_TOPIC_PREFIX = 'required_research:';

function dedupeStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function appendEvidence(evidence: ResearchEvidence[], next: Omit<ResearchEvidence, 'id'>): ResearchEvidence[] {
    const existing = evidence.find((item) =>
        item.kind === next.kind &&
        item.source === next.source &&
        item.summary === next.summary
    );
    if (existing) {
        return evidence;
    }

    return [
        ...evidence,
        {
            id: randomUUID(),
            ...next,
        },
    ];
}

function toRequiredResearchBlockingTopic(query: ResearchQuery): string {
    return `${REQUIRED_RESEARCH_BLOCKING_TOPIC_PREFIX}${query.id}`;
}

function isRequiredResearchBlocking(query: ResearchQuery): boolean {
    return query.required && (query.status === 'failed' || query.status === 'skipped');
}

function buildRequiredResearchBlockingUnknowns(input: {
    queries: ResearchQuery[];
    evidence: ResearchEvidence[];
}): UncertaintyItem[] {
    const supportingEvidenceIds = input.evidence.map((item) => item.id);

    return input.queries
        .filter(isRequiredResearchBlocking)
        .map((query) => ({
            id: randomUUID(),
            topic: toRequiredResearchBlockingTopic(query),
            status: 'blocking_unknown' as const,
            statement: `Required pre-freeze research did not complete successfully: ${query.objective}`,
            whyItMatters: 'Coworkany cannot safely continue execution without the required research evidence.',
            question: `Please provide the missing data or allow Coworkany to retry this research step: ${query.objective}`,
            supportingEvidenceIds,
        }));
}

function completeConversationResearch(
    query: ResearchQuery,
    request: NormalizedWorkRequest,
    evidence: ResearchEvidence[]
): { query: ResearchQuery; evidence: ResearchEvidence[] } {
    return {
        query: { ...query, status: 'completed' },
        evidence: appendEvidence(evidence, {
            kind: query.kind,
            source: query.source,
            summary: `Conversation context was used to frame the request: ${request.sourceText.slice(0, 160)}`,
            confidence: 0.78,
            collectedAt: new Date().toISOString(),
        }),
    };
}

function completeWorkspaceResearch(
    query: ResearchQuery,
    request: NormalizedWorkRequest,
    evidence: ResearchEvidence[]
): { query: ResearchQuery; evidence: ResearchEvidence[]; risks: string[] } {
    if (!fs.existsSync(request.workspacePath)) {
        return {
            query: { ...query, status: 'failed' },
            evidence: appendEvidence(evidence, {
                kind: query.kind,
                source: query.source,
                summary: `Workspace path was not accessible during research: ${request.workspacePath}`,
                confidence: 0.95,
                collectedAt: new Date().toISOString(),
            }),
            risks: ['Workspace context research could not inspect the current workspace path.'],
        };
    }

    let entries: string[] = [];
    try {
        entries = fs.readdirSync(request.workspacePath).slice(0, 8);
    } catch (error) {
        return {
            query: { ...query, status: 'failed' },
            evidence: appendEvidence(evidence, {
                kind: query.kind,
                source: query.source,
                summary: `Workspace research failed while reading ${request.workspacePath}: ${String(error)}`,
                confidence: 0.9,
                collectedAt: new Date().toISOString(),
            }),
            risks: ['Workspace context research failed while reading local files.'],
        };
    }

    const summary = entries.length > 0
        ? `Workspace research inspected ${request.workspacePath} and found top-level entries: ${entries.join(', ')}`
        : `Workspace research inspected ${request.workspacePath} and found no top-level entries.`;

    return {
        query: { ...query, status: 'completed' },
        evidence: appendEvidence(evidence, {
            kind: query.kind,
            source: query.source,
            summary,
            confidence: 0.88,
            artifactPath: request.workspacePath,
            collectedAt: new Date().toISOString(),
        }),
        risks: [],
    };
}

function completeMemoryResearch(
    query: ResearchQuery,
    workRequestStore: WorkRequestStore,
    evidence: ResearchEvidence[]
): { query: ResearchQuery; evidence: ResearchEvidence[] } {
    const records = workRequestStore.read();
    const recent = records.slice(-3).map((record) => record.sourceText.slice(0, 80));
    const summary = recent.length > 0
        ? `Found ${records.length} persisted work request(s); recent examples: ${recent.join(' | ')}`
        : 'No persisted work requests were available for memory research.';

    return {
        query: { ...query, status: 'completed' },
        evidence: appendEvidence(evidence, {
            kind: query.kind,
            source: query.source,
            summary,
            confidence: recent.length > 0 ? 0.72 : 0.4,
            collectedAt: new Date().toISOString(),
        }),
    };
}

function skipUnwiredResearchSource(
    query: ResearchQuery,
    evidence: ResearchEvidence[]
): { query: ResearchQuery; evidence: ResearchEvidence[]; risks: string[] } {
    const label = query.source.replace(/_/g, ' ');
    return {
        query: { ...query, status: 'skipped' },
        evidence: appendEvidence(evidence, {
            kind: query.kind,
            source: query.source,
            summary: `Research source "${label}" is planned but not yet wired in this runtime slice.`,
            confidence: 0.35,
            collectedAt: new Date().toISOString(),
        }),
        risks: query.required
            ? [`Required ${label} research is not yet wired into the runtime; strategy may need revision when adapters land.`]
            : [],
    };
}

async function withResearchTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    label: string
): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${label}_timeout_${timeoutMs}ms`));
        }, timeoutMs);

        operation
            .then((result) => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

async function completeWebResearch(
    query: ResearchQuery,
    request: NormalizedWorkRequest,
    evidence: ResearchEvidence[],
    resolver?: ResearchLoopResolvers['webSearch'],
    webContentResolver?: ResearchLoopResolvers['webContent'],
    options?: ResearchLoopOptions
): Promise<{ query: ResearchQuery; evidence: ResearchEvidence[]; risks: string[] }> {
    const directUrls = query.directUrls ?? [];
    let nextEvidence = evidence;
    const directRisks: string[] = [];

    if (directUrls.length > 0 && webContentResolver) {
        for (const url of directUrls) {
            try {
                const timeoutMs = options?.webContentTimeoutMs ?? DEFAULT_WEB_CONTENT_TIMEOUT_MS;
                const result = await withResearchTimeout(
                    webContentResolver({
                        url,
                        objective: query.objective,
                    }),
                    timeoutMs,
                    'web_content_research'
                );
                nextEvidence = appendEvidence(nextEvidence, {
                    kind: query.kind,
                    source: query.source,
                    summary: result.summary,
                    confidence: result.success ? 0.82 : 0.45,
                    uri: url,
                    collectedAt: new Date().toISOString(),
                });
                if (result.success) {
                    return {
                        query: { ...query, status: 'completed' },
                        evidence: nextEvidence,
                        risks: [],
                    };
                }
                directRisks.push(result.error || `Direct URL fetch failed for ${url}.`);
            } catch (error) {
                nextEvidence = appendEvidence(nextEvidence, {
                    kind: query.kind,
                    source: query.source,
                    summary: `Direct URL fetch failed for ${url}: ${String(error)}`,
                    confidence: 0.45,
                    uri: url,
                    collectedAt: new Date().toISOString(),
                });
                directRisks.push(`Direct URL fetch failed for ${url}: ${String(error)}`);
            }
        }
    }

    if (!resolver) {
        if (directRisks.length > 0) {
            return {
                query: { ...query, status: 'failed' },
                evidence: nextEvidence,
                risks: directRisks,
            };
        }
        return skipUnwiredResearchSource(query, nextEvidence);
    }

    try {
        const timeoutMs = options?.webSearchTimeoutMs ?? DEFAULT_WEB_RESEARCH_TIMEOUT_MS;
        const result = await withResearchTimeout(
            resolver(`${request.tasks[0]?.objective || request.sourceText} ${query.objective}`.trim()),
            timeoutMs,
            'web_research'
        );
        return {
            query: { ...query, status: result.success ? 'completed' : 'failed' },
            evidence: appendEvidence(nextEvidence, {
                kind: query.kind,
                source: query.source,
                summary: result.summary,
                confidence: result.success ? 0.7 : 0.45,
                collectedAt: new Date().toISOString(),
            }),
            risks: result.success ? [] : [...directRisks, result.error || 'Web research failed before contract freeze.'],
        };
    } catch (error) {
        return {
            query: { ...query, status: 'failed' },
            evidence: appendEvidence(nextEvidence, {
                kind: query.kind,
                source: query.source,
                summary: `Web research failed: ${String(error)}`,
                confidence: 0.35,
                collectedAt: new Date().toISOString(),
            }),
            risks: [...directRisks, 'Web research failed before contract freeze.'],
        };
    }
}

async function completeConnectedAppResearch(
    query: ResearchQuery,
    request: NormalizedWorkRequest,
    evidence: ResearchEvidence[],
    resolver?: ResearchLoopResolvers['connectedAppStatus'],
    options?: ResearchLoopOptions
): Promise<{ query: ResearchQuery; evidence: ResearchEvidence[]; risks: string[] }> {
    if (!resolver) {
        return skipUnwiredResearchSource(query, evidence);
    }

    try {
        const timeoutMs = options?.connectedAppTimeoutMs ?? DEFAULT_CONNECTED_APP_TIMEOUT_MS;
        const result = await withResearchTimeout(
            resolver({
                workspacePath: request.workspacePath,
                sourceText: request.sourceText,
                objective: request.tasks[0]?.objective || request.sourceText,
            }),
            timeoutMs,
            'connected_app_research'
        );
        return {
            query: { ...query, status: result.success ? 'completed' : 'failed' },
            evidence: appendEvidence(evidence, {
                kind: query.kind,
                source: query.source,
                summary: result.summary,
                confidence: result.success ? 0.76 : 0.45,
                collectedAt: new Date().toISOString(),
            }),
            risks: result.success ? [] : [result.error || 'Connected-app feasibility research failed.'],
        };
    } catch (error) {
        return {
            query: { ...query, status: 'failed' },
            evidence: appendEvidence(evidence, {
                kind: query.kind,
                source: query.source,
                summary: `Connected-app research failed: ${String(error)}`,
                confidence: 0.35,
                collectedAt: new Date().toISOString(),
            }),
            risks: ['Connected-app feasibility research failed.'],
        };
    }
}

export function runPreFreezeResearchLoop(input: {
    request: NormalizedWorkRequest;
    workRequestStore: WorkRequestStore;
    resolvers?: ResearchLoopResolvers;
    options?: ResearchLoopOptions;
}): Promise<NormalizedWorkRequest> {
    return runPreFreezeResearchLoopInternal(input);
}

async function runPreFreezeResearchLoopInternal(input: {
    request: NormalizedWorkRequest;
    workRequestStore: WorkRequestStore;
    resolvers?: ResearchLoopResolvers;
    options?: ResearchLoopOptions;
}): Promise<NormalizedWorkRequest> {
    const request = input.request;
    const queries = request.researchQueries ?? [];
    let evidence = [...(request.researchEvidence ?? [])];
    let risks = [...(request.knownRisks ?? [])];
    const updatedQueries: ResearchQuery[] = [];

    for (const query of queries) {
        if (query.status !== 'pending') {
            updatedQueries.push(query);
            continue;
        }

        switch (query.source) {
            case 'conversation': {
                const result = completeConversationResearch(query, request, evidence);
                evidence = result.evidence;
                updatedQueries.push(result.query);
                break;
            }
            case 'workspace': {
                const result = completeWorkspaceResearch(query, request, evidence);
                evidence = result.evidence;
                risks = [...risks, ...result.risks];
                updatedQueries.push(result.query);
                break;
            }
            case 'memory': {
                const result = completeMemoryResearch(query, input.workRequestStore, evidence);
                evidence = result.evidence;
                updatedQueries.push(result.query);
                break;
            }
            case 'web': {
                const result = await completeWebResearch(
                    query,
                    request,
                    evidence,
                    input.resolvers?.webSearch,
                    input.resolvers?.webContent,
                    input.options,
                );
                evidence = result.evidence;
                risks = [...risks, ...result.risks];
                updatedQueries.push(result.query);
                break;
            }
            case 'connected_app': {
                const result = await completeConnectedAppResearch(
                    query,
                    request,
                    evidence,
                    input.resolvers?.connectedAppStatus,
                    input.options
                );
                evidence = result.evidence;
                risks = [...risks, ...result.risks];
                updatedQueries.push(result.query);
                break;
            }
            case 'template': {
                const result = skipUnwiredResearchSource(query, evidence);
                evidence = result.evidence;
                risks = [...risks, ...result.risks];
                updatedQueries.push(result.query);
                break;
            }
            default:
                updatedQueries.push(query);
                break;
        }
    }

    const nonResearchBlockingUnknowns = (request.uncertaintyRegistry ?? [])
        .filter((item) => !item.topic.startsWith(REQUIRED_RESEARCH_BLOCKING_TOPIC_PREFIX));
    const requiredResearchBlockingUnknowns = buildRequiredResearchBlockingUnknowns({
        queries: updatedQueries,
        evidence,
    });
    if (requiredResearchBlockingUnknowns.length > 0) {
        risks.push('Required pre-freeze research is incomplete; execution contract remains blocked until missing research is resolved.');
    }

    return {
        ...request,
        researchQueries: updatedQueries,
        researchEvidence: evidence,
        uncertaintyRegistry: [...nonResearchBlockingUnknowns, ...requiredResearchBlockingUnknowns],
        knownRisks: dedupeStrings(risks),
    };
}

export function buildResearchUpdatedPayload(request: Pick<
    FrozenWorkRequest,
    'researchQueries' | 'uncertaintyRegistry' | 'frozenResearchSummary'
>): {
    summary: string;
    sourcesChecked: string[];
    completedQueries: number;
    pendingQueries: number;
    blockingUnknowns: string[];
    selectedStrategyTitle?: string;
} {
    const queries = request.researchQueries ?? [];
    const completedQueries = queries.filter((query) => query.status === 'completed' || query.status === 'skipped').length;
    const pendingQueries = queries.filter((query) => query.status === 'pending' || query.status === 'running').length;
    const blockingUnknowns = (request.uncertaintyRegistry ?? [])
        .filter((item) => item.status === 'blocking_unknown')
        .map((item) => item.topic);
    const sourcesChecked = request.frozenResearchSummary?.sourcesChecked ?? [];

    const summary = blockingUnknowns.length > 0
        ? `Research updated: ${completedQueries}/${queries.length} queries processed, ${blockingUnknowns.length} blocking item(s) remain.`
        : `Research updated: ${completedQueries}/${queries.length} queries processed, contract ready to freeze.`;

    return {
        summary,
        sourcesChecked,
        completedQueries,
        pendingQueries,
        blockingUnknowns,
        selectedStrategyTitle: request.frozenResearchSummary?.selectedStrategyTitle,
    };
}
