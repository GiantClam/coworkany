import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

type CompressionTurn = {
    role: 'user' | 'assistant';
    content: string;
    at: string;
    turnId?: string;
};

export type TaskContextCompressionSnapshot = {
    taskId: string;
    threadId: string;
    resourceId: string;
    workspacePath?: string;
    updatedAt: string;
    turns: CompressionTurn[];
    microSummary: string;
    structuredSummary: string;
    lastMemoryDigest?: string;
};

export type RecalledTopicMemory = {
    title: string;
    relativePath: string;
    excerpt: string;
    score: number;
};

export type ContextPromptPack = {
    preamble?: string;
    microSummary: string;
    structuredSummary: string;
    recalledTopicMemories: RecalledTopicMemory[];
};

type RecordTurnInput = {
    taskId: string;
    threadId: string;
    resourceId: string;
    workspacePath?: string;
    content: string;
    turnId?: string;
};

const MAX_TURNS = 24;
const MAX_TURN_CONTENT_CHARS = 500;
const MICRO_SUMMARY_TURN_WINDOW = 4;
const STRUCTURED_USER_TURN_WINDOW = 5;
const STRUCTURED_ASSISTANT_TURN_WINDOW = 3;
const MEMORY_INDEX_FILE = 'MEMORY.md';
const MEMORY_TOPICS_DIR = 'memory';
const MAX_TOPIC_MEMORY_CANDIDATES = 64;
const MAX_RECALLED_TOPIC_MEMORIES = 3;

function resolveAppDataRoot(): string {
    const configured = process.env.COWORKANY_APP_DATA_DIR?.trim();
    return configured && configured.length > 0
        ? configured
        : path.join(process.cwd(), '.coworkany');
}

function pickContentSnippet(content: string, maxChars: number): string {
    const normalized = content.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxChars) {
        return normalized;
    }
    return `${normalized.slice(0, maxChars)}...`;
}

function buildMicroSummary(turns: CompressionTurn[]): string {
    const recent = turns.slice(-MICRO_SUMMARY_TURN_WINDOW);
    if (recent.length === 0) {
        return '- (empty)';
    }
    return recent
        .map((turn) => `- [${turn.role === 'user' ? 'U' : 'A'}] ${pickContentSnippet(turn.content, 180)}`)
        .join('\n');
}

function buildStructuredSummary(turns: CompressionTurn[]): string {
    const userTurns = turns.filter((turn) => turn.role === 'user').slice(-STRUCTURED_USER_TURN_WINDOW);
    const assistantTurns = turns.filter((turn) => turn.role === 'assistant').slice(-STRUCTURED_ASSISTANT_TURN_WINDOW);
    const latestUser = userTurns[userTurns.length - 1];
    const previousConstraints = userTurns.slice(0, -1).map((turn) => pickContentSnippet(turn.content, 120));
    const assistantProgress = assistantTurns.map((turn) => pickContentSnippet(turn.content, 120));

    return [
        `Current objective: ${latestUser ? pickContentSnippet(latestUser.content, 180) : 'none'}`,
        `User constraints: ${previousConstraints.length > 0 ? previousConstraints.join(' | ') : 'none'}`,
        `Assistant progress: ${assistantProgress.length > 0 ? assistantProgress.join(' | ') : 'none'}`,
    ].join('\n');
}

function buildMemoryDigest(summary: string): string {
    return createHash('sha1').update(summary).digest('hex');
}

function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'memory';
}

function toSearchTokens(input: string): string[] {
    const matches = input.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
    return Array.from(new Set(matches));
}

function countTokenOverlap(queryTokens: string[], text: string): number {
    if (queryTokens.length === 0 || text.trim().length === 0) {
        return 0;
    }
    const haystack = new Set(toSearchTokens(text));
    let count = 0;
    for (const token of queryTokens) {
        if (haystack.has(token)) {
            count += 1;
        }
    }
    return count;
}

type MemoryIndexEntry = {
    title: string;
    relativePath: string;
    hint: string;
};

function parseMemoryIndexEntries(memoryContent: string): MemoryIndexEntry[] {
    const entries: MemoryIndexEntry[] = [];
    const lines = memoryContent.split('\n');
    for (const rawLine of lines) {
        const line = rawLine.trim();
        const match = line.match(/^- \[([^\]]+)\]\(([^)]+)\)\s*(?:—|-|:)?\s*(.*)$/u);
        if (!match) {
            continue;
        }
        const title = match[1]?.trim() ?? '';
        const relativePath = match[2]?.trim() ?? '';
        const hint = match[3]?.trim() ?? '';
        if (!title || !relativePath) {
            continue;
        }
        entries.push({
            title,
            relativePath,
            hint,
        });
    }
    return entries;
}

