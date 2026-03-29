import { describe, expect, test } from 'bun:test';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { coworker } from '../src/mastra/agents/coworker';
import { supervisor } from '../src/mastra/agents/supervisor';
import {
    handleApprovalResponse,
    handleUserMessage,
    resolveMissingApiKeyForModel,
} from '../src/ipc/streaming';

const echoTool = createTool({
    id: 'echo',
    description: 'echo input',
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.object({ echoed: z.string() }),
    execute: async ({ message }) => ({ echoed: message }),
});

describe('Phase 3: Agent Loop', () => {
    test('can create a basic agent', () => {
        const agent = new Agent({
            id: 'phase3-agent',
            name: 'Phase3 Agent',
            instructions: 'Reply briefly.',
            model: 'anthropic/claude-sonnet-4-5',
            tools: {
                echo: echoTool,
            },
        });

        expect(agent).toBeDefined();
        expect(agent.id).toBe('phase3-agent');
    });

    test('coworker and supervisor agents are created', () => {
        expect(coworker).toBeDefined();
        expect(supervisor).toBeDefined();
        expect(coworker.id).toBe('coworker');
        expect(supervisor.id).toBe('supervisor');
    });

    test('supervisor has own memory for propagation', () => {
        expect(supervisor.hasOwnMemory()).toBe(true);
    });

    test('IPC bridge functions exist', () => {
        expect(typeof handleUserMessage).toBe('function');
        expect(typeof handleApprovalResponse).toBe('function');
    });

    test('model api key precheck resolves missing key by provider', () => {
        expect(
            resolveMissingApiKeyForModel('anthropic/claude-sonnet-4-5', {}),
        ).toBe('ANTHROPIC_API_KEY');
        expect(
            resolveMissingApiKeyForModel('openai/gpt-4.1', {}),
        ).toBe('OPENAI_API_KEY');
        expect(
            resolveMissingApiKeyForModel('anthropic/claude-sonnet-4-5', {
                ANTHROPIC_API_KEY: 'x',
            }),
        ).toBeNull();
    });

    test.skip('integration: stream emits text deltas', async () => {
        const events: unknown[] = [];
        await handleUserMessage(
            'Say hello',
            `phase3-${Date.now()}`,
            'employee-test',
            (event) => events.push(event),
        );
        expect(events.length).toBeGreaterThan(0);
    });
});
