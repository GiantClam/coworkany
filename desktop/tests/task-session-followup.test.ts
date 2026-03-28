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
    test('stores displayText instead of routed analysis text when the task starts', () => {
        useTaskEventStore.getState().ensureSession('task-1', {
            title: 'Shutdown task',
            status: 'running',
        });

        useTaskEventStore.getState().addEvent(makeEvent({
            type: 'TASK_STARTED',
            payload: {
                title: '早上 3 点关机',
                context: {
                    userQuery: '原始任务：早上 3 点关机\n用户路由：chat',
                    displayText: '早上 3 点关机',
                },
            },
        }));

        const session = useTaskEventStore.getState().getSession('task-1');

        expect(session?.messages.at(-1)?.role).toBe('user');
        expect(session?.messages.at(-1)?.content).toBe('早上 3 点关机');
    });

    test('replaces optimistic local user echo when the confirmed chat message arrives', () => {
        useTaskEventStore.getState().ensureSession('task-1', {
            title: 'Echo task',
            status: 'running',
        });

        useTaskEventStore.getState().addEvents([
            makeEvent({
                id: 'local-echo',
                sequence: 1,
                type: 'CHAT_MESSAGE',
                payload: {
                    role: 'user',
                    content: '马上回显这条消息',
                    __localEcho: true,
                },
            }),
            makeEvent({
                id: 'server-echo',
                sequence: 2,
                type: 'CHAT_MESSAGE',
                payload: {
                    role: 'user',
                    content: '马上回显这条消息',
                },
            }),
        ]);

        const session = useTaskEventStore.getState().getSession('task-1');
        const userMessages = session?.messages.filter((message) => message.role === 'user') ?? [];

        expect(userMessages).toHaveLength(1);
        expect(userMessages[0]?.id).toBe('server-echo');
        expect(session?.events.some((event) => event.id === 'local-echo')).toBe(false);
    });

    test('replaces optimistic draft echo when TASK_STARTED confirms the first user message', () => {
        useTaskEventStore.getState().ensureSession('task-1', {
            title: 'Draft task',
            status: 'idle',
            isDraft: true,
        });

        useTaskEventStore.getState().addEvents([
            makeEvent({
                id: 'local-draft-echo',
                sequence: 1,
                type: 'CHAT_MESSAGE',
                payload: {
                    role: 'user',
                    content: '创建一条首发消息',
                    __localEcho: true,
                },
            }),
            makeEvent({
                id: 'task-started',
                sequence: 2,
                type: 'TASK_STARTED',
                payload: {
                    title: '创建一条首发消息',
                    context: {
                        userQuery: '原始任务：创建一条首发消息\n用户路由：chat',
                        displayText: '创建一条首发消息',
                    },
                },
            }),
        ]);

        const session = useTaskEventStore.getState().getSession('task-1');
        const userMessages = session?.messages.filter((message) => message.role === 'user') ?? [];

        expect(userMessages).toHaveLength(1);
        expect(userMessages[0]?.id).toBe('task-started');
        expect(session?.events.some((event) => event.id === 'local-draft-echo')).toBe(false);
    });

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

    test('stores final summary without appending a duplicate assistant message', () => {
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
        expect(session?.summary).toBe('已从 skillhub 安装并启用技能 `skill-vetter`。');
        expect(session?.messages).toEqual([
            expect.objectContaining({
                role: 'user',
                content: '从 skillhub 中安装 skill-vetter',
            }),
        ]);
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

    test('ignores events that do not include a valid taskId', () => {
        useTaskEventStore.getState().addEvents([
            makeEvent({
                id: 'bad-task-id-event',
                taskId: '' as unknown as string,
                payload: { role: 'user', content: 'ignored event' },
            }),
        ]);

        const state = useTaskEventStore.getState();
        expect(state.sessions.size).toBe(0);
        expect(state.activeTaskId).toBeNull();
    });
});
