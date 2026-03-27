import { describe, expect, test } from 'bun:test';
import type { AssistantTurnItem, TaskCardItem, ToolCallItem } from '../src/types';
import { buildAssistantTurnCardSchemas } from '../src/components/Chat/Timeline/components/assistantTurnCardSchema';

function makeToolCall(overrides: Partial<ToolCallItem> = {}): ToolCallItem {
    return {
        id: overrides.id ?? 'tool-1',
        type: 'tool_call',
        timestamp: overrides.timestamp ?? '2026-03-27T10:00:00.000Z',
        toolName: overrides.toolName ?? 'search',
        args: overrides.args ?? { q: 'latest' },
        status: overrides.status ?? 'running',
        result: overrides.result,
    };
}

function makeTaskCard(overrides: Partial<TaskCardItem> = {}): TaskCardItem {
    return {
        id: overrides.id ?? 'task-card-1',
        type: 'task_card',
        timestamp: overrides.timestamp ?? '2026-03-27T10:00:00.000Z',
        title: overrides.title ?? 'Task center',
        subtitle: overrides.subtitle,
        status: overrides.status,
        workflow: overrides.workflow,
        tasks: overrides.tasks,
        collaboration: overrides.collaboration,
        result: overrides.result,
        sections: overrides.sections ?? [],
        taskId: overrides.taskId,
    };
}

function makeAssistantTurn(overrides: Partial<AssistantTurnItem> = {}): AssistantTurnItem {
    return {
        id: overrides.id ?? 'turn-1',
        type: 'assistant_turn',
        timestamp: overrides.timestamp ?? '2026-03-27T10:00:00.000Z',
        lead: overrides.lead ?? 'Working through the request',
        steps: overrides.steps ?? [],
        messages: overrides.messages ?? ['Draft response'],
        systemEvents: overrides.systemEvents ?? ['Runtime attached'],
        toolCalls: overrides.toolCalls,
        effectRequests: overrides.effectRequests,
        patches: overrides.patches,
        taskCard: overrides.taskCard,
    };
}

describe('buildAssistantTurnCardSchemas', () => {
    test('builds ordered canonical card schema for assistant turn content', () => {
        const turn = makeAssistantTurn({
            toolCalls: [makeToolCall()],
            effectRequests: [
                {
                    id: 'effect-1',
                    type: 'effect_request',
                    timestamp: '2026-03-27T10:01:00.000Z',
                    effectType: 'open_url',
                    risk: 2,
                    approved: undefined,
                },
            ],
            patches: [
                {
                    id: 'patch-1',
                    type: 'patch',
                    timestamp: '2026-03-27T10:02:00.000Z',
                    filePath: 'src/app.ts',
                    status: 'proposed',
                },
            ],
            taskCard: makeTaskCard({ id: 'task-card-primary', title: 'Task center', status: 'running' }),
        });

        const cards = buildAssistantTurnCardSchemas(turn, 'Planning next step');

        expect(cards.map((card) => card.type)).toEqual([
            'runtime-status',
            'assistant-response',
            'tool-call',
            'task-card',
            'task-card',
            'task-card',
        ]);
        expect(cards[0]).toMatchObject({
            type: 'runtime-status',
            summary: {
                kind: 'runtime',
                title: 'Planning next step',
                statusLabel: 'Running',
                statusTone: 'running',
            },
        });
        expect(cards[1]).toMatchObject({
            type: 'assistant-response',
            summary: {
                kind: 'assistant',
                title: 'Response',
                subtitle: 'Working through the request',
            },
            messages: ['Draft response'],
            systemEvents: ['Runtime attached'],
        });
        expect(cards[2]).toMatchObject({
            type: 'tool-call',
            viewModel: {
                id: 'tool-1',
                summary: {
                    title: 'search',
                },
            },
        });
        expect(cards[3]).toMatchObject({
            type: 'task-card',
            placement: 'inline',
            viewModel: {
                summary: {
                    title: 'Effect request · open_url',
                },
            },
        });
        expect(cards[4]).toMatchObject({
            type: 'task-card',
            placement: 'inline',
            viewModel: {
                summary: {
                    title: 'Patch update',
                },
            },
        });
        expect(cards[5]).toMatchObject({
            type: 'task-card',
            placement: 'primary',
            viewModel: {
                id: 'task-card-primary',
            },
        });
    });

    test('suppresses duplicate summary and result blocks when assistant markdown response is present', () => {
        const turn = makeAssistantTurn({
            messages: ['## Final Answer\n\n- item 1\n- item 2'],
            taskCard: makeTaskCard({
                id: 'task-card-duplicate-content',
                status: 'finished',
                sections: [
                    { label: 'Summary', lines: ['## Final Answer', '- item 1', '- item 2'] },
                    { label: 'Plan', lines: ['collect data', 'publish result'] },
                ],
                result: {
                    summary: '## Final Answer\n\n- item 1\n- item 2',
                    files: ['reports/final.md'],
                },
            }),
        });

        const cards = buildAssistantTurnCardSchemas(turn);
        const primaryTaskCard = cards.find((card) => card.type === 'task-card' && card.placement === 'primary');

        expect(primaryTaskCard).toMatchObject({
            type: 'task-card',
            placement: 'primary',
            viewModel: {
                id: 'task-card-duplicate-content',
                sections: [
                    {
                        label: 'Plan',
                        lines: ['collect data', 'publish result'],
                    },
                ],
                resultSection: undefined,
            },
        });
    });
});
