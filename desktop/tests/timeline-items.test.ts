import { describe, expect, test } from 'bun:test';
import { buildTimelineItems } from '../src/components/Chat/Timeline/hooks/useTimelineItems';
import type { AssistantTurnItem, TaskCardItem, TaskEvent, TaskSession, TimelineItemType } from '../src/types';
import type { CanonicalTaskMessage } from '../../sidecar/src/protocol';

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
        taskMode: overrides.taskMode,
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
        lastResumeReason: overrides.lastResumeReason,
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

function extractAssistantTurns(items: TimelineItemType[]): AssistantTurnItem[] {
    return items
        .filter((item): item is AssistantTurnItem => item.type === 'assistant_turn');
}

function extractTaskCards(items: TimelineItemType[]): TaskCardItem[] {
    const fromStandalone = items
        .filter((item): item is TaskCardItem => item.type === 'task_card');
    const fromTurns = extractAssistantTurns(items)
        .map((turn) => turn.taskCard)
        .filter((card): card is TaskCardItem => Boolean(card));
    return [...fromStandalone, ...fromTurns];
}

function extractAssistantMessages(items: TimelineItemType[]): string[] {
    const standalone = items
        .filter((item): item is Extract<TimelineItemType, { type: 'assistant_message' }> => item.type === 'assistant_message')
        .map((item) => item.content);
    const turnMessages = extractAssistantTurns(items)
        .flatMap((turn) => turn.messages);
    return [...standalone, ...turnMessages];
}

function firstAssistantTurn(items: TimelineItemType[]): AssistantTurnItem | undefined {
    return extractAssistantTurns(items)[0];
}