export class TaskContextCompressionStore {
    private readonly filePath: string;
    private readonly snapshots = new Map<string, TaskContextCompressionSnapshot>();

    constructor(filePath = path.join(resolveAppDataRoot(), 'mastra-context-state.json')) {
        this.filePath = filePath;
        this.load();
    }

    get(taskId: string): TaskContextCompressionSnapshot | undefined {
        const snapshot = this.snapshots.get(taskId);
        return snapshot ? { ...snapshot, turns: [...snapshot.turns] } : undefined;
    }

    recordUserTurn(input: RecordTurnInput): TaskContextCompressionSnapshot {
        return this.recordTurn('user', input);
    }

    recordAssistantTurn(input: RecordTurnInput): TaskContextCompressionSnapshot {
        return this.recordTurn('assistant', input);
    }

    buildPromptPack(taskId: string): ContextPromptPack | undefined {
        const snapshot = this.snapshots.get(taskId);
        if (!snapshot) {
            return undefined;
        }
        const recalledTopicMemories = this.findRelevantTopicMemories(snapshot);
        const topicSection = recalledTopicMemories.length > 0
            ? [
                '',
                'Relevant file memories:',
                ...recalledTopicMemories.map((entry) => `- ${entry.title} (${entry.relativePath}): ${entry.excerpt}`),
            ]
            : [];
        return {
            preamble: [
            '[Context Compression]',
            'Micro context:',
            snapshot.microSummary,
            '',
            'Structured summary:',
            snapshot.structuredSummary,
            ...topicSection,
            '',
            'Use this as background context. Prioritize the latest user message when conflicts exist.',
            ].join('\n'),
            microSummary: snapshot.microSummary,
            structuredSummary: snapshot.structuredSummary,
            recalledTopicMemories,
        };
    }

    buildPreamble(taskId: string): string | undefined {
        return this.buildPromptPack(taskId)?.preamble;
    }

    rewindByUserTurns(taskId: string, userTurns: number): {
        success: boolean;
        removedTurns: number;
        remainingTurns: number;
    } {
        const snapshot = this.snapshots.get(taskId);
        if (!snapshot || userTurns <= 0) {
            return {
                success: false,
                removedTurns: 0,
                remainingTurns: snapshot?.turns.length ?? 0,
            };
        }
        let userTurnsSeen = 0;
        let cutIndex = -1;
        for (let index = snapshot.turns.length - 1; index >= 0; index -= 1) {
            if (snapshot.turns[index]?.role === 'user') {
                userTurnsSeen += 1;
                if (userTurnsSeen === userTurns) {
                    cutIndex = index;
                    break;
                }
            }
        }
        if (cutIndex < 0) {
            return {
                success: false,
                removedTurns: 0,
                remainingTurns: snapshot.turns.length,
            };
        }
        const nextTurns = snapshot.turns.slice(0, cutIndex);
        const removedTurns = snapshot.turns.length - nextTurns.length;
        const nextSnapshot: TaskContextCompressionSnapshot = {
            ...snapshot,
            turns: nextTurns,
            updatedAt: new Date().toISOString(),
            microSummary: buildMicroSummary(nextTurns),
            structuredSummary: buildStructuredSummary(nextTurns),
            lastMemoryDigest: undefined,
        };
        this.snapshots.set(taskId, nextSnapshot);
        this.save();
        return {
            success: removedTurns > 0,
            removedTurns,
            remainingTurns: nextTurns.length,
        };
    }

