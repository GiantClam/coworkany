import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition } from './types';

type MemoryEntry = {
    key: string;
    value: string;
    category?: string;
    timestamp: string;
};

function normalizeMemorySearchText(value: string): string {
    return value
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenizeMemorySearchText(value: string): string[] {
    return normalizeMemorySearchText(value)
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
}

function memoryTokensLooselyMatch(queryToken: string, corpusToken: string): boolean {
    if (queryToken === corpusToken) {
        return true;
    }
    if (
        (queryToken === 'language' && corpusToken === 'lang')
        || (queryToken === 'lang' && corpusToken === 'language')
    ) {
        return true;
    }
    if (queryToken.length >= 4 && corpusToken.startsWith(queryToken.slice(0, 4))) {
        return true;
    }
    if (corpusToken.length >= 4 && queryToken.startsWith(corpusToken.slice(0, 4))) {
        return true;
    }
    return false;
}

function resolveMemoryFilePath(workspacePath: string): string {
    return path.join(workspacePath, '.coworkany', 'memory.json');
}

async function loadMemoryEntries(workspacePath: string): Promise<MemoryEntry[]> {
    const memoryPath = resolveMemoryFilePath(workspacePath);
    if (!fs.existsSync(memoryPath)) {
        return [];
    }
    try {
        const raw = await fs.promises.readFile(memoryPath, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
            .map((item) => {
                const key = typeof item.key === 'string' ? item.key.trim() : '';
                const value = typeof item.value === 'string' ? item.value : '';
                const category = typeof item.category === 'string' && item.category.trim().length > 0
                    ? item.category.trim()
                    : undefined;
                const timestamp = typeof item.timestamp === 'string' && item.timestamp.trim().length > 0
                    ? item.timestamp
                    : new Date().toISOString();
                return {
                    key,
                    value,
                    category,
                    timestamp,
                };
            })
            .filter((item) => item.key.length > 0 && item.value.length > 0);
    } catch {
        return [];
    }
}

async function saveMemoryEntries(workspacePath: string, entries: MemoryEntry[]): Promise<void> {
    const memoryPath = resolveMemoryFilePath(workspacePath);
    await fs.promises.mkdir(path.dirname(memoryPath), { recursive: true });
    await fs.promises.writeFile(memoryPath, JSON.stringify(entries, null, 2), 'utf-8');
}

export const rememberTool: ToolDefinition = {
    name: 'remember',
    effects: ['state:remember', 'knowledge:update'],
    input_schema: {
        type: 'object',
        properties: {
            key: { type: 'string' },
            value: { type: 'string' },
            content: { type: 'string' },
            category: { type: 'string' },
        },
    },
    handler: async (
        args: { key?: string; value?: unknown; content?: string; category?: string },
        context,
    ) => {
        const key = typeof args.key === 'string' && args.key.trim().length > 0
            ? args.key.trim()
            : `memory-${Date.now()}`;
        const rawValue = args.value ?? args.content;
        if (rawValue === undefined || rawValue === null) {
            return { error: 'remember requires value/content.' };
        }
        const value = typeof rawValue === 'string'
            ? rawValue
            : JSON.stringify(rawValue);
        const category = typeof args.category === 'string' && args.category.trim().length > 0
            ? args.category.trim()
            : undefined;
        const timestamp = new Date().toISOString();
        const entries = await loadMemoryEntries(context.workspacePath);
        entries.push({
            key,
            value,
            category,
            timestamp,
        });
        await saveMemoryEntries(context.workspacePath, entries);
        return {
            success: true,
            key,
            value,
            category,
            timestamp,
            total: entries.length,
        };
    },
};

export const recallTool: ToolDefinition = {
    name: 'recall',
    effects: ['state:remember', 'knowledge:read'],
    input_schema: {
        type: 'object',
        properties: {
            key: { type: 'string' },
            query: { type: 'string' },
            limit: { type: 'integer' },
        },
    },
    handler: async (
        args: { key?: string; query?: string; limit?: number },
        context,
    ) => {
        const key = typeof args.key === 'string' ? args.key.trim() : '';
        const normalizedKey = normalizeMemorySearchText(key);
        const keyTokens = tokenizeMemorySearchText(key);
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        const normalizedQuery = normalizeMemorySearchText(query);
        const queryTokens = tokenizeMemorySearchText(query);
        const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) && args.limit > 0
            ? Math.floor(args.limit)
            : 10;
        const entries = await loadMemoryEntries(context.workspacePath);
        const scored = entries.map((entry) => {
            const corpusRaw = `${entry.key} ${entry.value} ${entry.category ?? ''}`;
            let score = 0;

            if (key.length > 0) {
                if (entry.key === key) {
                    score = Math.max(score, 120);
                } else if (normalizedKey.length > 0) {
                    const normalizedEntryKey = normalizeMemorySearchText(entry.key);
                    if (normalizedEntryKey === normalizedKey) {
                        score = Math.max(score, 100);
                    } else if (
                        normalizedEntryKey.includes(normalizedKey)
                        || normalizedKey.includes(normalizedEntryKey)
                    ) {
                        score = Math.max(score, 80);
                    } else if (keyTokens.length > 0) {
                        const entryKeyTokens = tokenizeMemorySearchText(entry.key);
                        let keyOverlap = 0;
                        for (const keyToken of keyTokens) {
                            if (entryKeyTokens.some((entryToken) => memoryTokensLooselyMatch(keyToken, entryToken))) {
                                keyOverlap += 1;
                            }
                        }
                        if (keyOverlap > 0) {
                            score = Math.max(score, 40 + keyOverlap);
                        }
                    }
                }
            }

            if (normalizedQuery.length === 0) {
                if (key.length === 0) {
                    score = Math.max(score, 1);
                }
                return { entry, score };
            }

            const normalizedCorpus = normalizeMemorySearchText(corpusRaw);
            if (normalizedCorpus.includes(normalizedQuery)) {
                score = Math.max(score, 80);
                return { entry, score };
            }

            if (queryTokens.length === 0) {
                return { entry, score };
            }

            const corpusTokens = tokenizeMemorySearchText(corpusRaw);
            let overlap = 0;
            for (const queryToken of queryTokens) {
                if (corpusTokens.some((corpusToken) => memoryTokensLooselyMatch(queryToken, corpusToken))) {
                    overlap += 1;
                }
            }
            score = Math.max(score, overlap);
            return { entry, score };
        });

        let matched = scored
            .filter((item) => item.score > 0)
            .sort((a, b) => a.score - b.score)
            .map((item) => item.entry)
            .slice(-limit)
            .reverse();

        if ((key.length > 0 || normalizedQuery.length > 0) && matched.length === 0) {
            matched = entries.slice(-limit).reverse();
        }
        return {
            success: true,
            count: matched.length,
            items: matched,
        };
    },
};
