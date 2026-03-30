import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { DesktopEvent } from '../src/ipc/bridge';
import { createMastraSchedulerRuntime } from '../src/mastra/schedulerRuntime';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

function createHarness(input?: {
    now?: Date;
    onHandleUserMessage?: (
        message: string,
        threadId: string,
        resourceId: string,
        emit: (event: DesktopEvent) => void,
    ) => Promise<void>;
}) {
    const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-mastra-scheduler-'));
    tempDirs.push(appDataRoot);

    let now = input?.now ?? new Date('2026-03-30T02:00:00.000Z');
    const handleCalls: Array<{ message: string; threadId: string; resourceId: string }> = [];
    const emittedEvents: Array<{ taskId: string; event: DesktopEvent }> = [];

    const runtime = createMastraSchedulerRuntime({
        appDataRoot,
        deps: {
            handleUserMessage: async (message, threadId, resourceId, emit) => {
                handleCalls.push({ message, threadId, resourceId });
                if (input?.onHandleUserMessage) {
                    await input.onHandleUserMessage(message, threadId, resourceId, emit);
                } else {
                    emit({ type: 'text_delta', content: `done:${message}` });
                    emit({ type: 'complete', finishReason: 'stop' });
                }
                return { runId: 'run-scheduled' };
            },
            resolveResourceIdForTask: (taskId) => `employee-${taskId}`,
            emitDesktopEventForTask: (taskId, event) => {
                emittedEvents.push({ taskId, event });
            },
            getNow: () => now,
        },
    });

    return {
        runtime,
        appDataRoot,
        handleCalls,
        emittedEvents,
        setNow: (next: Date) => {
            now = next;
        },
        readRecords: () => runtime.getStore().read(),
    };
}