function makeCanonicalMessage(overrides: Partial<CanonicalTaskMessage> & Pick<CanonicalTaskMessage, 'id' | 'taskId' | 'role' | 'timestamp' | 'sequence' | 'sourceEventId' | 'sourceEventType' | 'parts'>): CanonicalTaskMessage {
    return {
        status: overrides.status ?? 'complete',
        ...overrides,
    };
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
        const turns = extractAssistantTurns(result.items);
        const taskCards = extractTaskCards(result.items);

        expect(turns).toHaveLength(1);
        expect(taskCards).toHaveLength(1);
        expect(taskCards[0]?.title).toBe('Task center');
        expect(taskCards[0]?.subtitle).toBe('Allow Coworkany to continue the PDF export.');
        expect(turns[0]?.steps.some((step) => step.title === 'Task plan')).toBe(true);
        expect(turns[0]?.steps.some((step) => step.title === 'Execute')).toBe(true);
        expect(taskCards[0]?.collaboration?.input?.submitLabel).toBe('Submit and continue');
    });

    test('renders external auth user action with open-login and continue choices', () => {
        const session = makeSession({
            status: 'idle',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Need user login before publishing.',
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
                    type: 'TASK_USER_ACTION_REQUIRED',
                    payload: {
                        actionId: 'auth-login',
                        title: 'Login required',
                        kind: 'external_auth',
                        description: 'Please login to continue publishing.',
                        blocking: true,
                        questions: [],
                        instructions: ['Complete login in browser.'],
                        authUrl: 'https://x.com/i/flow/login',
                        authDomain: 'x.com',
                        canAutoResume: true,
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const taskCards = extractTaskCards(result.items);
        const collaboration = taskCards[0]?.collaboration;

        expect(taskCards).toHaveLength(1);
        expect(collaboration?.input).toBeUndefined();
        expect(collaboration?.action).toBeUndefined();
        expect(collaboration?.choices).toEqual([
            { label: '打开登录页面', value: '__auth_open_page__:https://x.com/i/flow/login' },
            { label: '我已登录，继续执行', value: '继续执行' },
        ]);
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
        expect(result.items[0]?.type).toBe('assistant_turn');
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
        const turns = extractAssistantTurns(result.items);
        const taskCards = extractTaskCards(result.items);

        expect(taskCards).toHaveLength(1);
        expect(taskCards[0]?.result?.summary).toBe('已从 skillhub 安装并启用技能 `skill-vetter`。');
        expect(turns[0]?.steps.some((step) => step.title === 'Summary')).toBe(true);
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
        const taskCards = extractTaskCards(result.items);

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
        const taskCards = extractTaskCards(result.items);
        const assistantMessages = extractAssistantMessages(result.items);
        const turns = extractAssistantTurns(result.items);

        expect(taskCards).toHaveLength(0);
        expect(turns).toHaveLength(1);
        expect(assistantMessages).toEqual(['你好，今天需要我帮你做什么？']);
    });

    test('prefers canonical chat messages when chat-mode canonical stream is available', () => {
        const session = makeSession({
            status: 'finished',
            taskMode: 'chat',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'CHAT_MESSAGE',
                    payload: {
                        role: 'assistant',
                        content: 'legacy',
                    },
                }),
            ],
        });
        const canonicalMessages: CanonicalTaskMessage[] = [
            makeCanonicalMessage({
                id: 'canonical-user',
                taskId: session.taskId,
                role: 'user',
                timestamp: '2026-03-27T10:00:00.000Z',
                sequence: 1,
                sourceEventId: 'canonical-user',
                sourceEventType: 'CHAT_MESSAGE',
                parts: [{ type: 'text', text: '你好' }],
            }),
            makeCanonicalMessage({
                id: 'canonical-assistant',
                taskId: session.taskId,
                role: 'assistant',
                timestamp: '2026-03-27T10:00:01.000Z',
                sequence: 2,
                sourceEventId: 'canonical-assistant',
                sourceEventType: 'CHAT_MESSAGE',
                parts: [{ type: 'text', text: '这是 canonical 回复。' }],
            }),
        ];

        const result = buildTimelineItems(session, undefined, canonicalMessages);
        const assistantMessages = extractAssistantMessages(result.items);

        expect(result.items[0]).toMatchObject({
            type: 'user_message',
            content: '你好',
        });
        expect(assistantMessages).toEqual(['这是 canonical 回复。']);
    });

    test('maps canonical tool/effect/patch parts into assistant turn UI fields', () => {
        const session = makeSession({
            status: 'finished',
            taskMode: 'chat',
        });
        const canonicalMessages: CanonicalTaskMessage[] = [
            makeCanonicalMessage({
                id: 'tool-call',
                taskId: session.taskId,
                role: 'runtime',
                timestamp: '2026-03-27T10:00:00.000Z',
                sequence: 1,
                sourceEventId: 'tool-call',
                sourceEventType: 'TOOL_CALLED',
                parts: [{ type: 'tool-call', toolId: 'tool-1', toolName: 'search_web', input: { q: 'coworkany' } }],
            }),
            makeCanonicalMessage({
                id: 'tool-result',
                taskId: session.taskId,
                role: 'runtime',
                timestamp: '2026-03-27T10:00:01.000Z',
                sequence: 2,
                sourceEventId: 'tool-result',
                sourceEventType: 'TOOL_RESULT',
                parts: [{ type: 'tool-result', toolId: 'tool-1', success: true, resultSummary: 'Found 3 docs', result: { total: 3 } }],
            }),
            makeCanonicalMessage({
                id: 'effect-request',
                taskId: session.taskId,
                role: 'runtime',
                timestamp: '2026-03-27T10:00:02.000Z',
                sequence: 3,
                sourceEventId: 'effect-request',
                sourceEventType: 'EFFECT_REQUESTED',
                parts: [{ type: 'effect', requestId: 'effect-1', effectType: 'open_url', status: 'requested', riskLevel: 2 }],
            }),
            makeCanonicalMessage({
                id: 'effect-approved',
                taskId: session.taskId,
                role: 'runtime',
                timestamp: '2026-03-27T10:00:03.000Z',
                sequence: 4,
                sourceEventId: 'effect-approved',
                sourceEventType: 'EFFECT_APPROVED',
                parts: [{ type: 'effect', requestId: 'effect-1', effectType: 'open_url', status: 'approved' }],
            }),
            makeCanonicalMessage({
                id: 'patch-proposed',
                taskId: session.taskId,
                role: 'runtime',
                timestamp: '2026-03-27T10:00:04.000Z',
                sequence: 5,
                sourceEventId: 'patch-proposed',
                sourceEventType: 'PATCH_PROPOSED',
                parts: [{ type: 'patch', patchId: 'patch-1', filePath: '/tmp/demo.ts', status: 'proposed' }],
            }),
            makeCanonicalMessage({
                id: 'patch-applied',
                taskId: session.taskId,
                role: 'runtime',
                timestamp: '2026-03-27T10:00:05.000Z',
                sequence: 6,
                sourceEventId: 'patch-applied',
                sourceEventType: 'PATCH_APPLIED',
                parts: [{ type: 'patch', patchId: 'patch-1', filePath: '/tmp/demo.ts', status: 'applied' }],
            }),
            makeCanonicalMessage({
                id: 'assistant-final',
                taskId: session.taskId,
                role: 'assistant',
                timestamp: '2026-03-27T10:00:06.000Z',
                sequence: 7,
                sourceEventId: 'assistant-final',
                sourceEventType: 'CHAT_MESSAGE',
                parts: [{ type: 'text', text: '处理完成。' }],
            }),
        ];

        const result = buildTimelineItems(session, undefined, canonicalMessages);
        const turn = firstAssistantTurn(result.items);

        expect(turn?.messages).toEqual(['处理完成。']);
        expect(turn?.toolCalls).toEqual([
            expect.objectContaining({
                id: 'tool-1',
                toolName: 'search_web',
                status: 'success',
                args: { q: 'coworkany' },
                result: { total: 3 },
            }),
        ]);
        expect(turn?.effectRequests).toEqual([
            expect.objectContaining({
                id: 'effect-1',
                effectType: 'open_url',
                risk: 2,
                approved: true,
            }),
        ]);
        expect(turn?.patches).toEqual([
            expect.objectContaining({
                id: 'patch-1',
                filePath: '/tmp/demo.ts',
                status: 'applied',
            }),
        ]);
    });

    test('renders canonical task center content from task and finish parts', () => {
        const session = makeSession({
            status: 'idle',
            taskMode: 'chat',
        });
        const canonicalMessages: CanonicalTaskMessage[] = [
            makeCanonicalMessage({
                id: 'canonical-plan',
                taskId: session.taskId,
                role: 'assistant',
                timestamp: '2026-03-27T10:00:00.000Z',
                sequence: 1,
                sourceEventId: 'canonical-plan',
                sourceEventType: 'TASK_PLAN_READY',
                parts: [{
                    type: 'task',
                    event: 'plan_ready',
                    summary: '准备执行登录和发布流程。',
                    data: {
                        mode: 'immediate_task',
                        intentRouting: {
                            intent: 'immediate_task',
                            confidence: 0.99,
                            reasonCodes: ['user_route_choice'],
                            needsDisambiguation: false,
                            forcedByUserSelection: true,
                        },
                        tasks: [
                            {
                                id: 'task-login',
                                title: '完成登录',
                                objective: '登录目标平台',
                                dependencies: [],
                            },
                        ],
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        capabilityReview: {
                            status: 'pending',
                            summary: 'Generated capability requires review before execution can resume.',
                        },
                        missingInfo: [],
                    },
                }],
            }),
            makeCanonicalMessage({
                id: 'canonical-collaboration',
                taskId: session.taskId,
                role: 'assistant',
                timestamp: '2026-03-27T10:00:01.000Z',
                sequence: 2,
                sourceEventId: 'canonical-task-progress',
                sourceEventType: 'TASK_CHECKPOINT_REACHED',
                parts: [{
                    type: 'task',
                    event: 'checkpoint_reached',
                    title: 'Login required',
                    summary: 'Please login to continue publishing.',
                }],
            }),
            makeCanonicalMessage({
                id: 'canonical-finish',
                taskId: session.taskId,
                role: 'assistant',
                timestamp: '2026-03-27T10:00:02.000Z',
                sequence: 3,
                sourceEventId: 'canonical-finish',
                sourceEventType: 'TASK_FINISHED',
                parts: [
                    {
                        type: 'finish',
                        summary: '发布完成。',
                        artifacts: [],
                        files: [],
                    },
                    {
                        type: 'text',
                        text: '发布完成。',
                    },
                ],
            }),
        ];

        const result = buildTimelineItems(session, undefined, canonicalMessages);
        const turn = firstAssistantTurn(result.items);
        const taskCards = extractTaskCards(result.items);

        expect(turn?.messages).toEqual(['发布完成。']);
        expect(taskCards).toHaveLength(1);
        expect(taskCards[0]).toMatchObject({
            title: 'Task center',
            subtitle: 'Please login to continue publishing.',
            status: 'finished',
            sections: expect.arrayContaining([
                {
                    label: 'Plan',
                    lines: expect.arrayContaining([
                        'Generated capability requires review before execution can resume.',
                    ]),
                },
            ]),
            tasks: [
                expect.objectContaining({
                    id: 'task-login',
                    status: 'completed',
                }),
            ],
            result: {
                summary: '发布完成。',
            },
        });
    });

    test('renders canonical collaboration parts as task center interaction state', () => {
        const session = makeSession({
            status: 'running',
            taskMode: 'chat',
        });
        const canonicalMessages: CanonicalTaskMessage[] = [
            makeCanonicalMessage({
                id: 'canonical-plan',
                taskId: session.taskId,
                role: 'assistant',
                timestamp: '2026-03-27T10:00:00.000Z',
                sequence: 1,
                sourceEventId: 'canonical-plan',
                sourceEventType: 'TASK_PLAN_READY',
                parts: [{
                    type: 'task',
                    event: 'plan_ready',
                    summary: '准备执行登录和发布流程。',
                    data: {
                        mode: 'immediate_task',
                        intentRouting: {
                            intent: 'immediate_task',
                            confidence: 0.99,
                            reasonCodes: ['user_route_choice'],
                            needsDisambiguation: false,
                            forcedByUserSelection: true,
                        },
                        tasks: [],
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        missingInfo: [],
                    },
                }],
            }),
            makeCanonicalMessage({
                id: 'canonical-collaboration',
                taskId: session.taskId,
                role: 'assistant',
                timestamp: '2026-03-27T10:00:01.000Z',
                sequence: 2,
                sourceEventId: 'canonical-collaboration',
                sourceEventType: 'TASK_USER_ACTION_REQUIRED',
                parts: [{
                    type: 'collaboration',
                    kind: 'external_auth',
                    actionId: 'auth-login',
                    title: 'Login required',
                    description: 'Please login to continue publishing.',
                    blocking: true,
                    questions: [],
                    instructions: ['登录完成后将自动继续执行。'],
                    choices: [
                        { label: '打开登录页面', value: '__auth_open_page__:https://x.com/i/flow/login' },
                        { label: '我已登录，继续执行', value: '继续执行' },
                    ],
                }],
            }),
        ];

        const result = buildTimelineItems(session, undefined, canonicalMessages);
        const taskCards = extractTaskCards(result.items);

        expect(taskCards).toHaveLength(1);
        expect(taskCards[0]).toMatchObject({
            title: 'Task center',
            subtitle: 'Please login to continue publishing.',
            status: 'running',
            collaboration: {
                actionId: 'auth-login',
                title: 'Login required',
                choices: [
                    { label: '打开登录页面', value: '__auth_open_page__:https://x.com/i/flow/login' },
                    { label: '我已登录，继续执行', value: '继续执行' },
                ],
            },
        });
    });

    test('projects pending capability review from canonical plan-ready data into task card summary', () => {
        const session = makeSession({
            status: 'idle',
            taskMode: 'chat',
        });
        const canonicalMessages: CanonicalTaskMessage[] = [
            makeCanonicalMessage({
                id: 'canonical-plan-review',
                taskId: session.taskId,
                role: 'assistant',
                timestamp: '2026-03-28T10:00:00.000Z',
                sequence: 1,
                sourceEventId: 'canonical-plan-review',
                sourceEventType: 'TASK_PLAN_READY',
                parts: [{
                    type: 'task',
                    event: 'plan_ready',
                    summary: '准备执行发布流程。',
                    data: {
                        mode: 'immediate_task',
                        intentRouting: {
                            intent: 'immediate_task',
                            confidence: 0.99,
                            reasonCodes: ['user_route_choice'],
                            needsDisambiguation: false,
                            forcedByUserSelection: true,
                        },
                        tasks: [],
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        executionProfile: {
                            primaryHardness: 'high_risk',
                            requiredCapabilities: ['workspace_write', 'human_review'],
                            blockingRisk: 'policy_review',
                            interactionMode: 'review_first',
                            executionShape: 'staged',
                            reasons: ['Generated capability must be reviewed before use.'],
                        },
                        capabilityPlan: {
                            missingCapability: 'new_runtime_tool_needed',
                            learningRequired: true,
                            canProceedWithoutLearning: false,
                            learningScope: 'runtime_tool',
                            replayStrategy: 'resume_from_checkpoint',
                            sideEffectRisk: 'write_external',
                            userAssistRequired: false,
                            userAssistReason: 'none',
                            boundedLearningBudget: {
                                complexityTier: 'complex',
                                maxRounds: 4,
                                maxResearchTimeMs: 180000,
                                maxValidationAttempts: 3,
                            },
                            reasons: ['Coworkany does not have a dedicated validated publish capability for the target platform.'],
                        },
                        capabilityReview: {
                            status: 'pending',
                            summary: 'Generated capability requires review before execution can resume.',
                            learnedEntityId: 'skill-wechat-official-post',
                        },
                        missingInfo: [],
                    },
                }],
            }),
        ];

        const result = buildTimelineItems(session, undefined, canonicalMessages);
        const taskCards = extractTaskCards(result.items);

        expect(taskCards).toHaveLength(1);
        expect(taskCards[0]).toMatchObject({
            subtitle: 'Generated capability requires review before execution can resume.',
            capabilityReview: {
                status: 'pending',
                summary: 'Generated capability requires review before execution can resume.',
                learnedEntityId: 'skill-wechat-official-post',
            },
            capabilityPlan: {
                missingCapability: 'new_runtime_tool_needed',
                learningRequired: true,
            },
        });
    });

    test('uses canonical task-center projection for immediate task sessions', () => {
        const session = makeSession({
            status: 'finished',
            taskMode: 'immediate_task',
        });
        const canonicalMessages: CanonicalTaskMessage[] = [
            makeCanonicalMessage({
                id: 'task-started',
                taskId: session.taskId,
                role: 'user',
                timestamp: '2026-03-27T10:00:00.000Z',
                sequence: 1,
                sourceEventId: 'task-started',
                sourceEventType: 'TASK_STARTED',
                parts: [{ type: 'text', text: '帮我生成发布总结' }],
            }),
            makeCanonicalMessage({
                id: 'task-plan',
                taskId: session.taskId,
                role: 'assistant',
                timestamp: '2026-03-27T10:00:01.000Z',
                sequence: 2,
                sourceEventId: 'task-plan',
                sourceEventType: 'TASK_PLAN_READY',
                parts: [{
                    type: 'task',
                    event: 'plan_ready',
                    summary: '准备收集变更并生成总结。',
                    data: {
                        mode: 'immediate_task',
                        intentRouting: {
                            intent: 'immediate_task',
                            confidence: 0.99,
                            reasonCodes: ['user_route_choice'],
                            needsDisambiguation: false,
                            forcedByUserSelection: true,
                        },
                        tasks: [
                            {
                                id: 'task-summary',
                                title: '整理发布内容',
                                objective: '生成总结',
                                dependencies: [],
                            },
                        ],
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        missingInfo: [],
                    },
                }],
            }),
            makeCanonicalMessage({
                id: 'task-finished',
                taskId: session.taskId,
                role: 'assistant',
                timestamp: '2026-03-27T10:00:02.000Z',
                sequence: 3,
                sourceEventId: 'task-finished',
                sourceEventType: 'TASK_FINISHED',
                parts: [
                    {
                        type: 'finish',
                        summary: '发布总结已生成。',
                        artifacts: [],
                        files: ['/tmp/release-summary.md'],
                    },
                    {
                        type: 'text',
                        text: '发布总结已生成。',
                    },
                ],
            }),
        ];

        const result = buildTimelineItems(session, undefined, canonicalMessages);
        const taskCards = extractTaskCards(result.items);
        const assistantMessages = extractAssistantMessages(result.items);

        expect(result.items[0]).toMatchObject({
            type: 'user_message',
            content: '帮我生成发布总结',
        });
        expect(taskCards).toHaveLength(1);
        expect(taskCards[0]).toMatchObject({
            status: 'finished',
            result: {
                summary: '发布总结已生成。',
                files: ['/tmp/release-summary.md'],
            },
        });
        expect(assistantMessages).toContain('发布总结已生成。');
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
        const assistantMessages = extractAssistantMessages(result.items);
        const turns = extractAssistantTurns(result.items);

        expect(turns).toHaveLength(1);
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
        const assistantMessages = extractAssistantMessages(result.items);
        const turns = extractAssistantTurns(result.items);

        expect(turns).toHaveLength(1);
        expect(assistantMessages).toEqual(['你好！很高兴见到你。']);
    });

    test('keeps a compact task card after scheduled task creation finishes', () => {
        const session = makeSession({
            status: 'finished',
            taskMode: 'scheduled_task',
            title: '[Scheduled] 喝水提醒',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_FINISHED',
                    payload: {
                        summary: '已创建每 5 分钟提醒喝水的定时任务。',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const taskCards = extractTaskCards(result.items);
        const assistantMessages = extractAssistantMessages(result.items);

        expect(taskCards).toHaveLength(1);
        expect(taskCards[0]?.title).toBe('喝水提醒');
        expect(taskCards[0]?.status).toBe('finished');
        expect(taskCards[0]?.result?.summary).toBe('已创建每 5 分钟提醒喝水的定时任务。');
        expect(assistantMessages).toContain('已创建每 5 分钟提醒喝水的定时任务。');
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

    test('normalizes control reply with uuid suffix in user chat messages', () => {
        const session = makeSession({
            status: 'running',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'CHAT_MESSAGE',
                    payload: {
                        role: 'user',
                        content: '继续执行（cfae30f0-2e9a-4779-a750-7c97c19d9580）',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const userMessages = result.items
            .filter((item) => item.type === 'user_message')
            .map((item) => item.content);

        expect(userMessages).toEqual(['继续执行']);
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
        const taskCards = extractTaskCards(result.items);
        const assistantMessages = extractAssistantMessages(result.items);
        const turns = extractAssistantTurns(result.items);

        expect(taskCards).toHaveLength(0);
        expect(turns).toHaveLength(1);
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
        const turnSystemContents = extractAssistantTurns(result.items)
            .flatMap((item) => item.systemEvents || []);

        expect([...systemContents, ...turnSystemContents]).toContain('Task failed: fetch failed');
    });

    test('keeps suspension and resume events as timeline no-ops', () => {
        const session = makeSession({
            status: 'running',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_SUSPENDED',
                    payload: {
                        reason: 'waiting_for_user',
                        userMessage: 'Need confirmation before continuing.',
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TASK_RESUMED',
                    payload: {
                        resumeReason: 'user_confirmed',
                        suspendDurationMs: 1200,
                    },
                }),
                makeEvent({
                    sequence: 3,
                    type: 'CHAT_MESSAGE',
                    payload: {
                        role: 'assistant',
                        content: '继续处理中。',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const assistantMessages = extractAssistantMessages(result.items);
        const systemContents = result.items
            .filter((item) => item.type === 'system_event')
            .map((item) => item.content);
        const turnSystemContents = extractAssistantTurns(result.items)
            .flatMap((item) => item.systemEvents || []);

        expect(assistantMessages).toEqual(['继续处理中。']);
        expect([...systemContents, ...turnSystemContents]).toEqual([]);
    });

    test('shows capability-review resume notice inside task-context turns', () => {
        const session = makeSession({
            status: 'running',
            taskMode: 'immediate_task',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Plan ready',
                        mode: 'immediate_task',
                        intentRouting: {
                            intent: 'immediate_task',
                            confidence: 0.98,
                            reasonCodes: ['explicit_command'],
                            needsDisambiguation: false,
                        },
                        tasks: [
                            {
                                id: 'task-1',
                                title: 'Publish',
                                objective: 'Publish',
                                dependencies: [],
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
                    type: 'TASK_RESUMED',
                    payload: {
                        resumeReason: 'capability_review_approved',
                        suspendDurationMs: 0,
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const turnSystemContents = extractAssistantTurns(result.items)
            .flatMap((item) => item.systemEvents || []);

        expect(turnSystemContents).toContain('Approved the generated capability and resumed the original task.');
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
        const turns = extractAssistantTurns(result.items);
        const taskCard = extractTaskCards(result.items)[0];
        expect(taskCard?.type).toBe('task_card');
        expect(turns[0]?.messages.some((line) => line.includes('[RESUMED]'))).toBe(false);
        expect(turns[0]?.messages.some((line) => line.toLowerCase().includes('status updated:'))).toBe(false);
    });

    test('projects route disambiguation clarification into task-card collaboration state', () => {
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
        const taskCards = extractTaskCards(result.items);

        expect(taskCards).toHaveLength(1);
        expect(taskCards[0]?.collaboration?.choices).toEqual([
            { label: '直接回答', value: '__route_chat__' },
            { label: '创建任务', value: '__route_task__' },
        ]);
        expect(taskCards[0]?.collaboration?.input).toBeUndefined();
    });

    test('projects task draft confirmation into collaboration state with edit input metadata', () => {
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
        const taskCards = extractTaskCards(result.items);

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

    test('preserves raw user and assistant trajectory after a task follow-up adds a second user message', () => {
        const session = makeSession({
            status: 'idle',
            taskMode: 'immediate_task',
            messages: [
                {
                    id: 'msg-user-1',
                    role: 'user',
                    content: '检索今天 minimax 的股价，分析走势，并发送到 X 上',
                    timestamp: '2026-03-27T09:28:19.635Z',
                },
                {
                    id: 'msg-assistant-1',
                    role: 'assistant',
                    content: '我先确认标的和发帖方式，再继续执行。',
                    timestamp: '2026-03-27T09:28:45.874Z',
                },
                {
                    id: 'msg-user-2',
                    role: 'user',
                    content: '发送到 X',
                    timestamp: '2026-03-27T10:30:16.725Z',
                },
                {
                    id: 'msg-assistant-2',
                    role: 'assistant',
                    content: '需要先完成登录准备。',
                    timestamp: '2026-03-27T10:30:21.184Z',
                },
            ],
            events: [
                makeEvent({
                    id: 'event-start',
                    sequence: 1,
                    type: 'TASK_STARTED',
                    timestamp: '2026-03-27T09:28:19.635Z',
                    payload: {
                        title: '检索今天 minimax 的股价，分析走势，并发送到 X 上',
                        context: {
                            userQuery: '原始任务：检索今天 minimax 的股价，分析走势，并发送到 X 上\n用户路由：task',
                        },
                    },
                }),
                makeEvent({
                    id: 'event-plan-1',
                    sequence: 2,
                    type: 'TASK_PLAN_READY',
                    timestamp: '2026-03-27T09:28:19.636Z',
                    payload: {
                        summary: 'Initial task plan.',
                        mode: 'immediate_task',
                        intentRouting: explicitTaskIntentRouting(),
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        missingInfo: [],
                    },
                }),
                makeEvent({
                    id: 'event-assistant-1',
                    sequence: 3,
                    type: 'CHAT_MESSAGE',
                    timestamp: '2026-03-27T09:28:45.874Z',
                    payload: {
                        role: 'assistant',
                        content: '我先确认标的和发帖方式，再继续执行。',
                    },
                }),
                makeEvent({
                    id: 'event-finish-1',
                    sequence: 4,
                    type: 'TASK_FINISHED',
                    timestamp: '2026-03-27T09:31:49.839Z',
                    payload: {
                        summary: '已拿到行情结果并生成可发帖文案。',
                    },
                }),
                makeEvent({
                    id: 'event-user-2',
                    sequence: 5,
                    type: 'CHAT_MESSAGE',
                    timestamp: '2026-03-27T10:30:16.725Z',
                    payload: {
                        role: 'user',
                        content: '发送到 X',
                    },
                }),
                makeEvent({
                    id: 'event-reopen',
                    sequence: 6,
                    type: 'TASK_CONTRACT_REOPENED',
                    timestamp: '2026-03-27T10:30:21.177Z',
                    payload: {
                        summary: 'User follow-up introduced a new task scope: deliverables changed.',
                        reason: 'User follow-up introduced a new task scope: deliverables or output targets changed.',
                        trigger: 'new_scope_signal',
                        diff: {
                            changedFields: ['deliverables'],
                        },
                    },
                }),
                makeEvent({
                    id: 'event-plan-2',
                    sequence: 7,
                    type: 'TASK_PLAN_READY',
                    timestamp: '2026-03-27T10:30:21.179Z',
                    payload: {
                        summary: 'Replanned task requires browser action.',
                        mode: 'immediate_task',
                        intentRouting: explicitTaskIntentRouting(),
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        missingInfo: [],
                    },
                }),
                makeEvent({
                    id: 'event-action',
                    sequence: 8,
                    type: 'TASK_USER_ACTION_REQUIRED',
                    timestamp: '2026-03-27T10:30:21.184Z',
                    payload: {
                        actionId: 'action-login',
                        title: 'Complete required manual action',
                        kind: 'external_auth',
                        description: '需要先完成登录准备。',
                        blocking: true,
                        questions: [],
                        instructions: ['先登录，再继续执行。'],
                    },
                }),
                makeEvent({
                    id: 'event-assistant-2',
                    sequence: 9,
                    type: 'CHAT_MESSAGE',
                    timestamp: '2026-03-27T10:30:21.184Z',
                    payload: {
                        role: 'assistant',
                        content: '需要先完成登录准备。',
                    },
                }),
                makeEvent({
                    id: 'event-status',
                    sequence: 10,
                    type: 'TASK_STATUS',
                    timestamp: '2026-03-27T10:30:21.184Z',
                    payload: {
                        status: 'idle',
                        activeHardness: 'externally_blocked',
                        blockingReason: '需要先完成登录准备。',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const turns = extractAssistantTurns(result.items);

        expect(result.items.map((item) => item.type)).toEqual([
            'user_message',
            'assistant_turn',
            'user_message',
            'assistant_turn',
            'assistant_turn',
        ]);
        expect(result.items[0]).toMatchObject({
            type: 'user_message',
            content: '检索今天 minimax 的股价，分析走势，并发送到 X 上',
        });
        expect(turns[0]?.messages).toEqual(['我先确认标的和发帖方式，再继续执行。']);
        expect(result.items[2]).toMatchObject({
            type: 'user_message',
            content: '发送到 X',
        });
        expect(turns[1]?.messages).toEqual(['需要先完成登录准备。']);
        expect(turns[2]?.taskCard?.collaboration?.title).toBe('Complete required manual action');
        expect(turns[2]?.taskCard?.subtitle).toBe('需要先完成登录准备。');
    });

    test('preserves the first user message trajectory while a task-mode session is still running', () => {
        const session = makeSession({
            status: 'running',
            taskMode: 'immediate_task',
            messages: [
                {
                    id: 'msg-user-1',
                    role: 'user',
                    content: '早上3点关机',
                    timestamp: '2026-03-28T13:39:25.571Z',
                },
            ],
            events: [
                makeEvent({
                    id: 'event-start',
                    sequence: 1,
                    type: 'TASK_STARTED',
                    timestamp: '2026-03-28T13:39:25.571Z',
                    payload: {
                        title: '早上3点关机',
                        context: {
                            userQuery: '原始任务：早上3点关机\n用户路由：chat',
                            displayText: '早上3点关机',
                        },
                    },
                }),
                makeEvent({
                    id: 'event-plan',
                    sequence: 2,
                    type: 'TASK_PLAN_READY',
                    timestamp: '2026-03-28T13:39:25.880Z',
                    payload: {
                        summary: '通过平台 shell 执行关机命令。',
                        mode: 'immediate_task',
                        intentRouting: explicitTaskIntentRouting(),
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        missingInfo: [],
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const userMessages = result.items.filter((item) => item.type === 'user_message');
        const taskCards = extractTaskCards(result.items);

        expect(userMessages).toEqual([
            expect.objectContaining({
                type: 'user_message',
                content: '早上3点关机',
            }),
        ]);
        expect(taskCards).toHaveLength(1);
        expect(taskCards[0]?.status).toBe('running');
    });

    test('keeps single-user task sessions on the collapsed task timeline path', () => {
        const session = makeSession({
            status: 'idle',
            taskMode: 'immediate_task',
            messages: [
                {
                    id: 'msg-user-1',
                    role: 'user',
                    content: '导出 PDF',
                    timestamp: '2026-03-27T10:00:00.000Z',
                },
                {
                    id: 'msg-assistant-1',
                    role: 'assistant',
                    content: '先确认导出权限。',
                    timestamp: '2026-03-27T10:00:01.000Z',
                },
            ],
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_PLAN_READY',
                    timestamp: '2026-03-27T10:00:00.000Z',
                    payload: {
                        summary: 'Need export permission.',
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
                    type: 'TASK_USER_ACTION_REQUIRED',
                    timestamp: '2026-03-27T10:00:01.000Z',
                    payload: {
                        actionId: 'grant-export',
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
        const turns = extractAssistantTurns(result.items);

        expect(result.items).toHaveLength(1);
        expect(turns[0]?.taskCard?.collaboration?.title).toBe('Grant PDF export access');
    });
});
