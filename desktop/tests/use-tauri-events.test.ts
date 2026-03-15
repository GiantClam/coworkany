import { beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { buildRecoverableTaskHints, buildScheduledTaskMirrorInfo, mirrorBackgroundTaskIntoActiveSession } from '../src/hooks/useTauriEvents';
import { useTaskEventStore, type TaskEvent } from '../src/stores/useTaskEventStore';

function makeTaskEvent(taskId: string, type: TaskEvent['type'], payload: Record<string, unknown>): TaskEvent {
    return {
        id: `${taskId}:${type}`,
        taskId,
        timestamp: '2026-03-13T12:00:00.000Z',
        sequence: 1,
        type,
        payload,
    };
}

describe('useTauriEvents scheduled task mirroring', () => {
    beforeEach(() => {
        useTaskEventStore.getState().reset();
    });

    test('mirrors scheduled task completion into the active session', () => {
        const store = useTaskEventStore.getState();
        store.setActiveTask('active-task');
        store.addEvent(makeTaskEvent('active-task', 'TASK_STARTED', {
            title: 'Foreground task',
            context: {
                userQuery: 'install a package',
            },
        }));

        const event = makeTaskEvent('scheduled_123', 'TASK_FINISHED', {
            summary: 'Nightly sync completed successfully.',
        });
        const mirror = buildScheduledTaskMirrorInfo(event);

        expect(mirror).not.toBeNull();
        mirrorBackgroundTaskIntoActiveSession(event, mirror!.sessionMessage);

        const activeSession = useTaskEventStore.getState().sessions.get('active-task');
        expect(activeSession?.messages.at(-1)?.role).toBe('system');
        expect(activeSession?.messages.at(-1)?.content).toBe('[Scheduled Task Completed] Nightly sync completed successfully.');
    });

    test('does not mirror reminder summaries as generic scheduled task outcomes', () => {
        const reminderEvent = makeTaskEvent('scheduled_456', 'TASK_FINISHED', {
            summary: '[Reminder] Stand up and stretch',
        });

        expect(buildScheduledTaskMirrorInfo(reminderEvent)).toBeNull();
    });

    test('does not mirror into the same active scheduled task', () => {
        const store = useTaskEventStore.getState();
        store.setActiveTask('scheduled_same');
        store.addEvent(makeTaskEvent('scheduled_same', 'TASK_STARTED', {
            title: 'Background task',
            context: {
                userQuery: 'nightly job',
            },
        }));

        const event = makeTaskEvent('scheduled_same', 'TASK_FAILED', {
            error: 'Sync failed',
            suggestion: 'Retry after credentials refresh.',
        });
        const mirror = buildScheduledTaskMirrorInfo(event);

        expect(mirror).not.toBeNull();
        mirrorBackgroundTaskIntoActiveSession(event, mirror!.sessionMessage);

        const activeSession = useTaskEventStore.getState().sessions.get('scheduled_same');
        expect(activeSession?.messages).toHaveLength(1);
        expect(activeSession?.messages[0]?.role).toBe('user');
    });

    test('falls back to the most recent foreground session when active task is scheduled', () => {
        const store = useTaskEventStore.getState();
        store.setActiveTask('foreground-install');
        store.addEvent(makeTaskEvent('foreground-install', 'TASK_STARTED', {
            title: 'Install task',
            context: {
                userQuery: 'install python package',
            },
        }));

        store.setActiveTask('scheduled_view');
        store.addEvent(makeTaskEvent('scheduled_view', 'TASK_STARTED', {
            title: 'Scheduled task',
            context: {
                userQuery: 'background summary',
            },
        }));

        const event = makeTaskEvent('scheduled_999', 'TASK_FINISHED', {
            summary: '<thinking>internal reasoning</thinking>Background sync finished successfully.',
        });
        const mirror = buildScheduledTaskMirrorInfo(event);

        expect(mirror).not.toBeNull();
        expect(mirror?.toastDescription).toBe('Background sync finished successfully.');
        mirrorBackgroundTaskIntoActiveSession(event, mirror!.sessionMessage);

        const foregroundSession = useTaskEventStore.getState().sessions.get('foreground-install');
        expect(foregroundSession?.messages.at(-1)?.content).toBe(
            '[Scheduled Task Completed] Background sync finished successfully.'
        );
    });

    test('registers sidecar reconnected recovery hook', () => {
        const source = fs.readFileSync(
            path.join(process.cwd(), 'src', 'hooks', 'useTauriEvents.ts'),
            'utf-8',
        );

        expect(source).toContain("listen('sidecar-reconnected'");
        expect(source).toContain("resumeRecoverableTasks('reconnect')");
        expect(source).toContain("resumeRecoverableTasks('startup')");
        expect(source).toContain("buildRecoverableTaskHints(reason)");
        expect(source).toContain("taskIds: tasks.map((task) => task.taskId)");
        expect((source.match(/invoke\('resume_recoverable_tasks'/g) ?? []).length).toBe(1);
    });

    test('filters non-uuid scheduled sessions from recovery hints', () => {
        const store = useTaskEventStore.getState();
        store.addEvent(makeTaskEvent('330f06be-1f4e-4e3a-976c-89cb29c9a9d4', 'TASK_FAILED', {
            error: 'stream interrupted',
            recoverable: true,
            suggestion: 'retry',
        }));
        store.addEvent(makeTaskEvent('scheduled_7c78e583-accb-46dd-a4e5-1532f14d5d4d', 'TASK_FAILED', {
            error: 'scheduled interrupted',
            recoverable: true,
            suggestion: 'retry',
        }));

        const sessions = useTaskEventStore.getState().sessions;
        sessions.get('330f06be-1f4e-4e3a-976c-89cb29c9a9d4')!.workspacePath = 'D:\\workspace\\valid';
        sessions.get('330f06be-1f4e-4e3a-976c-89cb29c9a9d4')!.summary = 'Task interrupted by app restart';
        sessions.get('330f06be-1f4e-4e3a-976c-89cb29c9a9d4')!.status = 'failed';
        sessions.get('scheduled_7c78e583-accb-46dd-a4e5-1532f14d5d4d')!.workspacePath = 'D:\\workspace\\scheduled';
        sessions.get('scheduled_7c78e583-accb-46dd-a4e5-1532f14d5d4d')!.summary = 'Task interrupted by app restart';
        sessions.get('scheduled_7c78e583-accb-46dd-a4e5-1532f14d5d4d')!.status = 'failed';

        expect(buildRecoverableTaskHints('startup')).toEqual([
            {
                taskId: '330f06be-1f4e-4e3a-976c-89cb29c9a9d4',
                workspacePath: 'D:\\workspace\\valid',
            },
        ]);
    });
});
