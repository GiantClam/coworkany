import { describe, expect, test } from 'bun:test';
import { buildTimelineItems } from '../src/components/Chat/Timeline/hooks/useTimelineItems';
import type { TaskEvent, TaskSession } from '../src/types';

function makeEvent(overrides: Partial<TaskEvent>): TaskEvent {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        taskId: overrides.taskId ?? 'task-1',
        sequence: overrides.sequence ?? 1,
        type: overrides.type ?? 'TASK_PLAN_READY',
        timestamp: overrides.timestamp ?? new Date().toISOString(),
        payload: overrides.payload ?? {},
    };
}

function makeSession(overrides: Partial<TaskSession> = {}): TaskSession {
    const now = new Date().toISOString();
    return {
        taskId: overrides.taskId ?? 'task-1',
        status: overrides.status ?? 'idle',
        planSteps: overrides.planSteps ?? [],
        toolCalls: overrides.toolCalls ?? [],
        effects: overrides.effects ?? [],
        patches: overrides.patches ?? [],
        messages: overrides.messages ?? [],
        events: overrides.events ?? [],
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
        summary: overrides.summary,
        title: overrides.title,
        workspacePath: overrides.workspacePath,
    };
}

function explicitTaskIntentRouting() {
    return {
        intent: 'immediate_task',
        confidence: 0.99,
        reasonCodes: ['user_route_choice'],
        needsDisambiguation: false,
        forcedByUserSelection: true,
    } as const;
}

