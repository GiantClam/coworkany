import { promises as fs } from 'fs';
import path from 'path';
import { SkillRecord, SkillRecordSchema } from './types';

export class SkillStore {
    private readonly storePath: string;
    private cache: Map<string, SkillRecord> = new Map();

    constructor(storePath: string) {
        this.storePath = storePath;
    }

    async load(): Promise<void> {
        try {
            const raw = await fs.readFile(this.storePath, 'utf-8');
            const data = JSON.parse(raw) as SkillRecord[];
            this.cache.clear();
            for (const record of data) {
                const parsed = SkillRecordSchema.parse(record);
                this.cache.set(parsed.manifest.id, parsed);
            }
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw err;
            }
        }
    }

    async save(): Promise<void> {
        const dir = path.dirname(this.storePath);
        await fs.mkdir(dir, { recursive: true });
        const records = Array.from(this.cache.values());
        await fs.writeFile(this.storePath, JSON.stringify(records, null, 2), 'utf-8');
    }

    list(): SkillRecord[] {
        return Array.from(this.cache.values());
    }

    get(skillId: string): SkillRecord | undefined {
        return this.cache.get(skillId);
    }

    upsert(record: SkillRecord): void {
        this.cache.set(record.manifest.id, record);
    }

    setEnabled(skillId: string, enabled: boolean): void {
        const record = this.cache.get(skillId);
        if (!record) return;
        this.cache.set(skillId, { ...record, enabled });
    }

    touch(skillId: string, timestamp: string): void {
        const record = this.cache.get(skillId);
        if (!record) return;
        this.cache.set(skillId, { ...record, lastUsedAt: timestamp });
    }
}
