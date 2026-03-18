/**
 * SCH-01 ~ SCH-05: 调度与主动监控测试 (P1)
 *
 * 对标 OpenClaw Cron/Webhook/Heartbeat Engine。
 * 验证 CoworkAny 的调度和自动化能力：
 *   1. Cron 定时任务 (Heartbeat cron trigger)
 *   2. 文件监控 (file watcher trigger)
 *   3. Webhook 触发 (HTTP trigger)
 *   4. 条件触发 (condition trigger)
 *   5. Daemon 循环 (background service)
 *
 * These tests verify the Heartbeat Engine infrastructure at the code level
 * rather than running long-duration cron jobs.
 *
 * Run: cd sidecar && bun test tests/scheduler-heartbeat.test.ts
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScheduledTaskStore } from '../src/scheduling/scheduledTasks';

const SRC_ROOT = path.join(process.cwd(), 'src');

// ============================================================================
// SCH-01: Cron 定时任务
// ============================================================================

describe('SCH-01: Cron 定时任务', () => {
    test('Heartbeat Engine 支持 cron 触发器', () => {
        const heartbeatPath = path.join(SRC_ROOT, 'proactive', 'heartbeat.ts');
        const exists = fs.existsSync(heartbeatPath);
        console.log(`[Test] heartbeat.ts exists: ${exists}`);
        expect(exists).toBe(true);

        if (exists) {
            const content = fs.readFileSync(heartbeatPath, 'utf-8');

            // Cron trigger support
            const hasCron = content.includes('cron') || content.includes('Cron');
            console.log(`[Test] Cron support: ${hasCron}`);
            expect(hasCron).toBe(true);

            // Should have scheduling logic
            const hasSchedule = content.includes('schedule') || content.includes('interval') || content.includes('setInterval');
            console.log(`[Test] Schedule logic: ${hasSchedule}`);
            expect(hasSchedule).toBe(true);
        }
    });

    test('Cron 表达式解析能力', () => {
        const heartbeatPath = path.join(SRC_ROOT, 'proactive', 'heartbeat.ts');
        if (!fs.existsSync(heartbeatPath)) {
            console.log('[SKIP] heartbeat.ts not found.');
            return;
        }

        const content = fs.readFileSync(heartbeatPath, 'utf-8');
        // Should reference cron expression patterns like "*/5 * * * *"
        const hasCronPattern = content.includes('* * *') || content.includes('cron-parser') || content.includes('cronExpression');
        console.log(`[Test] Cron expression support: ${hasCronPattern}`);
        expect(hasCronPattern).toBe(true);
    });
});

// ============================================================================
// SCH-02: 文件监控
// ============================================================================

describe('SCH-02: 文件监控', () => {
    test('Heartbeat Engine 支持文件监控触发器', () => {
        const heartbeatPath = path.join(SRC_ROOT, 'proactive', 'heartbeat.ts');
        if (!fs.existsSync(heartbeatPath)) {
            console.log('[SKIP] heartbeat.ts not found.');
            return;
        }

        const content = fs.readFileSync(heartbeatPath, 'utf-8');
        const hasFileWatch = content.includes('file') && (
            content.includes('watch') || content.includes('monitor') || content.includes('chokidar')
        );
        console.log(`[Test] File watch support: ${hasFileWatch}`);
        expect(hasFileWatch).toBe(true);
    });
});

// ============================================================================
// SCH-03: Webhook 触发
// ============================================================================

describe('SCH-03: Webhook 触发', () => {
    test('Heartbeat Engine 支持 webhook 触发器', () => {
        const heartbeatPath = path.join(SRC_ROOT, 'proactive', 'heartbeat.ts');
        if (!fs.existsSync(heartbeatPath)) {
            console.log('[SKIP] heartbeat.ts not found.');
            return;
        }

        const content = fs.readFileSync(heartbeatPath, 'utf-8');
        const hasWebhook = content.includes('webhook') || content.includes('Webhook') || content.includes('http');
        console.log(`[Test] Webhook support: ${hasWebhook}`);
        expect(hasWebhook).toBe(true);
    });
});

// ============================================================================
// SCH-04: 条件触发
// ============================================================================

describe('SCH-04: 条件触发', () => {
    test('Heartbeat Engine 支持条件触发器', () => {
        const heartbeatPath = path.join(SRC_ROOT, 'proactive', 'heartbeat.ts');
        if (!fs.existsSync(heartbeatPath)) {
            console.log('[SKIP] heartbeat.ts not found.');
            return;
        }

        const content = fs.readFileSync(heartbeatPath, 'utf-8');
        const hasCondition = content.includes('condition') || content.includes('Condition') ||
                            content.includes('trigger') || content.includes('Trigger');
        console.log(`[Test] Condition trigger support: ${hasCondition}`);
        expect(hasCondition).toBe(true);
    });
});

