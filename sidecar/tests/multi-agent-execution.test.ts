import { describe, expect, test } from 'bun:test';
import {
    MULTI_AGENT_EXECUTION_CONTRACT_MARKER,
    detectMultiAgentIntent,
    injectMultiAgentExecutionContract,
    shouldEnableAgentNetworkExecution,
} from '../src/mastra/multiAgentExecution';

describe('multi-agent execution strategy', () => {
    test('detects explicit multi-agent intents', () => {
        const signal = detectMultiAgentIntent(
            'Use a multi-agent pipeline: delegate to developer and reviewer roles, then integrate outputs.',
        );
        expect(signal.explicitKeyword).toBe(true);
        expect(signal.roleHintCount).toBeGreaterThanOrEqual(2);
        expect(signal.shouldUseMultiAgent).toBe(true);
    });

    test('does not over-trigger on ordinary single-agent tasks', () => {
        const signal = detectMultiAgentIntent(
            'Please summarize this document and save the answer to workspace/report.md',
        );
        expect(signal.shouldUseMultiAgent).toBe(false);
    });

    test('injects multi-agent contract once when signal requires it', () => {
        const message = '请使用多智能体分工：研究、实现、评审三个角色协作完成任务。';
        const signal = detectMultiAgentIntent(message);
        const injected = injectMultiAgentExecutionContract({
            message,
            signal,
        });
        expect(injected.includes(MULTI_AGENT_EXECUTION_CONTRACT_MARKER)).toBe(true);

        const injectedAgain = injectMultiAgentExecutionContract({
            message: injected,
            signal,
        });
        const markerOccurrences = injectedAgain.split(MULTI_AGENT_EXECUTION_CONTRACT_MARKER).length - 1;
        expect(markerOccurrences).toBe(1);
    });

    test('enables network execution only for task route + supervisor + signal', () => {
        const decision = shouldEnableAgentNetworkExecution({
            message: 'Orchestrate a multi-agent debate between pro and con roles, then synthesize.',
            forcedRouteMode: 'task',
            selectedAgent: 'supervisor',
            useDirectChatResponder: false,
            env: {
                COWORKANY_MASTRA_ENABLE_AGENT_NETWORK: '1',
                COWORKANY_MASTRA_TASK_ENABLE_MULTI_AGENT_NETWORK: '1',
                COWORKANY_MASTRA_PREFER_AGENT_NETWORK: '1',
            },
        });
        expect(decision.enabled).toBe(true);
        expect(decision.reason).toBe('multi_agent_signal');
    });

    test('defaults to supervisor stream strategy when network preference is not enabled', () => {
        const decision = shouldEnableAgentNetworkExecution({
            message: 'Please run a multi-agent role pipeline with researcher and reviewer.',
            forcedRouteMode: 'task',
            selectedAgent: 'supervisor',
            useDirectChatResponder: false,
            env: {
                COWORKANY_MASTRA_ENABLE_AGENT_NETWORK: '1',
                COWORKANY_MASTRA_TASK_ENABLE_MULTI_AGENT_NETWORK: '1',
            },
        });
        expect(decision.enabled).toBe(false);
        expect(decision.reason).toBe('prefer_supervisor_stream');
    });

    test('disables network execution for non-supervisor route', () => {
        const decision = shouldEnableAgentNetworkExecution({
            message: 'Use multi-agent orchestration with developer and reviewer.',
            forcedRouteMode: 'task',
            selectedAgent: 'researcher',
            useDirectChatResponder: false,
            env: {
                COWORKANY_MASTRA_ENABLE_AGENT_NETWORK: '1',
                COWORKANY_MASTRA_TASK_ENABLE_MULTI_AGENT_NETWORK: '1',
                COWORKANY_MASTRA_PREFER_AGENT_NETWORK: '1',
            },
        });
        expect(decision.enabled).toBe(false);
        expect(decision.reason).toBe('non_supervisor_route');
    });
});
