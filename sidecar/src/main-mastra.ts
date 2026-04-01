import * as readline from 'readline';
import * as path from 'path';
import { getMastraHealth } from './mastra';
import { handleApprovalResponse, handleUserMessage, rewindTaskContextCompression } from './ipc/streaming';
import { createMastraEntrypointProcessor } from './mastra/entrypoint';
import { createVoiceProviderBindings } from './mastra/runtimeBindings';
import { getVoicePlaybackState, stopVoicePlayback } from './tools/core/voice';
import { globalToolRegistry } from './tools/registry';
import { STANDARD_TOOLS } from './tools/standard';
import { createMastraAdditionalCommandHandler } from './mastra/additionalCommands';
import { createMastraSchedulerRuntime } from './mastra/schedulerRuntime';
import { disconnectMcpSafe } from './mastra/mcp/clients';
import { replayWorkflowRunTimeTravel } from './mastra/workflowReplay';
import { destroyWorkspaceRuntime } from './mastra/workspace/runtime';
import { buildSkillPromptFromStore } from './mastra/skillPrompt';
import { MastraTaskRuntimeStateStore } from './mastra/taskRuntimeStateStore';
import { MastraTaskTranscriptStore } from './mastra/taskTranscriptStore';
import { MastraRemoteSessionStore } from './mastra/remoteSessionStore';
import { MastraPolicyDecisionLogStore } from './mastra/policyDecisionLog';
import { MastraHookRuntimeStore, setHookRuntimeEventsEnabled } from './mastra/hookRuntime';
import { createMastraPolicyEngineFromEnv } from './mastra/policyEngine';
import { evaluateSkillPolicy } from './mastra/pluginPolicy';
import { loadRemoteSessionGovernancePolicy } from './mastra/remoteSessionGovernance';
const workspaceRoot = process.cwd();
const appDataRoot = process.env.COWORKANY_APP_DATA_DIR?.trim()
    || path.join(workspaceRoot, '.coworkany');
const additionalCommandRuntime = createMastraAdditionalCommandHandler({
    workspaceRoot,
    appDataRoot,
});
const taskStateStore = new MastraTaskRuntimeStateStore(
    path.join(appDataRoot, 'mastra-task-runtime-state.json'),
);
const taskTranscriptStore = new MastraTaskTranscriptStore(
    path.join(appDataRoot, 'mastra-task-transcript.json'),
);
const remoteSessionStore = new MastraRemoteSessionStore(
    path.join(appDataRoot, 'mastra-remote-sessions.json'),
);
const policyDecisionLog = new MastraPolicyDecisionLogStore(
    path.join(appDataRoot, 'mastra-policy-decisions.json'),
);
const hookRuntime = new MastraHookRuntimeStore(
    path.join(appDataRoot, 'mastra-hook-events.json'),
);
setHookRuntimeEventsEnabled(true);
const policyEngine = createMastraPolicyEngineFromEnv();
const remoteSessionGovernancePolicy = loadRemoteSessionGovernancePolicy(workspaceRoot);
function writeEvent(event: Record<string, unknown>): void {
    process.stdout.write(`${JSON.stringify(event)}\n`);
}
function readBoundedIntEnv(
    name: string,
    fallback: number,
    min: number,
    max: number,
): number {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    if (parsed < min) {
        return min;
    }
    if (parsed > max) {
        return max;
    }
    return parsed;
}
async function run(): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        crlfDelay: Infinity,
    });
    writeEvent({
        type: 'ready',
        runtime: 'mastra',
        health: getMastraHealth(),
    });
    let schedulerRuntime: ReturnType<typeof createMastraSchedulerRuntime> | null = null;
    const processor = createMastraEntrypointProcessor({
        handleUserMessage,
        handleApprovalResponse,
        getMastraHealth,
        stopVoicePlayback,
        getVoicePlaybackState,
        ...createVoiceProviderBindings({
            listEnabledSkills: () => additionalCommandRuntime.skillStore.listEnabled(),
            getToolByName: (toolName) => (
                globalToolRegistry.getTool(toolName)
                ?? STANDARD_TOOLS.find((tool) => tool.name === toolName)
            ),
            workspaceRoot,
        }),
        scheduleTaskIfNeeded: async (input) => {
            if (!schedulerRuntime) {
                return { scheduled: false };
            }
            return await schedulerRuntime.scheduleIfNeeded(input);
        },
        cancelScheduledTasksForSourceTask: async (input) => {
            if (!schedulerRuntime) {
                return {
                    success: false,
                    cancelledCount: 0,
                    cancelledTitles: [],
                };
            }
            return await schedulerRuntime.cancelBySourceTask(input);
        },
        handleAdditionalCommand: additionalCommandRuntime.handler,
        replayWorkflowRunTimeTravel: async (input) => {
            return await replayWorkflowRunTimeTravel(input);
        },
        policyGateResponseTimeoutMs: readBoundedIntEnv(
            'COWORKANY_POLICY_GATE_FORWARD_TIMEOUT_MS',
            30_000,
            10,
            300_000,
        ),
        policyGateTimeoutRetryCount: readBoundedIntEnv(
            'COWORKANY_POLICY_GATE_TIMEOUT_RETRY_COUNT',
            1,
            0,
            5,
        ),
        resolveSkillPrompt: ({ message, explicitEnabledSkills }) => {
            const policySnapshot = additionalCommandRuntime.getPluginPolicySnapshot();
            return buildSkillPromptFromStore(additionalCommandRuntime.skillStore, {
                userMessage: message,
                explicitEnabledSkills,
                isSkillAllowed: ({ skillId, isBuiltin }) => evaluateSkillPolicy(
                    { skillId, isBuiltin },
                    policySnapshot,
                ).allowed,
            });
        },
        taskTranscriptStore,
        rewindTaskContext: ({ taskId, userTurns }) => rewindTaskContextCompression({
            taskId,
            userTurns,
        }),
        policyEngine,
        policyDecisionLog,
        hookRuntime,
        taskStateStore,
        remoteSessionStore,
        remoteSessionGovernancePolicy,
    });
    schedulerRuntime = createMastraSchedulerRuntime({
        appDataRoot,
        deps: {
            handleUserMessage,
            resolveResourceIdForTask: (taskId) => processor.resolveResourceIdForTask(taskId),
            emitDesktopEventForTask: (taskId, event) => {
                processor.emitDesktopEventForTask(taskId, event, writeEvent);
            },
        },
    });
    schedulerRuntime.start();
    const inFlight = new Set<Promise<void>>();
    try {
        for await (const line of rl) {
            try {
                const parsed = JSON.parse(line) as unknown;
                let job: Promise<void>;
                job = processor
                    .processMessage(parsed, writeEvent)
                    .catch((error) => {
                        writeEvent({
                            type: 'error',
                            message: String(error),
                        });
                    })
                    .finally(() => {
                        inFlight.delete(job);
                    });
                inFlight.add(job);
            } catch (error) {
                writeEvent({
                    type: 'error',
                    message: String(error),
                });
            }
        }
    } finally {
        processor.close('stdin_closed');
        schedulerRuntime.stop();
        await destroyWorkspaceRuntime();
        await disconnectMcpSafe();
    }
    if (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
    }
}
run().catch((error) => {
    writeEvent({ type: 'error', message: String(error) });
    process.exitCode = 1;
});
