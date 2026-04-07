import { describe, expect, test } from 'bun:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import i18next, { type i18n as I18nInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import type { TimelineTurnRound } from '../src/components/Chat/Timeline/viewModels/turnRounds';
import { AssistantUiRuntimeBridge } from '../src/components/Chat/assistantUi/AssistantUiRuntimeBridge';
import { AssistantUiThreadView } from '../src/components/Chat/assistantUi/AssistantUiThreadView';

function makeRounds(): TimelineTurnRound[] {
    return [
        {
            id: 'round-approval-1',
            userMessage: {
                type: 'user_message',
                id: 'user-approval-1',
                content: 'Please execute this command.',
                timestamp: '2026-03-31T08:00:00.000Z',
            },
            assistantTurn: {
                type: 'assistant_turn',
                id: 'assistant-approval-1',
                timestamp: '2026-03-31T08:00:01.000Z',
                lead: 'Need your confirmation before running this effect.',
                steps: [],
                messages: ['Approval required.'],
                effectRequests: [
                    {
                        type: 'effect_request',
                        id: 'effect-critical-1',
                        timestamp: '2026-03-31T08:00:01.000Z',
                        effectType: 'shell:write',
                        risk: 9,
                    },
                ],
            },
        },
    ];
}

function makeEventRounds(assistantMessageId: string, events: string[]): TimelineTurnRound[] {
    return [
        {
            id: 'round-events-1',
            userMessage: {
                type: 'user_message',
                id: 'user-events-1',
                content: 'show runtime events',
                timestamp: '2026-03-31T08:10:00.000Z',
            },
            assistantTurn: {
                type: 'assistant_turn',
                id: assistantMessageId,
                timestamp: '2026-03-31T08:10:01.000Z',
                lead: '',
                steps: [],
                messages: [],
                systemEvents: events,
            },
        },
    ];
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

function toTextContent(children: unknown): string {
    if (typeof children === 'string') {
        return children;
    }
    if (Array.isArray(children)) {
        return children.map((child) => toTextContent(child)).join('');
    }
    if (children && typeof children === 'object' && 'props' in (children as Record<string, unknown>)) {
        return toTextContent((children as { props?: { children?: unknown } }).props?.children);
    }
    return '';
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
                            approve: 'Approve',
                            deny: 'Deny',
                            modifyApprove: 'Modify & Approve',
                            submit: 'Submit',
                        },
                        common: {
                            retry: 'Retry',
                        },
                    },
                },
            },
        });
    return instance;
}

describe('AssistantUiThreadView', () => {
    test('renders high-risk approval card actions and dispatches decision callback', async () => {
        const approvals: Array<{
            requestId: string;
            decision: 'approve' | 'deny' | 'modify_approve';
            note?: string;
        }> = [];
        const i18n = await createTestI18n();

        const renderer = create(
            <I18nextProvider i18n={i18n}>
                <AssistantUiRuntimeBridge sessionId="task-approval-1" rounds={makeRounds()}>
                    <AssistantUiThreadView onApprovalDecision={(input) => approvals.push(input)} />
                </AssistantUiRuntimeBridge>
            </I18nextProvider>
        );

        await act(async () => {});

        expect(renderer.root.findAll((node) => node.type === 'section' && node.props['aria-label'] === 'High risk approvals').length).toBe(1);
        expect(getButtonsByLabel(renderer, 'Approve').length).toBeGreaterThan(0);
        expect(getButtonsByLabel(renderer, 'Deny').length).toBeGreaterThan(0);

        const denyButton = getButtonsByLabel(renderer, 'Deny')[0];
        expect(denyButton).toBeDefined();

        await act(async () => {
            denyButton?.props.onClick();
        });

        expect(approvals).toEqual([
            {
                requestId: 'effect-critical-1',
                decision: 'deny',
            },
        ]);
    });

    test('keeps expanded events list open across assistant message refresh', async () => {
        const i18n = await createTestI18n();

        const renderer = create(
            <I18nextProvider i18n={i18n}>
                <AssistantUiRuntimeBridge
                    sessionId="task-events-1"
                    rounds={makeEventRounds('assistant-events-1', ['event-a', 'event-b', 'event-c'])}
                >
                    <AssistantUiThreadView />
                </AssistantUiRuntimeBridge>
            </I18nextProvider>
        );

        await act(async () => {});

        const findEventDetails = () => renderer.root.findAllByType('details').find((node) => {
            const summaries = node.findAllByType('summary');
            if (summaries.length === 0) {
                return false;
            }
            const text = toTextContent(summaries[0]?.props.children);
            return text.toLowerCase().includes('show') && text.toLowerCase().includes('more');
        });

        let details = findEventDetails();
        expect(details).toBeDefined();
        expect(details?.props.open).toBe(false);

        await act(async () => {
            details?.props.onToggle?.({ currentTarget: { open: true } });
        });

        details = findEventDetails();
        expect(details?.props.open).toBe(true);

        await act(async () => {
            renderer.update(
                <I18nextProvider i18n={i18n}>
                    <AssistantUiRuntimeBridge
                        sessionId="task-events-1"
                        rounds={makeEventRounds('assistant-events-2', ['event-a', 'event-b', 'event-c', 'event-d'])}
                    >
                        <AssistantUiThreadView />
                    </AssistantUiRuntimeBridge>
                </I18nextProvider>
            );
        });

        details = findEventDetails();
        expect(details?.props.open).toBe(true);
    });

    test('wires assistant message retry action to runtime reload callback', async () => {
        const i18n = await createTestI18n();
        const reloadCalls: Array<string | null> = [];

        const renderer = create(
            <I18nextProvider i18n={i18n}>
                <AssistantUiRuntimeBridge
                    sessionId="task-reload-1"
                    rounds={makeRounds()}
                    onReloadMessage={(parentId) => {
                        reloadCalls.push(parentId);
                    }}
                >
                    <AssistantUiThreadView />
                </AssistantUiRuntimeBridge>
            </I18nextProvider>
        );

        await act(async () => {});

        const retryButton = renderer.root.findAllByType('button').find((button) => (
            button.props['aria-label'] === 'Retry'
            || button.props.title === 'Retry'
        ));

        expect(retryButton).toBeDefined();

        await act(async () => {
            retryButton?.props.onClick?.({
                defaultPrevented: false,
                preventDefault() {},
            });
        });

        expect(reloadCalls).toEqual(['user-approval-1']);
    });
});
