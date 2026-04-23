import { describe, expect, test } from 'bun:test';
import { createTaskTurnEventStateStore } from '../src/mastra/taskTurnEventStateStore';

function normalizeStringList(values: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed || seen.has(trimmed)) {
            continue;
        }
        seen.add(trimmed);
        normalized.push(trimmed);
    }
    return normalized;
}

function createStore() {
    const taskTurnEventStates = new Map();
    const latestCommandInvocationByTaskId = new Map<string, string>();
    const latestCommandRecoveryHintByTaskId = new Map();
    const latestCommandFailureInfoByTaskId = new Map();

    return createTaskTurnEventStateStore({
        taskTurnEventStates,
        latestCommandInvocationByTaskId,
        latestCommandRecoveryHintByTaskId,
        latestCommandFailureInfoByTaskId,
        taskTurnEventStateTtlMs: 60_000,
        maxTaskTurnEventStates: 100,
        taskExecutionNarrationMaxSuppressChars: 120,
        normalizeStringList,
        normalizeTaskMessageFingerprint: (value) => value.trim().toLowerCase(),
        isLikelyTaskMetaReasoningChunk: (value) => /analysis/i.test(value),
        isLikelyTaskExecutionNarrationChunk: (value) => /我来|i will|next/i.test(value),
        nowMs: () => 1_000,
    });
}

describe('taskTurnEventStateStore', () => {
    test('builds turn event state key with turn id and run id fallback', () => {
        const store = createStore();
        expect(store.buildTaskTurnEventStateKey({ taskId: 'task-1', turnId: 'turn-1' })).toBe('task-1:turn-1');
        expect(store.buildTaskTurnEventStateKey({ taskId: 'task-1', runId: 'run-1' })).toBe('task-1:run:run-1');
        expect(store.buildTaskTurnEventStateKey({ taskId: 'task-1' })).toBe('task-1:unknown');
    });

    test('keeps existing contract lock when incoming hash drifts', () => {
        const store = createStore();
        const key = 'task-1:turn-1';

        store.setTaskTurnCompletionRequirement({
            key,
            requireToolEvidence: true,
            requiredCompletionCapabilities: ['web_research'],
            turnContractHash: 'hash-1',
            turnContractDomain: 'market',
            routeMode: 'task',
            executionPath: 'workflow',
        });

        store.setTaskTurnCompletionRequirement({
            key,
            requireToolEvidence: true,
            requiredCompletionCapabilities: ['artifact_write'],
            turnContractHash: 'hash-2',
            turnContractDomain: 'general',
            routeMode: 'chat',
            executionPath: 'direct',
        });

        expect(store.getTaskTurnContractDomain(key)).toBe('market');
        expect(store.getTaskTurnRouteMode(key)).toBe('task');
        expect(store.getTaskTurnRequiredCompletionCapabilities(key)).toEqual(['artifact_write']);
    });

    test('tracks completion capabilities and missing capabilities', () => {
        const store = createStore();
        const key = 'task-2:turn-1';

        store.setTaskTurnCompletionRequirement({
            key,
            requireToolEvidence: true,
            requiredCompletionCapabilities: ['web_research', 'artifact_write'],
        });
        expect(store.hasTaskTurnSatisfiedCompletionEvidence(key)).toBe(false);

        store.markTaskTurnToolEvidence({
            key,
            evidenceStrength: 'weak',
            toolName: 'search_web',
            satisfiedCompletionCapabilities: ['web_research'],
            resultAttemptedCompletionCapabilities: ['web_research'],
            toolResultSeen: true,
        });

        expect(store.getTaskTurnObservedToolNames(key)).toEqual(['search_web']);
        expect(store.getTaskTurnMissingRequiredCompletionCapabilities(key)).toEqual(['artifact_write']);
        expect(store.hasTaskTurnToolResultEvidence(key)).toBe(true);

        store.markTaskTurnToolEvidence({
            key,
            evidenceStrength: 'strong',
            satisfiedCompletionCapabilities: ['artifact_write'],
        });

        expect(store.getTaskTurnMissingRequiredCompletionCapabilities(key)).toEqual([]);
        expect(store.hasTaskTurnSatisfiedCompletionEvidence(key)).toBe(true);
    });

    test('terminal suppression follows complete/error precedence rules', () => {
        const store = createStore();
        const key = 'task-3:turn-1';

        expect(store.hasTaskTurnTerminalEvent(key)).toBe(false);
        expect(store.shouldSuppressTaskTurnTerminalEvent(key, 'error')).toBe(false);

        store.markTaskTurnTerminalEvent(key, 'error');
        expect(store.hasTaskTurnTerminalEvent(key)).toBe(true);
        expect(store.shouldSuppressTaskTurnTerminalEvent(key, 'error')).toBe(true);
        expect(store.shouldSuppressTaskTurnTerminalEvent(key, 'complete')).toBe(false);

        store.markTaskTurnTerminalEvent(key, 'complete');
        expect(store.shouldSuppressTaskTurnTerminalEvent(key, 'error')).toBe(true);
        expect(store.shouldSuppressTaskTurnTerminalEvent(key, 'complete')).toBe(true);
    });

    test('reset clears attempt stream state but keeps completion requirement lock', () => {
        const store = createStore();
        const key = 'task-4:turn-1';

        store.setTaskTurnCompletionRequirement({
            key,
            requireToolEvidence: true,
            requiredCompletionCapabilities: ['command_execution'],
            turnContractHash: 'hash-1',
            turnContractDomain: 'general',
            routeMode: 'task',
        });
        store.markTaskTurnAssistantNarrative({ key, content: 'Working...' });
        store.markTaskTurnToolEvidence({ key, toolName: 'run_command', evidenceStrength: 'strong' });
        store.markTaskTurnTerminalEvent(key, 'complete');

        store.resetTaskTurnAttemptStreamState(key);

        expect(store.hasTaskTurnAssistantNarrative(key)).toBe(false);
        expect(store.getTaskTurnAssistantNarrativeChars(key)).toBe(0);
        expect(store.getTaskTurnObservedToolNames(key)).toEqual([]);
        expect(store.hasTaskTurnTerminalEvent(key)).toBe(false);
        expect(store.hasTaskTurnToolEvidenceRequirement(key)).toBe(true);
        expect(store.getTaskTurnRequiredCompletionCapabilities(key)).toEqual(['command_execution']);
        expect(store.getTaskTurnRouteMode(key)).toBe('task');
    });

    test('falls back to task-level command diagnostics when per-turn state is absent', () => {
        const store = createStore();

        store.markTaskTurnCommandInvocation({
            key: 'task-5:turn-a',
            taskId: 'task-5',
            command: 'rg --files',
        });
        store.markTaskTurnCommandRecoveryHint({
            key: 'task-5:turn-a',
            taskId: 'task-5',
            hint: {
                failedCommand: 'rg --files',
                retryCommands: ['rg --files src'],
                probeCommands: ['pwd'],
            },
        });
        store.markTaskTurnCommandFailureInfo({
            key: 'task-5:turn-a',
            taskId: 'task-5',
            info: {
                failedCommand: 'rg --files',
                stderrSnippet: 'permission denied',
            },
        });

        expect(store.getTaskLatestCommandInvocation('task-5:turn-b', 'task-5')).toBe('rg --files');
        expect(store.getTaskTurnCommandRecoveryHint('task-5:turn-b', 'task-5')?.retryCommands).toEqual(['rg --files src']);
        expect(store.getTaskTurnCommandFailureInfo('task-5:turn-b', 'task-5')?.stderrSnippet).toBe('permission denied');
    });
});
