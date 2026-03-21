import { afterEach, describe, expect, test } from 'bun:test';
import { useTaskEventStore } from '../src/stores/taskEvents';
import type { TaskEvent } from '../src/types';

function makeEvent(overrides: Partial<TaskEvent>): TaskEvent {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        taskId: overrides.taskId ?? 'task-1',
        sequence: overrides.sequence ?? 1,
        type: overrides.type ?? 'CHAT_MESSAGE',
        timestamp: overrides.timestamp ?? new Date().toISOString(),
        payload: overrides.payload ?? {},
    };
}

afterEach(() => {
    useTaskEventStore.getState().reset();
});

describe('task session follow-up behavior', () => {
    test('updates the session title from the latest user follow-up', () => {
        useTaskEventStore.getState().ensureSession('task-1', {
            title: '[Scheduled] Old task title',
            status: 'finished',
        });

        useTaskEventStore.getState().addEvent(makeEvent({
            type: 'CHAT_MESSAGE',
            payload: {
                role: 'user',
                content: '从 skillhub 中安装 skill-vetter',
            },
        }));

        const session = useTaskEventStore.getState().getSession('task-1');

        expect(session?.title).toBe('从 skillhub 中安装 skill-vetter');
        expect(session?.messages.at(-1)?.content).toBe('从 skillhub 中安装 skill-vetter');
    });

    test('appends a final assistant message when completion arrives without one', () => {
        useTaskEventStore.getState().ensureSession('task-1', {
            title: 'Install skill',
            status: 'running',
        });

        useTaskEventStore.getState().addEvents([
            makeEvent({
                sequence: 1,
                type: 'CHAT_MESSAGE',
                payload: {
                    role: 'user',
                    content: '从 skillhub 中安装 skill-vetter',
                },
            }),
            makeEvent({
                sequence: 2,
                type: 'TASK_FINISHED',
                payload: {
                    summary: '已从 skillhub 安装并启用技能 `skill-vetter`。',
                },
            }),
        ]);

        const session = useTaskEventStore.getState().getSession('task-1');

        expect(session?.status).toBe('finished');
        expect(session?.messages.at(-1)?.role).toBe('assistant');
        expect(session?.messages.at(-1)?.content).toBe('已从 skillhub 安装并启用技能 `skill-vetter`。');
    });

    test('does not duplicate the final assistant message when streaming already produced it', () => {
        useTaskEventStore.getState().ensureSession('task-1', {
            title: 'Install skill',
            status: 'running',
        });

        useTaskEventStore.getState().addEvents([
            makeEvent({
                sequence: 1,
                type: 'CHAT_MESSAGE',
                payload: {
                    role: 'user',
                    content: '从 skillhub 中安装 skill-vetter',
                },
            }),
            makeEvent({
                sequence: 2,
                type: 'CHAT_MESSAGE',
                payload: {
                    role: 'assistant',
                    content: '已从 skillhub 安装并启用技能 `skill-vetter`。',
                },
            }),
            makeEvent({
                sequence: 3,
                type: 'TASK_FINISHED',
                payload: {
                    summary: '已从 skillhub 安装并启用技能 `skill-vetter`。',
                },
            }),
        ]);

        const session = useTaskEventStore.getState().getSession('task-1');
        const matchingAssistantMessages = session?.messages.filter((message) =>
            message.role === 'assistant' &&
            message.content === '已从 skillhub 安装并启用技能 `skill-vetter`。'
        ) ?? [];

        expect(matchingAssistantMessages).toHaveLength(1);
    });
});