    private recordTurn(role: CompressionTurn['role'], input: RecordTurnInput): TaskContextCompressionSnapshot {
        const existing = this.snapshots.get(input.taskId);
        const turns = [...(existing?.turns ?? [])];
        const normalizedTurnId = typeof input.turnId === 'string' && input.turnId.trim().length > 0
            ? input.turnId.trim()
            : undefined;
        const nextTurn: CompressionTurn = {
            role,
            content: pickContentSnippet(input.content, MAX_TURN_CONTENT_CHARS),
            at: new Date().toISOString(),
            turnId: normalizedTurnId,
        };

        if (normalizedTurnId) {
            const existingTurnIndex = turns.findIndex((turn) => (
                turn.role === role
                && turn.turnId === normalizedTurnId
            ));
            if (existingTurnIndex >= 0) {
                const existingTurn = turns[existingTurnIndex];
                if (nextTurn.content.length > existingTurn.content.length) {
                    turns[existingTurnIndex] = {
                        ...existingTurn,
                        content: nextTurn.content,
                        at: nextTurn.at,
                    };
                }
            } else {
                turns.push(nextTurn);
            }
        } else {
            turns.push(nextTurn);
        }

        const trimmedTurns = turns.slice(-MAX_TURNS);
        const microSummary = buildMicroSummary(trimmedTurns);
        const structuredSummary = buildStructuredSummary(trimmedTurns);
        const next: TaskContextCompressionSnapshot = {
            taskId: input.taskId,
            threadId: input.threadId,
            resourceId: input.resourceId,
            workspacePath: input.workspacePath ?? existing?.workspacePath,
            updatedAt: new Date().toISOString(),
            turns: trimmedTurns,
            microSummary,
            structuredSummary,
            lastMemoryDigest: existing?.lastMemoryDigest,
        };
        this.appendToMemoryFile(next);
        this.snapshots.set(input.taskId, next);
        this.save();
        return { ...next, turns: [...next.turns] };
    }

    private appendToMemoryFile(snapshot: TaskContextCompressionSnapshot): void {
        if (!snapshot.workspacePath || snapshot.workspacePath.trim().length === 0) {
            return;
        }
        const digest = buildMemoryDigest(snapshot.structuredSummary);
        if (snapshot.lastMemoryDigest === digest) {
            return;
        }
        try {
            const memoryDir = path.join(snapshot.workspacePath, '.coworkany');
            const memoryFilePath = path.join(memoryDir, MEMORY_INDEX_FILE);
            const topicMemoryDirPath = path.join(memoryDir, MEMORY_TOPICS_DIR);
            fs.mkdirSync(memoryDir, { recursive: true });
            fs.mkdirSync(topicMemoryDirPath, { recursive: true });
            const objective = snapshot.structuredSummary.split('\n')[0] ?? 'Task memory';
            const topicFileName = `${slugify(snapshot.taskId)}-${Date.now()}.md`;
            const topicRelativePath = `${MEMORY_TOPICS_DIR}/${topicFileName}`;
            const topicFilePath = path.join(topicMemoryDirPath, topicFileName);
            const topicContent = [
                `# Task ${snapshot.taskId}`,
                '',
                `Updated at: ${new Date().toISOString()}`,
                '',
                snapshot.structuredSummary,
                '',
            ].join('\n');
            fs.writeFileSync(topicFilePath, topicContent, 'utf-8');
            const indexLine = `- [${pickContentSnippet(objective, 96)}](${topicRelativePath}) — ${pickContentSnippet(snapshot.structuredSummary, 140)}`;
            const block = [
                '',
                `## Task ${snapshot.taskId} @ ${new Date().toISOString()}`,
                indexLine,
                '',
                snapshot.structuredSummary,
                '',
            ].join('\n');
            fs.appendFileSync(memoryFilePath, block, 'utf-8');
            snapshot.lastMemoryDigest = digest;
        } catch (error) {
            console.error('[TaskContextCompressionStore] Failed to append MEMORY.md:', error);
        }
    }

