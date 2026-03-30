import { randomUUID } from 'crypto';
import {
    type NormalizedWorkRequest,
    type ResearchEvidence,
    type ResearchQuery,
    type UncertaintyItem,
} from './workRequestSchema';
export type ResearchLoopResolvers = {
    webSearch?: (query: string) => Promise<{
        success: boolean;
        summary: string;
        resultCount?: number;
        provider?: string;
        error?: string;
    }>;
};
export type ResearchLoopOptions = {
    webSearchTimeoutMs?: number;
};
function dedupe(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
function appendEvidence(evidence: ResearchEvidence[], next: Omit<ResearchEvidence, 'id'>): ResearchEvidence[] {
    const exists = evidence.some((item) =>
        item.kind === next.kind && item.source === next.source && item.summary === next.summary,
    );
    if (exists) {
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
function toBlockingUnknown(query: ResearchQuery, evidence: ResearchEvidence[]): UncertaintyItem {
    return {
        id: randomUUID(),
        topic: `required_research:${query.id}`,
        status: 'blocking_unknown',
        statement: `Required pre-freeze research did not complete: ${query.objective}`,
        whyItMatters: 'Execution should wait until required research is available.',
        question: `Please provide missing context or allow retry: ${query.objective}`,
        supportingEvidenceIds: evidence.map((item) => item.id),
    };
}
export async function runPreFreezeResearchLoop(input: {
    request: NormalizedWorkRequest;
    resolvers?: ResearchLoopResolvers;
    options?: ResearchLoopOptions;
}): Promise<NormalizedWorkRequest> {
    const queries = [...(input.request.researchQueries ?? [])];
    let evidence = [...(input.request.researchEvidence ?? [])];
    const uncertainty = [...(input.request.uncertaintyRegistry ?? [])];
    const risks = [...(input.request.knownRisks ?? [])];
    for (let index = 0; index < queries.length; index += 1) {
        const query = queries[index];
        if (query.status !== 'pending') {
            continue;
        }
        if (query.source === 'web' && input.resolvers?.webSearch) {
            try {
                const result = await input.resolvers.webSearch(query.objective);
                queries[index] = {
                    ...query,
                    status: result.success ? 'completed' : 'failed',
                };
                evidence = appendEvidence(evidence, {
                    kind: query.kind,
                    source: query.source,
                    summary: result.summary,
                    confidence: result.success ? 0.72 : 0.45,
                    collectedAt: new Date().toISOString(),
                });
                if (!result.success && query.required) {
                    uncertainty.push(toBlockingUnknown(query, evidence));
                    risks.push(result.error || 'Required web research failed before freeze.');
                }
            } catch (error) {
                queries[index] = { ...query, status: 'failed' };
                evidence = appendEvidence(evidence, {
                    kind: query.kind,
                    source: query.source,
                    summary: `Web research failed: ${String(error)}`,
                    confidence: 0.35,
                    collectedAt: new Date().toISOString(),
                });
                if (query.required) {
                    uncertainty.push(toBlockingUnknown(query, evidence));
                    risks.push('Required web research failed before freeze.');
                }
            }
            continue;
        }
        queries[index] = {
            ...query,
            status: query.source === 'connected_app' || query.source === 'template' ? 'skipped' : 'completed',
        };
        evidence = appendEvidence(evidence, {
            kind: query.kind,
            source: query.source,
            summary: `Research source "${query.source}" processed in minimal pre-freeze loop.`,
            confidence: query.source === 'connected_app' || query.source === 'template' ? 0.4 : 0.7,
            collectedAt: new Date().toISOString(),
        });
        if (query.required && queries[index].status !== 'completed') {
            uncertainty.push(toBlockingUnknown(query, evidence));
            risks.push(`Required ${query.source} research is not available in current runtime.`);
        }
    }
    return {
        ...input.request,
        researchQueries: queries,
        researchEvidence: evidence,
        uncertaintyRegistry: uncertainty,
        knownRisks: dedupe(risks),
    };
}