describe('buildTimelineItems', () => {
    test('merges task update events into a single task card message', () => {
        const session = makeSession({
            status: 'idle',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Initial explicit task plan.',
                        mode: 'immediate_task',
                        intentRouting: explicitTaskIntentRouting(),
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        missingInfo: [],
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TASK_CONTRACT_REOPENED',
                    payload: {
                        summary: 'User follow-up introduced a new task scope: deliverables changed.',
                        reason: 'User follow-up introduced a new task scope: deliverables or output targets changed.',
                        trigger: 'new_scope_signal',
                        diff: {
                            changedFields: ['deliverables', 'execution_targets'],
                        },
                    },
                }),
                makeEvent({
                    sequence: 3,
                    type: 'TASK_RESEARCH_UPDATED',
                    payload: {
                        summary: 'Research updated after reopen: 3/3 queries processed.',
                        sourcesChecked: ['conversation', 'workspace'],
                        completedQueries: 3,
                        pendingQueries: 0,
                        blockingUnknowns: [],
                    },
                }),
                makeEvent({
                    sequence: 4,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Replanned contract now saves a PDF artifact.',
                        intentRouting: explicitTaskIntentRouting(),
                    },
                }),
                makeEvent({
                    sequence: 5,
                    type: 'TASK_USER_ACTION_REQUIRED',
                    payload: {
                        actionId: 'action-new',
                        title: 'Grant PDF export access',
                        kind: 'manual_step',
                        description: 'Allow Coworkany to continue the PDF export.',
                        blocking: true,
                        questions: [],
                        instructions: ['Grant filesystem access, then continue.'],
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const taskCards = result.items
            .filter((item) => item.type === 'task_card')
            .map((item) => item);

        expect(taskCards).toHaveLength(1);
        expect(taskCards[0]?.title).toBe('Task center');
        expect(taskCards[0]?.subtitle).toBe('Allow Coworkany to continue the PDF export.');
        expect(taskCards[0]?.sections.some((section) => section.label === 'Contract · Changed fields')).toBe(true);
        expect(taskCards[0]?.sections.some((section) => section.label === 'Research · Sources checked')).toBe(true);
        expect(taskCards[0]?.sections.some((section) => section.label === 'Action · Instructions')).toBe(true);
        expect(taskCards[0]?.collaboration?.input?.submitLabel).toBe('Submit and continue');
    });

    test('respects recent-event truncation while reporting hidden count', () => {
        const session = makeSession({
            status: 'idle',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_CONTRACT_REOPENED',
                    payload: {
                        summary: 'Contract reopened.',
                        reason: 'Old reason.',
                        trigger: 'execution_infeasible',
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TASK_RESEARCH_UPDATED',
                    payload: {
                        summary: 'Research updated.',
                        sourcesChecked: ['conversation'],
                        completedQueries: 1,
                        pendingQueries: 0,
                        blockingUnknowns: [],
                    },
                }),
                makeEvent({
                    sequence: 3,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Plan ready.',
                        intentRouting: explicitTaskIntentRouting(),
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session, 2);

        expect(result.hiddenEventCount).toBe(1);
        expect(result.items).toHaveLength(1);
        expect(result.items[0]?.type).toBe('task_card');
    });

    test('stores task result in task center card when task finishes', () => {
        const session = makeSession({
            status: 'finished',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Plan ready.',
                        intentRouting: explicitTaskIntentRouting(),
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        missingInfo: [],
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'CHAT_MESSAGE',
                    payload: {
                        role: 'user',
                        content: '从 skillhub 中安装 skill-vetter',
                    },
                }),
                makeEvent({
                    sequence: 3,
                    type: 'TOOL_RESULT',
                    payload: {
                        toolId: 'tool-1',
                        success: false,
                        error: 'temporary fallback',
                    },
                }),
                makeEvent({
                    sequence: 4,
                    type: 'TASK_FINISHED',
                    payload: {
                        summary: '已从 skillhub 安装并启用技能 `skill-vetter`。',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const taskCards = result.items
            .filter((item) => item.type === 'task_card')
            .map((item) => item);

        expect(taskCards).toHaveLength(1);
        expect(taskCards[0]?.result?.summary).toBe('已从 skillhub 安装并启用技能 `skill-vetter`。');
        expect(taskCards[0]?.sections.some((section) => section.label === 'Result · Summary')).toBe(true);
    });

    test('renders multi-task sequential workflow and task progress in task card', () => {
        const session = makeSession({
            status: 'running',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Plan with staged tasks.',
                        intentRouting: explicitTaskIntentRouting(),
                        tasks: [
                            {
                                id: 'task-a',
                                title: 'Collect data',
                                objective: 'Collect required source data.',
                                dependencies: [],
                            },
                            {
                                id: 'task-b',
                                title: 'Generate report',
                                objective: 'Generate final report.',
                                dependencies: ['task-a'],
                            },
                        ],
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        missingInfo: [],
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'PLAN_UPDATED',
                    payload: {
                        summary: 'Execution is running.',
                        steps: [],
                        taskProgress: [
                            {
                                taskId: 'task-a',
                                title: 'Collect data',
                                status: 'completed',
                                dependencies: [],
                            },
                            {
                                taskId: 'task-b',
                                title: 'Generate report',
                                status: 'in_progress',
                                dependencies: ['task-a'],
                            },
                        ],
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const taskCards = result.items
            .filter((item) => item.type === 'task_card')
            .map((item) => item);

        expect(taskCards).toHaveLength(1);
        expect(taskCards[0]?.workflow).toBe('sequential');
        expect(taskCards[0]?.tasks?.[0]?.status).toBe('completed');
        expect(taskCards[0]?.tasks?.[1]?.status).toBe('in_progress');
    });

    test('keeps chat-mode conversations in message timeline without task card', () => {
        const session = makeSession({
            status: 'finished',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Chat mode plan.',
                        mode: 'chat',
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        missingInfo: [],
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TEXT_DELTA',
                    payload: {
                        role: 'assistant',
                        delta: '你好，',
                    },
                }),
                makeEvent({
                    sequence: 3,
                    type: 'TEXT_DELTA',
                    payload: {
                        role: 'assistant',
                        delta: '今天需要我帮你做什么？',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const taskCards = result.items.filter((item) => item.type === 'task_card');
        const assistantMessages = result.items
            .filter((item) => item.type === 'assistant_message')
            .map((item) => item.content);

        expect(taskCards).toHaveLength(0);
        expect(assistantMessages).toEqual(['你好，今天需要我帮你做什么？']);
    });

    test('deduplicates task finished summary when it matches streamed assistant draft in chat mode', () => {
        const session = makeSession({
            status: 'finished',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Chat mode plan.',
                        mode: 'chat',
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TEXT_DELTA',
                    payload: {
                        role: 'assistant',
                        delta: '你好呀！',
                    },
                }),
                makeEvent({
                    sequence: 3,
                    type: 'TEXT_DELTA',
                    payload: {
                        role: 'assistant',
                        delta: ' 今天想聊点什么？',
                    },
                }),
                makeEvent({
                    sequence: 4,
                    type: 'TASK_FINISHED',
                    payload: {
                        summary: '你好呀！ 今天想聊点什么？',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const assistantMessages = result.items
            .filter((item) => item.type === 'assistant_message')
            .map((item) => item.content);

        expect(assistantMessages).toEqual(['你好呀！ 今天想聊点什么？']);
    });

    test('deduplicates task finished summary when assistant chat message already exists in chat mode', () => {
        const session = makeSession({
            status: 'finished',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Chat mode plan.',
                        mode: 'chat',
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'CHAT_MESSAGE',
                    payload: {
                        role: 'assistant',
                        content: '你好！很高兴见到你。',
                    },
                }),
                makeEvent({
                    sequence: 3,
                    type: 'TASK_FINISHED',
                    payload: {
                        summary: '你好！很高兴见到你。',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const assistantMessages = result.items
            .filter((item) => item.type === 'assistant_message')
            .map((item) => item.content);

        expect(assistantMessages).toEqual(['你好！很高兴见到你。']);
    });

    test('normalizes routed TASK_STARTED source text to original user query', () => {
        const session = makeSession({
            status: 'running',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_STARTED',
                    payload: {
                        context: {
                            userQuery: '原始任务：帮我写一段产品文案\n用户路由：chat',
                        },
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const userMessages = result.items
            .filter((item) => item.type === 'user_message')
            .map((item) => item.content);

        expect(userMessages).toEqual(['帮我写一段产品文案']);
    });

    test('does not render task card for inferred task mode without explicit create intent', () => {
        const session = makeSession({
            status: 'running',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Inferred immediate task plan.',
                        mode: 'immediate_task',
                        intentRouting: {
                            intent: 'immediate_task',
                            confidence: 0.84,
                            reasonCodes: ['multi_step_cue'],
                            needsDisambiguation: false,
                        },
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        missingInfo: [],
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'CHAT_MESSAGE',
                    payload: {
                        role: 'assistant',
                        content: '我先直接回答你的问题。',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const taskCards = result.items.filter((item) => item.type === 'task_card');
        const assistantMessages = result.items
            .filter((item) => item.type === 'assistant_message')
            .map((item) => item.content);

        expect(taskCards).toHaveLength(0);
        expect(assistantMessages).toContain('我先直接回答你的问题。');
    });

    test('does not render task status updates as chat system events', () => {
        const session = makeSession({
            status: 'running',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_STATUS',
                    payload: { status: 'running' },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TASK_STATUS',
                    payload: { status: 'idle' },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const systemContents = result.items
            .filter((item) => item.type === 'system_event')
            .map((item) => item.content);

        expect(systemContents).toEqual([]);
    });

    test('renders task failures as concise system feedback', () => {
        const session = makeSession({
            status: 'failed',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_STATUS',
                    payload: { status: 'running' },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TASK_FAILED',
                    payload: { error: 'fetch failed' },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const systemContents = result.items
            .filter((item) => item.type === 'system_event')
            .map((item) => item.content);

        expect(systemContents).toEqual(['Task failed: fetch failed']);
    });

    test('suppresses runtime control notices inside task context cards', () => {
        const session = makeSession({
            status: 'running',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Task-mode plan.',
                        mode: 'immediate_task',
                        intentRouting: explicitTaskIntentRouting(),
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        missingInfo: [],
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'CHAT_MESSAGE',
                    payload: {
                        role: 'system',
                        content: '[RESUMED] durationMs=48799; reason=User provided follow-up input',
                    },
                }),
                makeEvent({
                    sequence: 3,
                    type: 'CHAT_MESSAGE',
                    payload: {
                        role: 'system',
                        content: 'Status updated: in progress',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const taskCard = result.items.find((item) => item.type === 'task_card');
        expect(taskCard?.type).toBe('task_card');
        expect(taskCard?.sections.some((section) => section.label === 'Process · System updates')).toBe(false);
    });

    test('renders route disambiguation clarification as choice buttons in task card', () => {
        const session = makeSession({
            status: 'idle',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Plan pending route selection.',
                        mode: 'immediate_task',
                        intentRouting: explicitTaskIntentRouting(),
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        missingInfo: [],
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TASK_CLARIFICATION_REQUIRED',
                    payload: {
                        reason: '需要先确认你希望走“直接回答”还是“创建任务”路径。',
                        questions: ['请选择：直接回答，或创建任务。'],
                        missingFields: ['intent_route'],
                        clarificationType: 'route_disambiguation',
                        routeChoices: [
                            { id: 'chat', label: '直接回答', value: '__route_chat__' },
                            { id: 'immediate_task', label: '创建任务', value: '__route_task__' },
                        ],
                        intentRouting: explicitTaskIntentRouting(),
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const taskCards = result.items
            .filter((item) => item.type === 'task_card')
            .map((item) => item);

        expect(taskCards).toHaveLength(1);
        expect(taskCards[0]?.collaboration?.choices).toEqual([
            { label: '直接回答', value: '__route_chat__' },
            { label: '创建任务', value: '__route_task__' },
        ]);
        expect(taskCards[0]?.collaboration?.input).toBeUndefined();
    });

    test('renders task draft confirmation as collaboration choices with optional edit input', () => {
        const session = makeSession({
            status: 'idle',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Task draft is ready for confirmation.',
                        mode: 'immediate_task',
                        taskDraftRequired: true,
                        intentRouting: explicitTaskIntentRouting(),
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        missingInfo: [],
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TASK_CLARIFICATION_REQUIRED',
                    payload: {
                        reason: '任务草稿已生成，请先确认是否创建执行任务。',
                        questions: ['确认创建任务，或改成普通回答。'],
                        missingFields: ['task_draft_confirmation'],
                        clarificationType: 'task_draft_confirmation',
                        routeChoices: [
                            { id: 'immediate_task', label: '确认创建', value: '__task_draft_confirm__' },
                            { id: 'chat', label: '改成普通回答', value: '__task_draft_chat__' },
                        ],
                        intentRouting: explicitTaskIntentRouting(),
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const taskCards = result.items
            .filter((item) => item.type === 'task_card')
            .map((item) => item);

        expect(taskCards).toHaveLength(1);
        expect(taskCards[0]?.collaboration?.actionId).toBe('task_draft_confirm');
        expect(taskCards[0]?.collaboration?.choices).toEqual([
            { label: '确认创建', value: '__task_draft_confirm__' },
            { label: '改成普通回答', value: '__task_draft_chat__' },
        ]);
        expect(taskCards[0]?.collaboration?.input).toEqual({
            placeholder: '输入修改后的任务说明（可选）',
            submitLabel: '编辑后创建',
        });
    });
});
