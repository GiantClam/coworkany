import { describe, expect, test } from 'bun:test';
import { handleEntrypointUtilityCommands } from '../src/mastra/entrypointUtilityCommands';

type Outgoing = {
    type: string;
    payload: Record<string, unknown>;
};

function createHarness(overrides?: {
    commandType?: string;
    payload?: Record<string, unknown>;
    replayWorkflowRunTimeTravel?: Parameters<typeof handleEntrypointUtilityCommands>[0]['replayWorkflowRunTimeTravel'];
}) {
    const outgoing: Outgoing[] = [];
    const deps: Parameters<typeof handleEntrypointUtilityCommands>[0] = {
        commandType: overrides?.commandType ?? 'unknown',
        payload: overrides?.payload ?? {},
        getString: (value) => (typeof value === 'string' && value.length > 0 ? value : null),
        toRecord: (value) => (value && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : {}),
        emitFor: (type, payload) => {
            outgoing.push({ type, payload });
        },
        emitCurrent: (payload) => {
            outgoing.push({ type: 'current', payload });
        },
        emitCurrentInvalidPayload: (extra = {}) => {
            outgoing.push({
                type: 'current',
                payload: {
                    success: false,
                    ...extra,
                    error: 'invalid_payload',
                },
            });
        },
        stopVoicePlayback: async () => true,
        getVoicePlaybackState: () => ({ isSpeaking: false }),
        getVoiceProviderStatus: () => ({ preferredAsr: 'system' }),
        transcribeWithCustomAsr: async () => ({ success: true, text: 'ok' }),
        replayWorkflowRunTimeTravel: overrides?.replayWorkflowRunTimeTravel,
    };
    return { deps, outgoing };
}

describe('entrypointUtilityCommands', () => {
    test('handles get_voice_state with protocol-compatible payload', async () => {
        const harness = createHarness({
            commandType: 'get_voice_state',
        });
        const handled = await handleEntrypointUtilityCommands(harness.deps);
        expect(handled).toBe(true);
        expect(harness.outgoing).toHaveLength(1);
        expect(harness.outgoing[0]).toEqual({
            type: 'get_voice_state_response',
            payload: {
                success: true,
                state: { isSpeaking: false },
            },
        });
    });

    test('returns stable unsupported payload for autonomous command family', async () => {
        const harness = createHarness({
            commandType: 'list_autonomous_tasks',
        });
        const handled = await handleEntrypointUtilityCommands(harness.deps);
        expect(handled).toBe(true);
        expect(harness.outgoing[0]).toEqual({
            type: 'list_autonomous_tasks_response',
            payload: {
                success: false,
                tasks: [],
                error: 'unsupported_in_mastra_runtime',
            },
        });
    });

    test('reports invalid payload when time-travel workflow command is missing required fields', async () => {
        const harness = createHarness({
            commandType: 'time_travel_workflow_run',
            payload: {
                workflowId: 'wf-1',
            },
            replayWorkflowRunTimeTravel: async () => ({
                success: true,
                workflowId: 'wf-1',
                runId: 'run-1',
                status: 'completed',
                steps: [],
                traceId: 'trace-1',
                sampled: false,
            }),
        });
        const handled = await handleEntrypointUtilityCommands(harness.deps);
        expect(handled).toBe(true);
        expect(harness.outgoing[0]).toEqual({
            type: 'current',
            payload: {
                success: false,
                workflowId: 'wf-1',
                runId: '',
                error: 'invalid_payload',
            },
        });
    });

    test('delegates time-travel workflow replay and normalizes summary payload', async () => {
        const harness = createHarness({
            commandType: 'time_travel_workflow_run',
            payload: {
                workflowId: 'wf-1',
                runId: 'run-1',
                step: 'freeze-contract',
            },
            replayWorkflowRunTimeTravel: async (input) => ({
                success: true,
                workflowId: input.workflowId,
                runId: input.runId,
                status: 'completed',
                steps: input.steps,
                traceId: 'trace-1',
                sampled: true,
                result: { ok: true },
            }),
        });
        const handled = await handleEntrypointUtilityCommands(harness.deps);
        expect(handled).toBe(true);
        expect(harness.outgoing[0]).toEqual({
            type: 'current',
            payload: {
                success: true,
                workflowId: 'wf-1',
                runId: 'run-1',
                status: 'completed',
                steps: ['freeze-contract'],
                traceId: 'trace-1',
                sampled: true,
                result: { ok: true },
                error: null,
            },
        });
    });
});
