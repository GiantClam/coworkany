import * as fs from 'fs';
import * as path from 'path';
import { toTaskRuntimeState, type TaskRuntimeState } from './taskRuntimeState';

function cloneTaskRuntimeState(state: TaskRuntimeState): TaskRuntimeState {
    return {
        ...state,
        checkpoint: state.checkpoint
            ? {
                ...state.checkpoint,
                metadata: state.checkpoint.metadata
                    ? { ...state.checkpoint.metadata }
                    : undefined,
            }
            : undefined,
        checkpointVersion: state.checkpointVersion,
        retry: state.retry
            ? {
                ...state.retry,
            }
            : undefined,
        operationLog: Array.isArray(state.operationLog)
            ? state.operationLog.map((entry) => ({ ...entry }))
            : undefined,
    };
}

export class MastraTaskRuntimeStateStore {
    private readonly filePath: string;
    private readonly states = new Map<string, TaskRuntimeState>();

    constructor(filePath: string) {
        this.filePath = filePath;
        this.load();
    }

    list(): TaskRuntimeState[] {
        return Array.from(this.states.values()).map(cloneTaskRuntimeState);
    }

    upsert(state: TaskRuntimeState): void {
        this.states.set(state.taskId, cloneTaskRuntimeState(state));
        this.save();
    }

    private load(): void {
        if (!fs.existsSync(this.filePath)) {
            return;
        }
        try {
            const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as unknown;
            const records = Array.isArray(raw) ? raw : [];
            for (const record of records) {
                const normalized = toTaskRuntimeState(record);
                if (!normalized) {
                    continue;
                }
                this.states.set(normalized.taskId, normalized);
            }
        } catch (error) {
            console.error('[MastraTaskRuntimeStateStore] Failed to load state store:', error);
        }
    }

    private save(): void {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            const fileContent = JSON.stringify(
                Array.from(this.states.values()),
                null,
                2,
            );
            const tempFile = `${this.filePath}.tmp`;
            fs.writeFileSync(tempFile, fileContent, 'utf-8');
            fs.renameSync(tempFile, this.filePath);
        } catch (error) {
            console.error('[MastraTaskRuntimeStateStore] Failed to persist state store:', error);
        }
    }
}
