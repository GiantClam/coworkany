import { afterEach, describe, expect, test } from 'bun:test';
import { buildTimelineItems } from '../src/components/Chat/Timeline/hooks/useTimelineItems';
import { buildTimelineTurnRoundViewModel } from '../src/components/Chat/Timeline/viewModels/turnRounds';
import { buildAssistantUiExternalMessages } from '../src/components/Chat/assistantUi/messageAdapter';
import { useTaskEventStore } from '../src/stores/taskEvents';
import { useCanonicalTaskStreamStore } from '../src/stores/useCanonicalTaskStreamStore';
import type { TaskEvent } from '../src/types';

function makeEvent(overrides: Partial<TaskEvent>): TaskEvent {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        taskId: overrides.taskId ?? 'task-assistant-ui-log-replay',
        sequence: overrides.sequence ?? 1,
        type: overrides.type ?? 'CHAT_MESSAGE',
        timestamp: overrides.timestamp ?? new Date().toISOString(),
        payload: overrides.payload ?? {},
    };
}

afterEach(() => {
    useTaskEventStore.getState().reset();
    useCanonicalTaskStreamStore.getState().reset();
});

describe('assistant-ui log replay regression', () => {
    test('preserves effect metadata after approval during event-log replay', () => {
        const taskId = 'task-assistant-ui-log-replay-1';
        const store = useTaskEventStore.getState();

        store.ensureSession(taskId, {
            title: 'Replay approval flow',
            status: 'running',
            taskMode: 'immediate_task',
            isDraft: false,
        }, true);

        store.addEvents([
            makeEvent({
                id: 'event-user',
                taskId,
                sequence: 1,
                type: 'CHAT_MESSAGE',
                timestamp: '2026-03-31T09:00:00.000Z',
                payload: {
                    role: 'user',
                    content: 'Run the deployment command',
                },
            }),
            makeEvent({
                id: 'event-assistant',
                taskId,
                sequence: 2,
                type: 'CHAT_MESSAGE',
                timestamp: '2026-03-31T09:00:01.000Z',
                payload: {
                    role: 'assistant',
                    content: 'I need approval before running this shell command.',
                },
            }),
            makeEvent({
                id: 'event-effect-requested',
                taskId,
                sequence: 3,
                type: 'EFFECT_REQUESTED',
                timestamp: '2026-03-31T09:00:02.000Z',
                payload: {
                    request: {
                        id: 'effect-request-1',
                        effectType: 'shell:write',
                    },
                    riskLevel: 9,
                },
            }),
            makeEvent({
                id: 'event-effect-approved',
                taskId,
                sequence: 4,
                type: 'EFFECT_APPROVED',
                timestamp: '2026-03-31T09:00:03.000Z',
                payload: {
                    response: {
                        requestId: 'effect-request-1',
                    },
                },
            }),
        ]);

        const session = useTaskEventStore.getState().getSession(taskId);
        expect(session).toBeDefined();

        const { items } = buildTimelineItems(session!);
        const rounds = buildTimelineTurnRoundViewModel(items).rounds;
        const messages = buildAssistantUiExternalMessages(rounds);

        const assistantWithApprovals = messages.find((message) =>
            message.role === 'assistant'
            && (message.structured?.approvals.length ?? 0) > 0
        );
        expect(assistantWithApprovals).toBeDefined();
        expect(assistantWithApprovals?.structured?.approvals).toEqual([
            {
                requestId: 'effect-request-1',
                effectType: 'shell:write',
                risk: 9,
                severity: 'critical',
                decision: 'approved',
                blocking: true,
            },
        ]);
    });
});
