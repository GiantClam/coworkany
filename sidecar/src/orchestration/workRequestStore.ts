import * as fs from 'fs';
import * as path from 'path';
import { type FrozenWorkRequest } from './workRequestSchema';

function normalizeWorkRequests(raw: unknown): FrozenWorkRequest[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw.filter((item): item is FrozenWorkRequest => {
        if (!item || typeof item !== 'object') return false;
        const candidate = item as Partial<FrozenWorkRequest>;
        return (
            typeof candidate.id === 'string' &&
            candidate.schemaVersion === 1 &&
            typeof candidate.mode === 'string' &&
            typeof candidate.sourceText === 'string' &&
            typeof candidate.workspacePath === 'string' &&
            Array.isArray(candidate.tasks) &&
            candidate.clarification !== undefined &&
            candidate.presentation !== undefined &&
            typeof candidate.createdAt === 'string' &&
            typeof candidate.frozenAt === 'string'
        );
    });
}

export class WorkRequestStore {
    constructor(private readonly filePath: string) {}

    private ensureDirectory(): void {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    }

    private write(records: FrozenWorkRequest[]): void {
        this.ensureDirectory();
        fs.writeFileSync(this.filePath, JSON.stringify(records, null, 2), 'utf-8');
    }

    read(): FrozenWorkRequest[] {
        try {
            if (!fs.existsSync(this.filePath)) {
                return [];
            }
            return normalizeWorkRequests(JSON.parse(fs.readFileSync(this.filePath, 'utf-8')));
        } catch (error) {
            console.error('[WorkRequestStore] Failed to read work requests:', error);
            return [];
        }
    }

    create(request: FrozenWorkRequest): FrozenWorkRequest {
        const records = this.read();
        records.push(request);
        this.write(records);
        return request;
    }

    upsert(request: FrozenWorkRequest): void {
        const records = this.read();
        const index = records.findIndex((item) => item.id === request.id);
        if (index >= 0) {
            records[index] = request;
        } else {
            records.push(request);
        }
        this.write(records);
    }

    getById(id: string): FrozenWorkRequest | undefined {
        return this.read().find((item) => item.id === id);
    }
}
