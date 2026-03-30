import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { fastembed } from '@mastra/fastembed';
import { workingMemoryTemplate } from '../src/mastra/memory/working-memory-template';

const MEM_DB = '.test-phase5-memory.db';

function cleanupDb(): void {
    for (const suffix of ['', '-wal', '-shm']) {
        const file = `${MEM_DB}${suffix}`;
        if (existsSync(file)) {
            rmSync(file, { force: true });
        }
    }
}

afterAll(() => {
    cleanupDb();
});

describe('Phase 5: Memory + Enterprise Knowledge', () => {
    test('can create memory instance with storage/vector/embedder', () => {
        const memory = new Memory({
            storage: new LibSQLStore({ id: 'phase5-store', url: `file:${MEM_DB}` }),
            vector: new LibSQLVector({ id: 'phase5-vector', url: `file:${MEM_DB}` }),
            embedder: fastembed,
            options: {
                lastMessages: 20,
                semanticRecall: {
                    topK: 5,
                    messageRange: { before: 2, after: 1 },
                },
                workingMemory: {
                    enabled: true,
                    template: workingMemoryTemplate,
                    scope: 'resource',
                },
            },
        });

        expect(memory).toBeDefined();
    });

    test('working memory template contains core sections', () => {
        expect(workingMemoryTemplate).toContain('# 员工画像');
        expect(workingMemoryTemplate).toContain('## 1. 基本信息');
        expect(workingMemoryTemplate).toContain('## 3. 工作偏好');
        expect(workingMemoryTemplate).toContain('## 4. 技能图谱');
        expect(workingMemoryTemplate).toContain('## 7. 知识沉淀');
    });

    test('vector upsert and query works', async () => {
        cleanupDb();

        const vector = new LibSQLVector({
            id: 'phase5-vector-query',
            url: `file:${MEM_DB}`,
        });

        await vector.createIndex({
            indexName: 'phase5_vectors',
            dimension: 4,
            metric: 'cosine',
        });

        const seed = [0.1, 0.2, 0.3, 0.4];
        await vector.upsert({
            indexName: 'phase5_vectors',
            vectors: [seed],
            metadata: [{ text: 'typescript memory test' }],
        });

        const result = await vector.query({
            indexName: 'phase5_vectors',
            queryVector: seed,
            topK: 1,
        });

        expect(result.length).toBe(1);
        expect(existsSync(MEM_DB)).toBe(true);
    });
});
