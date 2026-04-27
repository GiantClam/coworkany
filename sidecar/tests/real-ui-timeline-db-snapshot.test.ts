import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

type ReplayFixture = {
    source: string;
    cases: Array<{
        id: string;
        sourceThreadId: string;
        dbStats: {
            messageCount: number;
            userMessageCount: number;
            assistantMessageCount: number;
            firstAt: string;
            lastAt: string;
            durationMs: number;
            maxObservedGapMs: number;
        };
    }>;
};

type DbThreadStats = {
    messageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
    firstAt: string;
    lastAt: string;
};

type DbMessageTimestamp = {
    createdAt: string;
};

function repoRoot(): string {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function loadFixture(): ReplayFixture {
    const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'real-ui-timeline-replay-cases.json');
    return JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as ReplayFixture;
}

function durationMs(firstAt: string, lastAt: string): number {
    return new Date(lastAt).getTime() - new Date(firstAt).getTime();
}

function maxGapMs(rows: DbMessageTimestamp[]): number {
    let maxGap = 0;
    for (let index = 1; index < rows.length; index += 1) {
        const previous = new Date(rows[index - 1].createdAt).getTime();
        const current = new Date(rows[index].createdAt).getTime();
        maxGap = Math.max(maxGap, current - previous);
    }
    return maxGap;
}

describe('real UI timeline replay DB snapshot', () => {
    test('fixture dbStats match the current local Mastra DB when available', () => {
        const dbPath = path.join(repoRoot(), '.coworkany', 'data', 'coworkany.db');
        if (!fs.existsSync(dbPath)) {
            return;
        }

        const fixture = loadFixture();
        expect(fixture.source).toContain('.coworkany/data/coworkany.db');
        const db = new Database(dbPath, { readonly: true });
        try {
            const statsQuery = db.query<DbThreadStats, [string]>(`
                SELECT
                    COUNT(*) AS messageCount,
                    SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS userMessageCount,
                    SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) AS assistantMessageCount,
                    MIN(createdAt) AS firstAt,
                    MAX(createdAt) AS lastAt
                FROM mastra_messages
                WHERE thread_id = ?
            `);
            const timestampsQuery = db.query<DbMessageTimestamp, [string]>(`
                SELECT createdAt
                FROM mastra_messages
                WHERE thread_id = ?
                ORDER BY createdAt ASC
            `);

            for (const replayCase of fixture.cases) {
                const stats = statsQuery.get(replayCase.sourceThreadId);
                const timestamps = timestampsQuery.all(replayCase.sourceThreadId);
                expect(stats, replayCase.id).toBeTruthy();
                expect(stats?.messageCount).toBe(replayCase.dbStats.messageCount);
                expect(stats?.userMessageCount).toBe(replayCase.dbStats.userMessageCount);
                expect(stats?.assistantMessageCount).toBe(replayCase.dbStats.assistantMessageCount);
                expect(stats?.firstAt).toBe(replayCase.dbStats.firstAt);
                expect(stats?.lastAt).toBe(replayCase.dbStats.lastAt);
                expect(durationMs(replayCase.dbStats.firstAt, replayCase.dbStats.lastAt)).toBe(replayCase.dbStats.durationMs);
                expect(maxGapMs(timestamps)).toBe(replayCase.dbStats.maxObservedGapMs);
            }
        } finally {
            db.close();
        }
    });
});
