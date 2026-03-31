import { afterEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import i18next, { type i18n as I18nInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { Timeline } from '../src/components/Chat/Timeline/Timeline';
import { useCanonicalTaskStreamStore } from '../src/stores/useCanonicalTaskStreamStore';
import type { TaskEvent, TaskSession } from '../src/types';

function makeEvent(overrides: Partial<TaskEvent>): TaskEvent {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        taskId: overrides.taskId ?? 'task-timeline-assistant-ui-path',
        sequence: overrides.sequence ?? 1,
        type: overrides.type ?? 'CHAT_MESSAGE',
        timestamp: overrides.timestamp ?? new Date().toISOString(),
        payload: overrides.payload ?? {},
    };
}

function makeSession(taskId = 'task-timeline-assistant-ui-path'): TaskSession {
    return {
        taskId,
        status: 'running',
        taskMode: 'immediate_task',
        planSteps: [],
        toolCalls: [],
        effects: [],
        patches: [],
        messages: [
            {
                id: 'msg-user',
                role: 'user',
                content: 'Run the command',
                timestamp: '2026-03-31T12:00:00.000Z',
            },
            {
                id: 'msg-assistant',
                role: 'assistant',
                content: 'Need approval before running this effect.',
                timestamp: '2026-03-31T12:00:01.000Z',
            },
        ],
        events: [
            makeEvent({
                id: 'event-user',
                taskId,
                sequence: 1,
                type: 'CHAT_MESSAGE',
                timestamp: '2026-03-31T12:00:00.000Z',
                payload: {
                    role: 'user',
                    content: 'Run the command',
                },
            }),
            makeEvent({
                id: 'event-assistant',
                taskId,
                sequence: 2,
                type: 'CHAT_MESSAGE',
                timestamp: '2026-03-31T12:00:01.000Z',
                payload: {
                    role: 'assistant',
                    content: 'Need approval before running this effect.',
                },
            }),
            makeEvent({
                id: 'event-effect-requested',
                taskId,
                sequence: 3,
                type: 'EFFECT_REQUESTED',
                timestamp: '2026-03-31T12:00:02.000Z',
                payload: {
                    request: {
                        id: 'effect-request-critical',
                        effectType: 'shell:write',
                    },
                    riskLevel: 9,
                },
            }),
        ],
        createdAt: '2026-03-31T12:00:00.000Z',
        updatedAt: '2026-03-31T12:00:03.000Z',
    };
}

function getButtonsByLabel(renderer: ReactTestRenderer, label: string) {
    return renderer.root.findAllByType('button').filter((button) => {
        const children = button.props.children;
        if (typeof children === 'string') {
            return children === label;
        }
        if (Array.isArray(children)) {
            return children.join('') === label;
        }
        return false;
    });
}

async function waitForButtonLabel(
    renderer: ReactTestRenderer,
    label: string,
    maxAttempts = 20,
): Promise<boolean> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (getButtonsByLabel(renderer, label).length > 0) {
            return true;
        }
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
    return getButtonsByLabel(renderer, label).length > 0;
}

async function createTestI18n(): Promise<I18nInstance> {
    const instance = i18next.createInstance();
    await instance
        .use(initReactI18next)
        .init({
            lng: 'en',
            fallbackLng: 'en',
            interpolation: { escapeValue: false },
            resources: {
                en: {
                    translation: {
                        assistantUi: {
                            highRiskApprovals: 'High risk approvals',
                        },
                    },
                },
            },
        });
    return instance;
}

afterEach(() => {
    useCanonicalTaskStreamStore.getState().reset();
});

describe('Timeline assistant-ui runtime path', () => {
    test('always renders assistant-ui thread', async () => {
        const i18n = await createTestI18n();
        const session = makeSession('task-runtime-default');

        const renderer = create(
            <I18nextProvider i18n={i18n}>
                <Timeline session={session} />
            </I18nextProvider>
        );

        expect(await waitForButtonLabel(renderer, 'Approve')).toBe(true);
    });
});
