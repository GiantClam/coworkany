import type { SearchResult } from './ragBridge';
import { getRagBridge } from './ragBridge';
import type { MemoryScope } from '../../orchestration/workRequestSchema';
import {
    buildMemoryMetadataFilters,
    buildMemoryMetadataForScope,
    buildMemoryRelativePathPrefix,
    resolveAllowedMemoryReadScopes,
    resolveAllowedMemoryWriteScope,
} from '../taskIsolationPolicyStore';

export async function searchIsolatedMemory(input: {
    taskId: string;
    workspacePath: string;
    query: string;
    topK?: number;
    category?: string;
    scopes?: MemoryScope[];
}): Promise<SearchResult[]> {
    const bridge = getRagBridge();
    const scopes = resolveAllowedMemoryReadScopes(input.taskId, input.scopes);
    const topK = Math.min(input.topK ?? 5, 10);
    const resultsByPath = new Map<string, SearchResult>();

    for (const scope of scopes) {
        const response = await bridge.search({
            query: input.query,
            topK,
            filterCategory: input.category,
            includeContent: true,
            metadataFilters: buildMemoryMetadataFilters({
                taskId: input.taskId,
                workspacePath: input.workspacePath,
                scope,
            }),
        });

        for (const result of response.results) {
            const existing = resultsByPath.get(result.path);
            if (!existing || result.score > existing.score) {
                resultsByPath.set(result.path, result);
            }
        }
    }

    return Array.from(resultsByPath.values())
        .sort((left, right) => right.score - left.score)
        .slice(0, topK);
}

export async function getIsolatedMemoryContext(input: {
    taskId: string;
    workspacePath: string;
    query: string;
    topK?: number;
    maxChars?: number;
    category?: string;
    scopes?: MemoryScope[];
}): Promise<string> {
    const results = await searchIsolatedMemory(input);
    if (results.length === 0) {
        return '';
    }

    const formatted = results
        .map((result, index) => {
            let line = `[Memory ${index + 1}] ${result.title}`;
            if (result.category) {
                line += ` (${result.category})`;
            }
            line += `\n${result.content || '(no content)'}`;
            return line;
        })
        .join('\n\n---\n\n');

    const maxChars = input.maxChars ?? 4000;
    if (formatted.length > maxChars) {
        return `${formatted.slice(0, maxChars)}\n...[truncated]`;
    }

    return formatted;
}

export function resolveMemoryWriteTarget(input: {
    taskId: string;
    workspacePath: string;
    requestedScope?: MemoryScope;
}): {
    scope: MemoryScope;
    relativePathPrefix: string;
    metadata: Record<string, unknown>;
} {
    const scope = resolveAllowedMemoryWriteScope(input.taskId, input.requestedScope);
    return {
        scope,
        relativePathPrefix: buildMemoryRelativePathPrefix({
            taskId: input.taskId,
            workspacePath: input.workspacePath,
            scope,
        }),
        metadata: buildMemoryMetadataForScope({
            taskId: input.taskId,
            workspacePath: input.workspacePath,
            scope,
        }),
    };
}
