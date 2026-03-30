import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    ScheduledTaskStore,
    detectScheduledIntent,
} from '../src/scheduling/scheduledTasks';
import { createMastraSchedulerRuntime } from '../src/mastra/schedulerRuntime';

const SRC_ROOT = path.join(process.cwd(), 'src');
const SCHEDULED_TASKS_PATH = path.join(SRC_ROOT, 'scheduling', 'scheduledTasks.ts');
const SCHEDULER_RUNTIME_PATH = path.join(SRC_ROOT, 'mastra', 'schedulerRuntime.ts');

describe('SCH-01: Cron 定时任务', () => {
    test('scheduledTasks 模块存在且包含循环调度解析', () => {
        expect(fs.existsSync(SCHEDULED_TASKS_PATH)).toBe(true);
        const content = fs.readFileSync(SCHEDULED_TASKS_PATH, 'utf-8');
        expect(content.includes('detectScheduledIntent')).toBe(true);
        expect(content.includes('RECURRING_INTERVAL_PATTERN')).toBe(true);
        expect(content.includes('computeNextRecurringExecuteAt')).toBe(true);
    });

    test('detectScheduledIntent 可解析循环任务', () => {
        const now = new Date('2026-03-30T10:00:00.000Z');
        const parsed = detectScheduledIntent('every 2 hours remind me to stand up', now);
        expect(parsed).toBeDefined();
        expect(parsed?.recurrence?.kind).toBe('rrule');
        expect(parsed?.recurrence?.value).toBe('FREQ=HOURLY;INTERVAL=2');
        expect(parsed?.taskQuery).toContain('stand up');
    });
});

describe('SCH-02: 文件监控（收敛后结构能力）', () => {
    test('detectScheduledIntent 可解析相对时间任务', () => {
        const now = new Date('2026-03-30T10:00:00.000Z');
        const parsed = detectScheduledIntent('in 10 minutes remind me to stretch', now);
        expect(parsed).toBeDefined();
        expect(parsed?.recurrence).toBeUndefined();
        expect(parsed?.executeAt.toISOString()).toBe('2026-03-30T10:10:00.000Z');
    });

    test('detectScheduledIntent 可解析带路由封装的中文定时任务', () => {
        const now = new Date('2026-03-30T00:00:00.000Z');
        const parsed = detectScheduledIntent('原始任务：早上3点关机\n用户路由：chat', now);
        expect(parsed).toBeDefined();
        expect(parsed?.taskQuery).toBe('关机');
        expect(parsed!.executeAt.getTime()).toBeGreaterThan(now.getTime());
        expect(parsed!.executeAt.getHours()).toBe(3);
        expect(parsed!.executeAt.getMinutes()).toBe(0);
    });
});

describe('SCH-03: Webhook 触发（收敛后链式调度能力）', () => {
    test('detectScheduledIntent 支持链式阶段拆分', () => {
        const now = new Date('2026-03-30T10:00:00.000Z');
        const parsed = detectScheduledIntent('10分钟后检查日志，然后20分钟后发总结', now);
        expect(parsed).toBeDefined();
        expect(parsed?.taskQuery).toContain('检查日志');
        expect(parsed?.chainedStages?.length).toBe(1);
        expect(parsed?.chainedStages?.[0]?.delayMsFromPrevious).toBe(20 * 60 * 1000);
    });
});

describe('SCH-04: 条件触发（收敛后运行时轮询能力）', () => {
    test('scheduler runtime 模块存在且包含轮询启动逻辑', () => {
        expect(fs.existsSync(SCHEDULER_RUNTIME_PATH)).toBe(true);
        const content = fs.readFileSync(SCHEDULER_RUNTIME_PATH, 'utf-8');
        expect(content.includes('pollDueTasks')).toBe(true);
        expect(content.includes('start')).toBe(true);
        expect(content.includes('setInterval')).toBe(true);
    });
});

describe('SCH-05: Daemon 循环', () => {
    test('scheduler runtime 支持 start/stop 生命周期', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-mastra-scheduler-'));
        const runtime = createMastraSchedulerRuntime({
            appDataRoot: tempDir,
            deps: {
                handleUserMessage: async () => ({ runId: 'run-test' }),
                resolveResourceIdForTask: (taskId) => `employee-${taskId}`,
                emitDesktopEventForTask: () => {},
                getNow: () => new Date('2026-03-30T10:00:00.000Z'),
            },
        });

        runtime.start();
        runtime.stop();

        expect(runtime.getStore()).toBeDefined();
    });
});

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

    test('recoverStaleRunning 不应回收等待用户交互的挂起任务', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-scheduled-task-'));
        const store = new ScheduledTaskStore(path.join(tempDir, 'scheduled-tasks.json'));
        const now = new Date('2026-03-17T16:00:00.000Z');

        const suspendedTask = store.create({
            title: 'suspended',
            taskQuery: 'wait user interaction',
            workspacePath: tempDir,
            executeAt: new Date('2026-03-17T15:30:00.000Z'),
            speakResult: false,
        });
        store.upsert({
            ...suspendedTask,
            status: 'suspended_waiting_user',
            startedAt: new Date('2026-03-17T15:31:00.000Z').toISOString(),
            error: 'waiting for user confirmation',
        });

        const recovered = store.recoverStaleRunning({
            now,
            timeoutMs: 10 * 60 * 1000,
        });

        expect(recovered).toHaveLength(0);
        const persisted = store.read().find((task) => task.id === suspendedTask.id);
        expect(persisted?.status).toBe('suspended_waiting_user');
        expect(persisted?.error).toBe('waiting for user confirmation');
    });
});
