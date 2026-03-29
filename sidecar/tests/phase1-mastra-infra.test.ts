import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import path from 'path';
import { Mastra } from '@mastra/core';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';

const TEST_DB = path.resolve(process.cwd(), '.test-mastra.db');

function cleanupTestDb(): void {
    for (const suffix of ['', '-wal', '-shm']) {
        const file = `${TEST_DB}${suffix}`;
        if (existsSync(file)) {
            rmSync(file, { force: true });
        }
    }
}

afterAll(() => {
    cleanupTestDb();
});

describe('Phase 1: Mastra Infra', () => {
    test('can create Mastra instance with LibSQLStore and logger', () => {
        const mastra = new Mastra({
            storage: new LibSQLStore({
                id: 'phase1-storage',
                url: `file:${TEST_DB}`,
            }),
            logger: new PinoLogger({
                name: 'phase1-test',
                level: 'silent',
            }),
        });

        expect(mastra).toBeDefined();
        expect(mastra.getStorage()).toBeDefined();
    });

    test('LibSQLVector can create index and persist db file', async () => {
        cleanupTestDb();

        const vector = new LibSQLVector({
            id: 'phase1-vector',
            url: `file:${TEST_DB}`,
        });

        await vector.createIndex({
            indexName: 'phase1_vectors',
            dimension: 8,
            metric: 'cosine',
        });

        expect(existsSync(TEST_DB)).toBe(true);
    });

    test('Mastra packages import in Bun runtime', async () => {
        const core = await import('@mastra/core');
        const memory = await import('@mastra/memory');
        const libsql = await import('@mastra/libsql');

        expect(core.Mastra).toBeDefined();
        expect(memory.Memory).toBeDefined();
        expect(libsql.LibSQLStore).toBeDefined();
        expect(libsql.LibSQLVector).toBeDefined();
    });
});