describe('mastra scheduler runtime', () => {
    test('scheduleIfNeeded detects scheduled intent and persists a scheduled record', async () => {
        const harness = createHarness();

        const decision = await harness.runtime.scheduleIfNeeded({
            sourceTaskId: 'task-1',
            title: '喝水提醒',
            message: '10 分钟后提醒我喝水',
            workspacePath: '/tmp/ws',
            config: {},
        });

        expect(decision.scheduled).toBe(true);
        expect(typeof decision.summary).toBe('string');

        const records = harness.readRecords();
        expect(records).toHaveLength(1);
        expect(records[0]?.sourceTaskId).toBe('task-1');
        expect(records[0]?.status).toBe('scheduled');
        expect(records[0]?.taskQuery).toBe('提醒我喝水');
    });

    test('scheduleIfNeeded suppresses duplicated schedule commands in short reconnect windows', async () => {
        const harness = createHarness({
            now: new Date('2026-03-30T02:00:00.000Z'),
        });

        const firstDecision = await harness.runtime.scheduleIfNeeded({
            sourceTaskId: 'task-idempotent',
            title: '喝水提醒',
            message: '10 分钟后提醒我喝水',
            workspacePath: '/tmp/ws',
            config: {},
        });

        harness.setNow(new Date('2026-03-30T02:00:20.000Z'));
        const duplicateDecision = await harness.runtime.scheduleIfNeeded({
            sourceTaskId: 'task-idempotent',
            title: '喝水提醒',
            message: '10 分钟后提醒我喝水',
            workspacePath: '/tmp/ws',
            config: {},
        });

        const records = harness.readRecords();
        expect(firstDecision.scheduled).toBe(true);
        expect(duplicateDecision.scheduled).toBe(true);
        expect(duplicateDecision.summary).toContain('重复');
        expect(duplicateDecision.taskId).toBe(firstDecision.taskId);
        expect(records).toHaveLength(1);
    });

    test('scheduleIfNeeded still creates a new schedule outside idempotency window', async () => {
        const harness = createHarness({
            now: new Date('2026-03-30T02:00:00.000Z'),
        });

        await harness.runtime.scheduleIfNeeded({
            sourceTaskId: 'task-idempotent-window',
            title: '喝水提醒',
            message: '10 分钟后提醒我喝水',
            workspacePath: '/tmp/ws',
            config: {},
        });

        harness.setNow(new Date('2026-03-30T02:03:00.000Z'));
        await harness.runtime.scheduleIfNeeded({
            sourceTaskId: 'task-idempotent-window',
            title: '喝水提醒',
            message: '10 分钟后提醒我喝水',
            workspacePath: '/tmp/ws',
            config: {},
        });

        const records = harness.readRecords();
        expect(records).toHaveLength(2);
        expect(records.every((record) => record.status === 'scheduled')).toBe(true);
    });

    test('pollDueTasks executes due task and marks it completed', async () => {
        const harness = createHarness();

        await harness.runtime.scheduleIfNeeded({
            sourceTaskId: 'task-exec',
            title: '执行任务',
            message: '1 分钟后整理日报',
            workspacePath: '/tmp/ws',
            config: {},
        });

        harness.setNow(new Date('2026-03-30T02:02:00.000Z'));
        await harness.runtime.pollDueTasks(new Date('2026-03-30T02:02:00.000Z'));

        expect(harness.handleCalls).toHaveLength(1);
        expect(harness.handleCalls[0]?.threadId).toBe('task-exec');
        expect(harness.handleCalls[0]?.resourceId).toBe('employee-task-exec');

        const records = harness.readRecords();
        expect(records).toHaveLength(1);
        expect(records[0]?.status).toBe('completed');
        expect(records[0]?.resultSummary).toContain('done:整理日报');
        expect(harness.emittedEvents.some((entry) => entry.event.type === 'complete')).toBe(true);
    });

    test('completed recurring task is automatically re-scheduled', async () => {
        const harness = createHarness({
            now: new Date('2026-03-30T02:00:00.000Z'),
        });

        await harness.runtime.scheduleIfNeeded({
            sourceTaskId: 'task-recurring',
            title: '循环提醒',
            message: '创建定时任务，从现在开始，每5分钟提醒我喝水',
            workspacePath: '/tmp/ws',
            config: {},
        });

        await harness.runtime.pollDueTasks(new Date('2026-03-30T02:00:00.000Z'));

        const records = harness.readRecords();
        expect(records.some((item) => item.status === 'completed')).toBe(true);
        const nextScheduled = records.find((item) => item.status === 'scheduled');
        expect(nextScheduled).toBeDefined();
        expect(nextScheduled?.executeAt).toBe('2026-03-30T02:05:00.000Z');
    });

    test('completed chained stage schedules the next stage with delay', async () => {
        const harness = createHarness({
            now: new Date('2026-03-30T02:00:00.000Z'),
        });

        await harness.runtime.scheduleIfNeeded({
            sourceTaskId: 'task-chain',
            title: '链式任务',
            message: '1 分钟以后，检索特朗普和伊朗是否有沟通停战的可能性，将结果保存到文件中。然后再等 1 分钟，将分析结果发布到 X 上',
            workspacePath: '/tmp/ws',
            config: {},
        });

        harness.setNow(new Date('2026-03-30T02:02:00.000Z'));
        await harness.runtime.pollDueTasks(new Date('2026-03-30T02:02:00.000Z'));

        const records = harness.readRecords();
        const stage1 = records.find((item) => item.stageIndex === 1 && item.status === 'scheduled');
        expect(stage1).toBeDefined();
        expect(stage1?.taskQuery).toBe('分析结果发布到 X 上');
        expect(stage1?.executeAt).toBe('2026-03-30T02:03:00.000Z');
    });

    test('cancelBySourceTask marks pending scheduled records as cancelled', async () => {
        const harness = createHarness();

        await harness.runtime.scheduleIfNeeded({
            sourceTaskId: 'task-cancel',
            title: '提醒 1',
            message: '10 分钟后提醒我喝水',
            workspacePath: '/tmp/ws',
            config: {},
        });
        await harness.runtime.scheduleIfNeeded({
            sourceTaskId: 'task-cancel',
            title: '提醒 2',
            message: '20 分钟后提醒我站起来活动',
            workspacePath: '/tmp/ws',
            config: {},
        });

        const result = await harness.runtime.cancelBySourceTask({
            sourceTaskId: 'task-cancel',
            userMessage: '取消这个定时任务',
        });

        expect(result.success).toBe(true);
        expect(result.cancelledCount).toBe(2);

        const records = harness.readRecords();
        expect(records.every((item) => item.status === 'cancelled')).toBe(true);
    });

    test('start triggers immediate poll and executes overdue task without waiting for first interval tick', async () => {
        const harness = createHarness({
            now: new Date('2026-03-30T02:00:00.000Z'),
        });

        await harness.runtime.scheduleIfNeeded({
            sourceTaskId: 'task-start-immediate',
            title: '立即恢复',
            message: '1 分钟后整理日报',
            workspacePath: '/tmp/ws',
            config: {},
        });

        harness.setNow(new Date('2026-03-30T02:02:00.000Z'));
        harness.runtime.start();
        await new Promise((resolve) => setTimeout(resolve, 80));
        harness.runtime.stop();

        expect(harness.handleCalls).toHaveLength(1);
        const records = harness.readRecords();
        expect(records[0]?.status).toBe('completed');
    });

    test('pollDueTasks recovers stale running tasks and emits failure event', async () => {
        const harness = createHarness({
            now: new Date('2026-03-30T02:30:00.000Z'),
        });

        const staleStartedAt = '2026-03-30T01:00:00.000Z';
        const staleExecuteAt = '2026-03-30T01:05:00.000Z';
        const staleRecord = {
            id: 'stale-running-1',
            title: 'stale running',
            taskQuery: '整理日报',
            workspacePath: '/tmp/ws',
            createdAt: staleStartedAt,
            executeAt: staleExecuteAt,
            status: 'running' as const,
            speakResult: false,
            sourceTaskId: 'task-stale',
            startedAt: staleStartedAt,
        };
        harness.runtime.getStore().upsert(staleRecord);

        await harness.runtime.pollDueTasks(new Date('2026-03-30T02:30:00.000Z'));

        const records = harness.readRecords();
        const recovered = records.find((item) => item.id === staleRecord.id);
        expect(recovered).toBeDefined();
        expect(recovered?.status).toBe('failed');
        expect(typeof recovered?.error).toBe('string');

        const failureEvent = harness.emittedEvents.find(
            (entry) => entry.taskId === 'task-stale' && entry.event.type === 'error',
        );
        expect(failureEvent).toBeDefined();
    });
});
