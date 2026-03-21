import * as fs from 'fs';
import * as path from 'path';
import { type TaskSessionConfig } from './taskSessionStore';

const MAX_ARCHIVED_TERMINAL_RECORDS = 100;

export type PersistedTaskRuntimeStatus =
    | 'running'
    | 'suspended'
    | 'interrupted'
    | 'idle'
    | 'finished'
    | 'failed';

export type PersistedTaskSuspension = {
    reason: string;
    userMessage: string;
    canAutoResume: boolean;
    maxWaitTimeMs?: number;
};

export type PersistedTaskRuntimeRecord = {
    taskId: string;
    title: string;
    workspacePath: string;
    createdAt: string;
    updatedAt: string;
    status: PersistedTaskRuntimeStatus;
    conversation: unknown[];
    config?: TaskSessionConfig;
    historyLimit: number;
    artifactContract?: unknown;
    artifactsCreated: string[];
    suspension?: PersistedTaskSuspension;
};

function isArchivedTerminalStatus(status: PersistedTaskRuntimeStatus): boolean {
    return status === 'finished' || status === 'failed';
}

function isRecord(value: unknown): value is PersistedTaskRuntimeRecord {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<PersistedTaskRuntimeRecord>;
    return (
        typeof candidate.taskId === 'string' &&
        typeof candidate.title === 'string' &&
        typeof candidate.workspacePath === 'string' &&
        typeof candidate.createdAt === 'string' &&
        typeof candidate.updatedAt === 'string' &&
        (candidate.status === 'running' ||
            candidate.status === 'suspended' ||
            candidate.status === 'interrupted' ||
            candidate.status === 'idle' ||
            candidate.status === 'finished' ||
            candidate.status === 'failed') &&
        Array.isArray(candidate.conversation) &&
        typeof candidate.historyLimit === 'number' &&
        Array.isArray(candidate.artifactsCreated)
    );
}

function normalizeRecords(raw: unknown): PersistedTaskRuntimeRecord[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw
        .filter(isRecord)
        .map((record) => ({
            ...record,
            conversation: Array.isArray(record.conversation) ? record.conversation : [],
            artifactsCreated: Array.isArray(record.artifactsCreated) ? record.artifactsCreated : [],
            historyLimit:
                typeof record.historyLimit === 'number' && record.historyLimit > 0
                    ? record.historyLimit
                    : 50,
            suspension:
                record.suspension &&
                typeof record.suspension === 'object' &&
                typeof record.suspension.reason === 'string' &&
                typeof record.suspension.userMessage === 'string' &&
                typeof record.suspension.canAutoResume === 'boolean'
                    ? {
                        reason: record.suspension.reason,
                        userMessage: record.suspension.userMessage,
                        canAutoResume: record.suspension.canAutoResume,
                        maxWaitTimeMs:
                            typeof record.suspension.maxWaitTimeMs === 'number'
                                ? record.suspension.maxWaitTimeMs
                                : undefined,
                    }
                    : undefined,
        }));
}

export class TaskRuntimeStore {
    private readonly storagePath: string;
    private records = new Map<string, PersistedTaskRuntimeRecord>();

    constructor(storagePath: string) {
        this.storagePath = storagePath;
        this.load();
    }

    list(): PersistedTaskRuntimeRecord[] {
        return Array.from(this.records.values()).map((record) => ({
            ...record,
            conversation: [...record.conversation],
            artifactsCreated: [...record.artifactsCreated],
            config: record.config ? { ...record.config } : undefined,
            suspension: record.suspension ? { ...record.suspension } : undefined,
        }));
    }

    get(taskId: string): PersistedTaskRuntimeRecord | undefined {
        const record = this.records.get(taskId);
        if (!record) {
            return undefined;
        }
        return {
            ...record,
            conversation: [...record.conversation],
            artifactsCreated: [...record.artifactsCreated],
            config: record.config ? { ...record.config } : undefined,
            suspension: record.suspension ? { ...record.suspension } : undefined,
        };
    }

    upsert(record: PersistedTaskRuntimeRecord): PersistedTaskRuntimeRecord {
        const normalized: PersistedTaskRuntimeRecord = {
            ...record,
            conversation: Array.isArray(record.conversation) ? [...record.conversation] : [],
            artifactsCreated: Array.isArray(record.artifactsCreated) ? [...record.artifactsCreated] : [],
            config: record.config ? { ...record.config } : undefined,
            suspension: record.suspension ? { ...record.suspension } : undefined,
        };
        this.records.set(record.taskId, normalized);
        this.pruneArchivedTerminalRecords();
        this.save();
        return normalized;
    }

    delete(taskId: string): boolean {
        const removed = this.records.delete(taskId);
        if (removed) {
            this.save();
        }
        return removed;
    }

    clear(): void {
        this.records.clear();
        this.save();
    }

    private load(): void {
        try {
            if (!fs.existsSync(this.storagePath)) {
                return;
            }
            const raw = fs.readFileSync(this.storagePath, 'utf-8');
            const parsed = JSON.parse(raw);
            this.records = new Map(
                normalizeRecords(parsed).map((record) => [record.taskId, record])
            );
            this.pruneArchivedTerminalRecords();
        } catch (error) {
            console.error('[TaskRuntimeStore] Failed to load runtime store:', error);
            this.records = new Map();
        }
    }

    private pruneArchivedTerminalRecords(): void {
        const archivedTerminalRecords = Array.from(this.records.values())
            .filter((record) => isArchivedTerminalStatus(record.status))
            .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));

        const overflow = archivedTerminalRecords.length - MAX_ARCHIVED_TERMINAL_RECORDS;
        if (overflow <= 0) {
            return;
        }

        for (const record of archivedTerminalRecords.slice(0, overflow)) {
            this.records.delete(record.taskId);
        }
    }

    private save(): void {
        try {
            const dir = path.dirname(this.storagePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(
                this.storagePath,
                JSON.stringify(this.list(), null, 2),
                'utf-8'
            );
        } catch (error) {
            console.error('[TaskRuntimeStore] Failed to save runtime store:', error);
        }
    }
}