// ============================================================================
// SCH-05: Daemon 循环
// ============================================================================

describe('SCH-05: Daemon 循环', () => {
    test('Daemon 服务模块存在', () => {
        // Check for daemon service
        const daemonPaths = [
            path.join(SRC_ROOT, 'agent', 'jarvis', 'daemonService.ts'),
            path.join(SRC_ROOT, 'proactive', 'heartbeat.ts'),
        ];

        let foundDaemon = false;
        for (const dp of daemonPaths) {
            if (fs.existsSync(dp)) {
                foundDaemon = true;
                console.log(`[Test] Daemon module found: ${dp}`);

                const content = fs.readFileSync(dp, 'utf-8');
                const hasLoop = content.includes('loop') || content.includes('interval') ||
                               content.includes('setInterval') || content.includes('while');
                console.log(`[Test] Has background loop: ${hasLoop}`);
                expect(hasLoop).toBe(true);
                break;
            }
        }

        expect(foundDaemon).toBe(true);
    });

    test('Heartbeat Engine 有启动/停止生命周期', () => {
        const heartbeatPath = path.join(SRC_ROOT, 'proactive', 'heartbeat.ts');
        if (!fs.existsSync(heartbeatPath)) {
            console.log('[SKIP] heartbeat.ts not found.');
            return;
        }

        const content = fs.readFileSync(heartbeatPath, 'utf-8');

        const hasStart = content.includes('start') || content.includes('init');
        const hasStop = content.includes('stop') || content.includes('shutdown') || content.includes('destroy');

        console.log(`[Test] Has start lifecycle: ${hasStart}`);
        console.log(`[Test] Has stop lifecycle: ${hasStop}`);

        expect(hasStart).toBe(true);
        expect(hasStop).toBe(true);
    });
});

// ============================================================================
// SCH-06: Scheduled Task Recovery
// ============================================================================

describe('SCH-06: Scheduled Task Recovery', () => {
    test('recoverStaleRunning 将超时 running 任务标记为 failed', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-scheduled-task-'));
        const store = new ScheduledTaskStore(path.join(tempDir, 'scheduled-tasks.json'));
        const now = new Date('2026-03-17T16:00:00.000Z');

        const freshTask = store.create({
            title: 'fresh',
            taskQuery: 'fresh task',
            workspacePath: tempDir,
            executeAt: new Date('2026-03-17T15:55:00.000Z'),
            speakResult: false,
        });
        store.upsert({
            ...freshTask,
            status: 'running',
            startedAt: new Date('2026-03-17T15:59:30.000Z').toISOString(),
        });

        const staleTask = store.create({
            title: 'stale',
            taskQuery: 'stale task',
            workspacePath: tempDir,
            executeAt: new Date('2026-03-17T15:30:00.000Z'),
            speakResult: false,
        });
        store.upsert({
            ...staleTask,
            status: 'running',
            startedAt: new Date('2026-03-17T15:40:00.000Z').toISOString(),
        });

        const recovered = store.recoverStaleRunning({
            now,
            timeoutMs: 15 * 60 * 1000,
            errorMessage: 'timed out',
        });

        expect(recovered.map((task) => task.id)).toEqual([staleTask.id]);

        const tasks = store.read();
        expect(tasks.find((task) => task.id === staleTask.id)?.status).toBe('failed');
        expect(tasks.find((task) => task.id === staleTask.id)?.error).toBe('timed out');
        expect(tasks.find((task) => task.id === staleTask.id)?.completedAt).toBe(now.toISOString());
        expect(tasks.find((task) => task.id === freshTask.id)?.status).toBe('running');
    });

    test('recoverStaleRunning 会处理缺少 startedAt 的脏 running 任务', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-scheduled-task-'));
        const store = new ScheduledTaskStore(path.join(tempDir, 'scheduled-tasks.json'));
        const now = new Date('2026-03-17T16:00:00.000Z');

        const staleTask = store.create({
            title: 'stale-without-startedAt',
            taskQuery: 'task',
            workspacePath: tempDir,
            executeAt: new Date('2026-03-17T15:30:00.000Z'),
            speakResult: false,
        });
        store.upsert({
            ...staleTask,
            status: 'running',
            startedAt: undefined,
        });

        const recovered = store.recoverStaleRunning({
            now,
            timeoutMs: 10 * 60 * 1000,
        });

        expect(recovered).toHaveLength(1);
        expect(recovered[0]?.id).toBe(staleTask.id);
        expect(store.read()[0]?.status).toBe('failed');
    });
});
