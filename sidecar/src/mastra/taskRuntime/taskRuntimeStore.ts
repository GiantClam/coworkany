import * as fs from 'fs';
import * as path from 'path';

export type PersistedTaskRuntimeStatus =
    | 'running'
    | 'retrying'
    | 'idle'
    | 'finished'
    | 'failed'
    | 'interrupted'
    | 'suspended'
    | 'scheduled';

export type PersistedTaskRuntimeSuspension = {
    reason: string;
    userMessage?: string;
    canAutoResume?: boolean;
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
    config?: Record<string, unknown>;
    historyLimit: number;
    artifactContract?: Record<string, unknown>;
    artifactsCreated: string[];
    suspension?: PersistedTaskRuntimeSuspension;
};

const MAX_ARCHIVED_TERMINAL_RECORDS = 100;
const TERMINAL_STATUSES = new Set<PersistedTaskRuntimeStatus>([
    'finished',
    'failed',
    'interrupted',
]);

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function asStatus(value: unknown): PersistedTaskRuntimeStatus | null {
    const normalized = asString(value);
    if (!normalized) {
        return null;
    }
    if (
        normalized !== 'running'
        && normalized !== 'retrying'
        && normalized !== 'idle'
        && normalized !== 'finished'
        && normalized !== 'failed'
        && normalized !== 'interrupted'
        && normalized !== 'suspended'
        && normalized !== 'scheduled'
    ) {
        return null;
    }
    return normalized;
}

function asPositiveInt(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return fallback;
    }
    return Math.floor(value);
}

function cloneRecord(record: PersistedTaskRuntimeRecord): PersistedTaskRuntimeRecord {
    return {
        ...record,
        conversation: Array.isArray(record.conversation)
            ? record.conversation.map((item) => item)
            : [],
        config: record.config ? { ...record.config } : undefined,
        artifactContract: record.artifactContract ? { ...record.artifactContract } : undefined,
        artifactsCreated: [...record.artifactsCreated],
        suspension: record.suspension ? { ...record.suspension } : undefined,
    };
}

function normalizeSuspension(value: unknown): PersistedTaskRuntimeSuspension | undefined {
    const raw = asRecord(value);
    const reason = asString(raw.reason);
    if (!reason) {
        return undefined;
    }
    const userMessage = asString(raw.userMessage) ?? undefined;
    const canAutoResume = typeof raw.canAutoResume === 'boolean' ? raw.canAutoResume : undefined;
    const maxWaitTimeMs = typeof raw.maxWaitTimeMs === 'number' && Number.isFinite(raw.maxWaitTimeMs) && raw.maxWaitTimeMs > 0
        ? Math.floor(raw.maxWaitTimeMs)
        : undefined;
    return {
        reason,
        userMessage,
        canAutoResume,
        maxWaitTimeMs,
    };
}

function normalizeRecord(value: unknown): PersistedTaskRuntimeRecord | null {
    const raw = asRecord(value);
    const taskId = asString(raw.taskId);
    const title = asString(raw.title);
    const workspacePath = asString(raw.workspacePath);
    const createdAt = asString(raw.createdAt);
    const updatedAt = asString(raw.updatedAt);
    const status = asStatus(raw.status);

    if (!taskId || !title || !workspacePath || !createdAt || !updatedAt || !status) {
        return null;
    }

    const conversation = Array.isArray(raw.conversation) ? raw.conversation.map((item) => item) : [];
    const artifactsCreated = Array.isArray(raw.artifactsCreated)
        ? raw.artifactsCreated
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .map((item) => item.trim())
        : [];
    const config = raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)
        ? { ...(raw.config as Record<string, unknown>) }
        : undefined;
    const artifactContract = raw.artifactContract && typeof raw.artifactContract === 'object' && !Array.isArray(raw.artifactContract)
        ? { ...(raw.artifactContract as Record<string, unknown>) }
        : undefined;
    const suspension = normalizeSuspension(raw.suspension);

    return {
        taskId,
        title,
        workspacePath,
        createdAt,
        updatedAt,
        status,
        conversation,
        config,
        historyLimit: asPositiveInt(raw.historyLimit, 50),
        artifactContract,
        artifactsCreated,
        suspension,
    };
}

function parseIsoTimestamp(value: string): number {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export class TaskRuntimeStore {
    private readonly filePath: string;
    private readonly records = new Map<string, PersistedTaskRuntimeRecord>();

    constructor(filePath: string) {
        this.filePath = filePath;
        this.load();
    }

    list(): PersistedTaskRuntimeRecord[] {
        return Array.from(this.records.values()).map(cloneRecord);
    }

    get(taskId: string): PersistedTaskRuntimeRecord | undefined {
        const hit = this.records.get(taskId);
        return hit ? cloneRecord(hit) : undefined;
    }

    upsert(record: PersistedTaskRuntimeRecord): void {
        const normalized = normalizeRecord(record);
        if (!normalized) {
            return;
        }
        this.records.set(normalized.taskId, normalized);
        this.pruneArchivedTerminalRecords();
        this.save();
    }

    private pruneArchivedTerminalRecords(): void {
        const terminalRecords = Array.from(this.records.values())
            .filter((record) => TERMINAL_STATUSES.has(record.status));
        const overflow = terminalRecords.length - MAX_ARCHIVED_TERMINAL_RECORDS;
        if (overflow <= 0) {
            return;
        }
        terminalRecords
            .sort((left, right) => {
                const leftTime = parseIsoTimestamp(left.updatedAt) || parseIsoTimestamp(left.createdAt);
                const rightTime = parseIsoTimestamp(right.updatedAt) || parseIsoTimestamp(right.createdAt);
                return leftTime - rightTime;
            })
            .slice(0, overflow)
            .forEach((record) => this.records.delete(record.taskId));
    }

    private load(): void {
        if (!fs.existsSync(this.filePath)) {
            return;
        }
        try {
            const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as unknown;
            const list = Array.isArray(raw) ? raw : [];
            for (const item of list) {
                const normalized = normalizeRecord(item);
                if (!normalized) {
                    continue;
                }
                this.records.set(normalized.taskId, normalized);
            }
            this.pruneArchivedTerminalRecords();
        } catch {
            // Ignore malformed persistence payloads and continue with an empty in-memory store.
        }
    }

    private save(): void {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            const tempPath = `${this.filePath}.tmp`;
            fs.writeFileSync(tempPath, JSON.stringify(this.list(), null, 2), 'utf-8');
            fs.renameSync(tempPath, this.filePath);
        } catch {
            // Best-effort persistence for runtime state snapshots.
        }
    }
}