    private load(): void {
        if (!fs.existsSync(this.filePath)) {
            return;
        }
        try {
            const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as unknown;
            const records = Array.isArray(raw) ? raw : [];
            for (const record of records) {
                if (!record || typeof record !== 'object' || Array.isArray(record)) {
                    continue;
                }
                const rawRecord = record as Record<string, unknown>;
                const taskId = typeof rawRecord.taskId === 'string' ? rawRecord.taskId : '';
                if (!taskId) {
                    continue;
                }
                const turns = Array.isArray(rawRecord.turns)
                    ? rawRecord.turns
                        .map((turn) => {
                            if (!turn || typeof turn !== 'object' || Array.isArray(turn)) {
                                return null;
                            }
                            const rawTurn = turn as Record<string, unknown>;
                            const role = rawTurn.role === 'assistant' ? 'assistant' : (rawTurn.role === 'user' ? 'user' : null);
                            const content = typeof rawTurn.content === 'string' ? rawTurn.content : '';
                            const at = typeof rawTurn.at === 'string' ? rawTurn.at : '';
                            const turnId = typeof rawTurn.turnId === 'string' && rawTurn.turnId.trim().length > 0
                                ? rawTurn.turnId.trim()
                                : undefined;
                            if (!role || !content || !at) {
                                return null;
                            }
                            const parsedTurn: CompressionTurn = turnId
                                ? { role, content, at, turnId }
                                : { role, content, at };
                            return parsedTurn;
                        })
                        .filter((turn): turn is CompressionTurn => turn !== null)
                    : [];
                this.snapshots.set(taskId, {
                    taskId,
                    threadId: typeof rawRecord.threadId === 'string' ? rawRecord.threadId : taskId,
                    resourceId: typeof rawRecord.resourceId === 'string' ? rawRecord.resourceId : `employee-${taskId}`,
                    workspacePath: typeof rawRecord.workspacePath === 'string' ? rawRecord.workspacePath : undefined,
                    updatedAt: typeof rawRecord.updatedAt === 'string' ? rawRecord.updatedAt : new Date().toISOString(),
                    turns,
                    microSummary: typeof rawRecord.microSummary === 'string'
                        ? rawRecord.microSummary
                        : buildMicroSummary(turns),
                    structuredSummary: typeof rawRecord.structuredSummary === 'string'
                        ? rawRecord.structuredSummary
                        : buildStructuredSummary(turns),
                    lastMemoryDigest: typeof rawRecord.lastMemoryDigest === 'string'
                        ? rawRecord.lastMemoryDigest
                        : undefined,
                });
            }
        } catch (error) {
            console.error('[TaskContextCompressionStore] Failed to load context store:', error);
        }
    }

    private save(): void {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            const records = Array.from(this.snapshots.values());
            const tempFile = `${this.filePath}.tmp`;
            fs.writeFileSync(tempFile, JSON.stringify(records, null, 2), 'utf-8');
            fs.renameSync(tempFile, this.filePath);
        } catch (error) {
            console.error('[TaskContextCompressionStore] Failed to persist context store:', error);
        }
    }

    private findRelevantTopicMemories(snapshot: TaskContextCompressionSnapshot): RecalledTopicMemory[] {
        if (!snapshot.workspacePath || snapshot.workspacePath.trim().length === 0) {
            return [];
        }
        try {
            const memoryDir = path.join(snapshot.workspacePath, '.coworkany');
            const memoryFilePath = path.join(memoryDir, MEMORY_INDEX_FILE);
            if (!fs.existsSync(memoryFilePath)) {
                return [];
            }
            const rawMemoryIndex = fs.readFileSync(memoryFilePath, 'utf-8');
            const indexEntries = parseMemoryIndexEntries(rawMemoryIndex);
            if (indexEntries.length === 0) {
                return [];
            }
            const querySeed = [
                snapshot.turns.filter((turn) => turn.role === 'user').slice(-1)[0]?.content ?? '',
                snapshot.structuredSummary,
            ].join('\n');
            const queryTokens = toSearchTokens(querySeed);
            const recentEntries = indexEntries.slice(-MAX_TOPIC_MEMORY_CANDIDATES).reverse();
            const scored: Array<RecalledTopicMemory & { mtimeMs: number }> = [];
            for (const entry of recentEntries) {
                const absolutePath = path.resolve(memoryDir, entry.relativePath);
                if (!absolutePath.startsWith(path.resolve(memoryDir))) {
                    continue;
                }
                if (!fs.existsSync(absolutePath)) {
                    continue;
                }
                const stat = fs.statSync(absolutePath);
                if (!stat.isFile()) {
                    continue;
                }
                const content = fs.readFileSync(absolutePath, 'utf-8');
                const excerpt = pickContentSnippet(content.replace(/^#.*$/m, '').trim(), 220);
                const score = countTokenOverlap(queryTokens, `${entry.title}\n${entry.hint}\n${excerpt}`);
                if (score <= 0) {
                    continue;
                }
                scored.push({
                    title: entry.title,
                    relativePath: entry.relativePath,
                    excerpt,
                    score,
                    mtimeMs: stat.mtimeMs,
                });
            }
            scored.sort((left, right) => {
                if (left.score !== right.score) {
                    return right.score - left.score;
                }
                return right.mtimeMs - left.mtimeMs;
            });
            return scored
                .slice(0, MAX_RECALLED_TOPIC_MEMORIES)
                .map((entry) => ({
                    title: entry.title,
                    relativePath: entry.relativePath,
                    excerpt: entry.excerpt,
                    score: entry.score,
                }));
        } catch (error) {
            console.error('[TaskContextCompressionStore] Failed to read topic memories:', error);
            return [];
        }
    }
}
