import { describe, expect, test } from 'bun:test';
import {
    buildAssistantUiExternalMessages,
    readAssistantUiStructuredPayload,
    toAssistantUiThreadMessageLike,
} from '../src/components/Chat/assistantUi/messageAdapter';
import type { TimelineTurnRound } from '../src/components/Chat/Timeline/viewModels/turnRounds';

describe('assistant-ui message adapter', () => {
    test('projects timeline rounds into assistant-ui external messages with structured summaries', () => {
        const rounds: TimelineTurnRound[] = [
            {
                id: 'round-1',
                userMessage: {
                    type: 'user_message',
                    id: 'user-1',
                    content: 'Please analyze NVDA for this week.',
                    timestamp: '2026-03-31T02:30:00.000Z',
                },
                assistantTurn: {
                    type: 'assistant_turn',
                    id: 'assistant-1',
                    timestamp: '2026-03-31T02:30:05.000Z',
                    lead: 'I reviewed market context and prepared a summary.',
                    steps: [],
                    messages: ['Here is the weekly brief.'],
                    systemEvents: ['Tool routing completed'],
                    toolCalls: [{
                        type: 'tool_call',
                        id: 'tool-1',
                        timestamp: '2026-03-31T02:30:03.000Z',
                        toolName: 'web.search',
                        args: { q: 'NVDA weekly news' },
                        status: 'success',
                    }],
                    effectRequests: [{
                        type: 'effect_request',
                        id: 'effect-1',
                        timestamp: '2026-03-31T02:30:04.000Z',
                        effectType: 'open_url',
                        risk: 2,
                    }],
                    patches: [{
                        type: 'patch',
                        id: 'patch-1',
                        timestamp: '2026-03-31T02:30:05.000Z',
                        filePath: 'reports/nvda-weekly.md',
                        status: 'proposed',
                    }],
                    taskCard: {
                        type: 'task_card',
                        id: 'task-card-1',
                        timestamp: '2026-03-31T02:30:05.000Z',
                        title: 'Task center',
                        tasks: [
                            {
                                id: 'step-1',
                                title: 'Collect data',
                                status: 'completed',
                            },
                            {
                                id: 'step-2',
                                title: 'Write report',
                                status: 'pending',
                            },
                        ],
                        sections: [],
                    },
                },
            },
        ];

        const messages = buildAssistantUiExternalMessages(rounds);
        expect(messages).toHaveLength(2);
        expect(messages[0]).toMatchObject({
            role: 'user',
            source: 'user_message',
            text: 'Please analyze NVDA for this week.',
        });
        expect(messages[1]).toMatchObject({
            role: 'assistant',
            source: 'assistant_turn',
            cardCounts: {
                tools: 1,
                approvals: 1,
                tasks: 1,
                patches: 1,
            },
            structured: {
                tools: [{
                    toolName: 'web.search',
                    status: 'success',
                    inputSummary: expect.stringContaining('"q":"NVDA weekly news"'),
                }],
                approvals: [{
                    requestId: 'effect-1',
                    effectType: 'open_url',
                    risk: 2,
                    severity: 'low',
                    decision: 'pending',
                    blocking: false,
                }],
                task: {
                    title: 'Task center',
                    status: 'idle',
                    progress: { completed: 1, total: 2 },
                },
                patches: [{ filePath: 'reports/nvda-weekly.md', status: 'proposed' }],
            },
        });
        expect(messages[1]?.text).toContain('Here is the weekly brief.');
        expect(messages[1]?.text).toContain('Runtime:');
        expect(messages[1]?.text).toContain('Structured cards: Tools 1 | Approvals 1 | Task 1 | Patches 1');
    });

    test('converts external message to ThreadMessageLike', () => {
        const converted = toAssistantUiThreadMessageLike({
            id: 'assistant-2',
            role: 'assistant',
            text: 'Done.',
            timestamp: '2026-03-31T02:31:00.000Z',
            turnId: 'round-2',
            source: 'assistant_turn',
            cardCounts: {
                tools: 0,
                approvals: 0,
                tasks: 0,
                patches: 0,
            },
        });

        expect(converted).toMatchObject({
            id: 'assistant-2',
            role: 'assistant',
            content: [{ type: 'text', text: 'Done.' }],
            metadata: {
                custom: {
                    source: 'assistant_turn',
                    turnId: 'round-2',
                },
            },
        });
        expect(converted.createdAt).toBeInstanceOf(Date);
    });

    test('keeps pending assistant status visible when the last round has no renderable assistant body', () => {
        const rounds: TimelineTurnRound[] = [
            {
                id: 'round-2',
                userMessage: {
                    type: 'user_message',
                    id: 'user-2',
                    content: 'Run this task',
                    timestamp: '2026-03-31T03:00:00.000Z',
                },
                assistantTurn: {
                    type: 'assistant_turn',
                    id: 'pending-turn-task-2',
                    timestamp: '2026-03-31T03:00:01.000Z',
                    lead: '',
                    steps: [],
                    messages: [],
                },
            },
        ];

        const messages = buildAssistantUiExternalMessages(rounds, {
            pendingLabel: 'Sent. Thinking...',
        });

        expect(messages).toHaveLength(2);
        expect(messages[1]).toMatchObject({
            id: 'pending-turn-task-2',
            role: 'assistant',
            text: 'Sent. Thinking...',
            structured: {
                runtime: { pendingLabel: 'Sent. Thinking...' },
            },
        });
    });

    test('reads structured payload from assistant-ui custom metadata safely', () => {
        const payload = readAssistantUiStructuredPayload({
            structured: {
                tools: [{ toolName: 'web.search', status: 'running' }],
                approvals: [{ requestId: 'effect-1', effectType: 'open_url', risk: 3, severity: 'low', decision: 'approved', blocking: false }],
                task: { title: 'Task center', status: 'running', progress: { completed: 1, total: 3 } },
                patches: [{ filePath: 'src/app.ts', status: 'applied' }],
            },
        });

        expect(payload).toMatchObject({
                tools: [{ toolName: 'web.search', status: 'running' }],
                approvals: [{ requestId: 'effect-1', effectType: 'open_url', risk: 3, severity: 'low', decision: 'approved', blocking: false }],
                task: { title: 'Task center', status: 'running', progress: { completed: 1, total: 3 } },
                patches: [{ filePath: 'src/app.ts', status: 'applied' }],
        });
        expect(readAssistantUiStructuredPayload({})).toBeNull();
        expect(readAssistantUiStructuredPayload(null)).toBeNull();
    });

    test('sorts approvals by severity/risk and marks high-risk approvals as blocking', () => {
        const rounds: TimelineTurnRound[] = [
            {
                id: 'round-3',
                assistantTurn: {
                    type: 'assistant_turn',
                    id: 'assistant-3',
                    timestamp: '2026-03-31T04:00:00.000Z',
                    lead: 'Approvals needed.',
                    steps: [],
                    messages: ['Please review.'],
                    effectRequests: [
                        {
                            type: 'effect_request',
                            id: 'effect-low',
                            timestamp: '2026-03-31T04:00:01.000Z',
                            effectType: 'open_url',
                            risk: 2,
                        },
                        {
                            type: 'effect_request',
                            id: 'effect-critical',
                            timestamp: '2026-03-31T04:00:02.000Z',
                            effectType: 'exec_shell',
                            risk: 9,
                        },
                        {
                            type: 'effect_request',
                            id: 'effect-high',
                            timestamp: '2026-03-31T04:00:03.000Z',
                            effectType: 'delete_path',
                            risk: 7,
                        },
                    ],
                },
            },
        ];

        const messages = buildAssistantUiExternalMessages(rounds);
        expect(messages).toHaveLength(1);
        expect(messages[0]?.structured?.approvals).toEqual([
            {
                requestId: 'effect-critical',
                effectType: 'exec_shell',
                risk: 9,
                severity: 'critical',
                decision: 'pending',
                blocking: true,
            },
            {
                requestId: 'effect-high',
                effectType: 'delete_path',
                risk: 7,
                severity: 'high',
                decision: 'pending',
                blocking: true,
            },
            {
                requestId: 'effect-low',
                effectType: 'open_url',
                risk: 2,
                severity: 'low',
                decision: 'pending',
                blocking: false,
            },
        ]);
    });

    test('keeps structured-only assistant turn visible when there is no assistant text body', () => {
        const rounds: TimelineTurnRound[] = [
            {
                id: 'round-structured-only',
                assistantTurn: {
                    type: 'assistant_turn',
                    id: 'assistant-structured-only',
                    timestamp: '2026-03-31T05:00:00.000Z',
                    lead: '',
                    steps: [],
                    messages: [],
                    effectRequests: [
                        {
                            type: 'effect_request',
                            id: 'effect-structured-only',
                            timestamp: '2026-03-31T05:00:01.000Z',
                            effectType: 'shell:write',
                            risk: 8,
                        },
                    ],
                },
            },
        ];

        const messages = buildAssistantUiExternalMessages(rounds);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
            role: 'assistant',
            text: 'Structured cards: Approvals 1',
            structured: {
                approvals: [
                    {
                        requestId: 'effect-structured-only',
                        effectType: 'shell:write',
                        risk: 8,
                        severity: 'high',
                        decision: 'pending',
                        blocking: true,
                    },
                ],
            },
        });
    });

    test('uses task card result summary as assistant response when turn has no direct assistant text', () => {
        const rounds: TimelineTurnRound[] = [
            {
                id: 'round-task-result-only',
                assistantTurn: {
                    type: 'assistant_turn',
                    id: 'assistant-task-result-only',
                    timestamp: '2026-03-31T06:00:00.000Z',
                    lead: '',
                    steps: [],
                    messages: [],
                    taskCard: {
                        type: 'task_card',
                        id: 'task-card-result-only',
                        timestamp: '2026-03-31T06:00:00.000Z',
                        title: 'Task center',
                        sections: [],
                        result: {
                            summary: 'Execution completed successfully and report is ready.',
                        },
                    },
                },
            },
        ];

        const messages = buildAssistantUiExternalMessages(rounds);
        expect(messages).toHaveLength(1);
        expect(messages[0]?.role).toBe('assistant');
        expect(messages[0]?.text).toContain('Execution completed successfully and report is ready.');
    });
});
