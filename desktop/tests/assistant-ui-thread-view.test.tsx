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
});
