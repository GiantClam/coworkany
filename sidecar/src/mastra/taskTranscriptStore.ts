import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type TaskTranscriptRole = 'user' | 'assistant' | 'system';

export type TaskTranscriptEntry = {
    id: string;
    role: TaskTranscriptRole;
    content: string;
    at: string;
};

function pickNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

type StoredRecord = {
    taskId: string;
    entries: TaskTranscriptEntry[];
};

export class MastraTaskTranscriptStore {
    private readonly filePath: string;
    private readonly records = new Map<string, TaskTranscriptEntry[]>();

    constructor(filePath: string) {
        this.filePath = filePath;
        this.load();
    }

    list(taskId: string, limit?: number): TaskTranscriptEntry[] {
        const entries = [...(this.records.get(taskId) ?? [])];
        if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
            return entries.slice(-Math.floor(limit));
        }
        return entries;
    }

    append(taskId: string, role: TaskTranscriptRole, content: string): TaskTranscriptEntry | null {
        const normalized = pickNonEmptyString(content);
        if (!normalized) {
            return null;
        }
        const entry: TaskTranscriptEntry = {
            id: randomUUID(),
            role,
            content: normalized,
            at: new Date().toISOString(),
        };
        const entries = [...(this.records.get(taskId) ?? [])];
        entries.push(entry);
        this.records.set(taskId, entries);
        this.save();
        return entry;
    }

    rewindByUserTurns(taskId: string, userTurns: number): {
        success: boolean;
        removedEntries: number;
        removedUserTurns: number;
        remainingEntries: number;
        latestUserMessage?: string;
    } {
        const entries = [...(this.records.get(taskId) ?? [])];
        if (entries.length === 0 || userTurns <= 0) {
            return {
                success: false,
                removedEntries: 0,
                removedUserTurns: 0,
                remainingEntries: entries.length,
            };
        }
        let userTurnsSeen = 0;
        let cutIndex = -1;
        for (let index = entries.length - 1; index >= 0; index -= 1) {
            if (entries[index]?.role === 'user') {
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
                removedEntries: 0,
                removedUserTurns: 0,
                remainingEntries: entries.length,
                latestUserMessage: entries.filter((entry) => entry.role === 'user').slice(-1)[0]?.content,
            };
        }
        const remaining = entries.slice(0, cutIndex);
        const removedEntries = entries.length - remaining.length;
        const removedUserTurns = entries
            .slice(cutIndex)
            .filter((entry) => entry.role === 'user')
            .length;
        this.records.set(taskId, remaining);
        this.save();
        const latestUserMessage = remaining.filter((entry) => entry.role === 'user').slice(-1)[0]?.content;
        return {
            success: removedEntries > 0,
            removedEntries,
            removedUserTurns,
            remainingEntries: remaining.length,
            latestUserMessage,
        };
    }

    private load(): void {
        if (!fs.existsSync(this.filePath)) {
            return;
        }
        try {
            const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as unknown;
            if (!Array.isArray(raw)) {
                return;
            }
            for (const item of raw) {
                if (!item || typeof item !== 'object' || Array.isArray(item)) {
                    continue;
                }
                const record = item as Record<string, unknown>;
                const taskId = pickNonEmptyString(record.taskId);
                if (!taskId) {
                    continue;
                }
                const entries = Array.isArray(record.entries)
                    ? record.entries
                        .map((entry): TaskTranscriptEntry | null => {
                            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                                return null;
                            }
                            const rawEntry = entry as Record<string, unknown>;
                            const role = rawEntry.role === 'assistant' || rawEntry.role === 'system' || rawEntry.role === 'user'
                                ? rawEntry.role
                                : null;
                            const content = pickNonEmptyString(rawEntry.content);
                            const at = pickNonEmptyString(rawEntry.at);
                            const id = pickNonEmptyString(rawEntry.id);
                            if (!role || !content || !at || !id) {
                                return null;
                            }
                            return {
                                id,
                                role,
                                content,
                                at,
                            };
                        })
                        .filter((entry): entry is TaskTranscriptEntry => entry !== null)
                    : [];
                this.records.set(taskId, entries);
            }
        } catch (error) {
            console.error('[MastraTaskTranscriptStore] Failed to load transcript store:', error);
        }
    }

    private save(): void {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            const records: StoredRecord[] = Array.from(this.records.entries()).map(([taskId, entries]) => ({
                taskId,
                entries,
            }));
            const tempFile = `${this.filePath}.tmp`;
            fs.writeFileSync(tempFile, JSON.stringify(records, null, 2), 'utf-8');
            fs.renameSync(tempFile, this.filePath);
        } catch (error) {
            console.error('[MastraTaskTranscriptStore] Failed to persist transcript store:', error);
        }
    }
}
