import { describe, expect, test } from 'bun:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import i18next, { type i18n as I18nInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { Header } from '../src/components/Chat/components/Header';

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
                        common: {
                            cancel: 'Cancel',
                        },
                        chat: {
                            reconnectLlm: 'Reconnect LLM',
                            stopVoice: 'Stop voice',
                            stoppingVoice: 'Stopping voice',
                            editLlmSettings: 'Edit LLM Settings',
                            manageSkills: 'Manage Skills',
                            manageMcpServers: 'Manage MCP Servers',
                            clearHistory: 'Clear history',
                            clear: 'Clear',
                        },
                    },
                },
            },
        });
    return instance;
}

function findStatusButton(renderer: ReactTestRenderer) {
    return renderer.root.find((node) =>
        node.type === 'button'
        && typeof node.props.className === 'string'
        && node.props.className.includes('chat-status-chip')
    );
}

describe('Chat Header status actions', () => {
    test('failed status allows reconnect action on status chip click', async () => {
        const i18n = await createTestI18n();
        let reconnectCount = 0;

        const renderer = create(
            <I18nextProvider i18n={i18n}>
                <Header
                    title="Test task"
                    status="failed"
                    statusLabel="Failed"
                    modelName="gpt-test"
                    enabledSkillsCount={0}
                    enabledToolpacksCount={0}
                    isClearing={false}
                    isCancelling={false}
                    isReconnectingLlm={false}
                    isSpeaking={false}
                    isStoppingVoice={false}
                    onShowSettings={() => {}}
                    onShowSkills={() => {}}
                    onShowMcp={() => {}}
                    onClearHistory={() => {}}
                    onCancel={() => {}}
                    onReconnectLlm={() => { reconnectCount += 1; }}
                    onStopVoice={() => {}}
                    canClearHistory={true}
                />
            </I18nextProvider>
        );

        await act(async () => {});

        const statusButton = findStatusButton(renderer);
        expect(statusButton.props.disabled).toBe(false);

        await act(async () => {
            statusButton.props.onClick();
        });

        expect(reconnectCount).toBe(1);
    });
});
