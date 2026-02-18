import { describe, expect, test, beforeEach } from 'bun:test';
import { recoverMainLoopToolFailure } from '../mainLoopRecovery';

describe('Database failure → Self-learning trigger', () => {
    let toolErrorTracker: Map<string, number>;

    beforeEach(() => {
        toolErrorTracker = new Map<string, number>();
    });

    test('triggers self-learning on database tool failure after threshold', async () => {
        const lastUserQuery = '帮我查询 PostgreSQL 数据库中的用户表';
        let quickLearnCalled = 0;
        let capturedError = '';
        let capturedQuery = '';

        const result = await recoverMainLoopToolFailure({
            errorResult: 'psql: command not found',
            toolName: 'database_query',
            toolArgs: { connection: 'main', query: 'SELECT * FROM users' },
            lastUserQuery,
            consecutiveToolErrors: 1,
            toolErrorTracker,
            selfLearningThreshold: 2,
            formatErrorForAI: (stderr) => `[Error Analysis] ${stderr} - Try installing PostgreSQL client or using a different database tool.`,
            quickLearnFromError: async (errorMessage, originalQuery, attemptCount) => {
                quickLearnCalled++;
                capturedError = errorMessage;
                capturedQuery = originalQuery;
                return {
                    learned: true,
                    suggestion: 'Install postgresql client: brew install postgresql (macOS) or apt-get install postgresql-client (Ubuntu)',
                };
            },
            logger: {
                log: () => undefined,
                error: () => undefined,
            },
        });

        expect(quickLearnCalled).toBe(1);
        expect(capturedError).toContain('psql');
        expect(capturedQuery).toContain('PostgreSQL');
        expect(result.result).toContain('[Self-Learning Recovery]');
        expect(result.result).toContain('postgresql');
    });

    test('detects missing database client and suggests learning', async () => {
        let quickLearnCalled = 0;
        let lastSuggestion = '';

        const result = await recoverMainLoopToolFailure({
            errorResult: "Error: Cannot connect to MySQL server on 'localhost:3306'. Is MySQL running?",
            toolName: 'database_connect',
            toolArgs: { type: 'mysql', host: 'localhost', port: 3306, database: 'test' },
            lastUserQuery: '连接 MySQL 数据库',
            consecutiveToolErrors: 1,
            toolErrorTracker,
            selfLearningThreshold: 2,
            formatErrorForAI: (stderr) => `Connection failed: ${stderr}`,
            quickLearnFromError: async () => {
                quickLearnCalled++;
                lastSuggestion = 'MySQL client missing. Install with: brew install mysql (macOS) or apt-get install mysql-client (Ubuntu)';
                return {
                    learned: true,
                    suggestion: lastSuggestion,
                };
            },
            logger: {
                log: () => undefined,
                error: () => undefined,
            },
        });

        expect(quickLearnCalled).toBe(1);
        expect(result.result).toContain('MySQL');
        expect(result.result).toContain('[Self-Learning Recovery]');
    });

    test('database security rejection still triggers self-learning after threshold', async () => {
        let quickLearnCalled = 0;
        const result = await recoverMainLoopToolFailure({
            errorResult: 'Host "db.prod.internal" is not in allowlist. Configure COWORKANY_DB_HOST_ALLOWLIST to allow additional hosts.',
            toolName: 'database_connect',
            toolArgs: { type: 'postgres', host: 'db.prod.internal', database: 'app' },
            lastUserQuery: '连接生产库并查询最近订单',
            consecutiveToolErrors: 1,
            toolErrorTracker,
            selfLearningThreshold: 2,
            formatErrorForAI: (stderr) => `Connection rejected by security policy: ${stderr}`,
            quickLearnFromError: async () => {
                quickLearnCalled++;
                return {
                    learned: true,
                    suggestion: 'Use an allowed host (localhost) for local debugging, or ask operator to update COWORKANY_DB_HOST_ALLOWLIST.',
                };
            },
            logger: {
                log: () => undefined,
                error: () => undefined,
            },
        });

        expect(quickLearnCalled).toBe(1);
        expect(result.result).toContain('allowlist');
        expect(result.result).toContain('[Self-Learning Recovery]');
    });

    test('gap detector should recognize database-related queries', async () => {
        const databaseKeywords = [
            'postgresql',
            'postgres',
            'mysql',
            'mongodb',
            'sqlite',
            'knex',
            'drizzle',
        ];

        for (const keyword of databaseKeywords) {
            const result = await recoverMainLoopToolFailure({
                errorResult: `command not found: ${keyword}`,
                toolName: 'run_command',
                toolArgs: { command: keyword },
                lastUserQuery: `How to use ${keyword} in my project?`,
                consecutiveToolErrors: 1,
                toolErrorTracker,
                selfLearningThreshold: 2,
                formatErrorForAI: (stderr) => stderr,
                quickLearnFromError: async () => ({ learned: true, suggestion: `Install ${keyword}` }),
                logger: { log: () => undefined, error: () => undefined },
            });

            expect(result.result).toContain('[Self-Learning Recovery]');
        }
    });

    test('does not trigger learning for non-database errors below threshold', async () => {
        let quickLearnCalled = 0;

        const result = await recoverMainLoopToolFailure({
            errorResult: 'File not found: /tmp/test.txt',
            toolName: 'view_file',
            toolArgs: { path: '/tmp/test.txt' },
            lastUserQuery: '查看文件',
            consecutiveToolErrors: 0,
            toolErrorTracker,
            selfLearningThreshold: 2,
            formatErrorForAI: (stderr) => stderr,
            quickLearnFromError: async () => {
                quickLearnCalled++;
                return { learned: false };
            },
            logger: { log: () => undefined, error: () => undefined },
        });

        expect(quickLearnCalled).toBe(0);
        expect(result.consecutiveToolErrors).toBe(1);
    });
});
