import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type PolicyDecisionLogEntry = {
    id: string;
    at: string;
    requestId: string;
    action: 'task_command' | 'forward_command' | 'approval_result';
    commandType?: string;
    taskId?: string;
    source: string;
    allowed: boolean;
    reason: string;
    ruleId: string;
};

export type PolicyDecisionLogStore = {
    append: (entry: Omit<PolicyDecisionLogEntry, 'id' | 'at'>) => PolicyDecisionLogEntry;
    list: (input?: { taskId?: string; limit?: number }) => PolicyDecisionLogEntry[];
};

function pickNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export class MastraPolicyDecisionLogStore implements PolicyDecisionLogStore {
    private readonly filePath: string;
    private readonly entries: PolicyDecisionLogEntry[] = [];
    private readonly maxEntries: number;

    constructor(filePath: string, maxEntries = 4000) {
        this.filePath = filePath;
        this.maxEntries = Math.max(200, Math.floor(maxEntries));
        this.load();
    }

    append(entry: Omit<PolicyDecisionLogEntry, 'id' | 'at'>): PolicyDecisionLogEntry {
        const next: PolicyDecisionLogEntry = {
            id: randomUUID(),
            at: new Date().toISOString(),
            ...entry,
        };
        this.entries.push(next);
        this.compactIfNeeded();
        this.save();
        return next;
    }

    list(input?: { taskId?: string; limit?: number }): PolicyDecisionLogEntry[] {
        const taskId = pickNonEmptyString(input?.taskId);
        const filtered = taskId
            ? this.entries.filter((entry) => entry.taskId === taskId)
            : [...this.entries];
        const limit = typeof input?.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0
            ? Math.floor(input.limit)
            : undefined;
        if (typeof limit === 'number') {
            return filtered.slice(-limit);
        }
        return filtered;
    }

    private compactIfNeeded(): void {
        if (this.entries.length <= this.maxEntries) {
            return;
        }
        const overflow = this.entries.length - this.maxEntries;
        this.entries.splice(0, overflow);
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
            for (const value of raw) {
                if (!value || typeof value !== 'object' || Array.isArray(value)) {
                    continue;
                }
                const record = value as Record<string, unknown>;
                const id = pickNonEmptyString(record.id);
                const at = pickNonEmptyString(record.at);
                const requestId = pickNonEmptyString(record.requestId);
                const action = record.action;
                const source = pickNonEmptyString(record.source);
                const reason = pickNonEmptyString(record.reason);
                const ruleId = pickNonEmptyString(record.ruleId);
                const allowed = typeof record.allowed === 'boolean' ? record.allowed : undefined;
                if (
                    !id
                    || !at
                    || !requestId
                    || !source
                    || !reason
                    || !ruleId
                    || typeof allowed !== 'boolean'
                    || (action !== 'task_command' && action !== 'forward_command' && action !== 'approval_result')
                ) {
                    continue;
                }
                const entry: PolicyDecisionLogEntry = {
                    id,
                    at,
                    requestId,
                    action,
                    commandType: pickNonEmptyString(record.commandType),
                    taskId: pickNonEmptyString(record.taskId),
                    source,
                    allowed,
                    reason,
                    ruleId,
                };
                this.entries.push(entry);
            }
            this.compactIfNeeded();
        } catch (error) {
            console.error('[MastraPolicyDecisionLogStore] Failed to load policy decision log:', error);
        }
    }

    private save(): void {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            const tempPath = `${this.filePath}.tmp`;
            fs.writeFileSync(tempPath, JSON.stringify(this.entries, null, 2), 'utf-8');
            fs.renameSync(tempPath, this.filePath);
        } catch (error) {
            console.error('[MastraPolicyDecisionLogStore] Failed to persist policy decision log:', error);
        }
    }
}
