import * as readline from 'readline';
import * as path from 'path';
import { getMastraHealth } from './mastra';
import { handleApprovalResponse, handleUserMessage, rewindTaskContextCompression, warmupChatRuntime } from './ipc/streaming';
import { createMastraEntrypointProcessor } from './mastra/entrypoint';
import { createVoiceProviderBindings } from './mastra/runtimeBindings';
import { configureVoiceProviders, getVoicePlaybackState, stopVoicePlayback } from './tools/core/voice';
import { createMastraAdditionalCommandHandler } from './mastra/additionalCommands';
import { createMastraSchedulerRuntime } from './mastra/schedulerRuntime';
import {
    disconnectMcpSafe,
    getMcpConnectionSnapshot,
    getMcpSecuritySnapshot,
    isMcpEnabled,
    listMcpToolsetsSafe,
} from './mastra/mcp/clients';
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
import { createMastraTaskExecutionService } from './mastra/taskExecutionService';
import { resolveRuntimeAppDataRoot, seedRuntimeLlmEnvFromConfig } from './config/runtimeConfig';
import { resolveRuntimeInternalTool } from './mastra/internalToolResolver';
import { ensureProxyEnvForLlmPath } from './mastra/proxyRuntime';
import {
    buildInternalRuntimeToolsets,
    countToolsInToolsets,
    describeRuntimeToolpackState,
} from './mastra/runtimeToolCatalog';
import { resolveVoiceProviderMastraToolDefinition } from './mastra/voiceProviderToolResolver';
const workspaceRoot = process.cwd();
const appDataRoot = resolveRuntimeAppDataRoot({ cwd: workspaceRoot });
const llmEnvSeedResult = seedRuntimeLlmEnvFromConfig({
    cwd: workspaceRoot,
    env: process.env,
});
if (llmEnvSeedResult.seededKeys.length > 0) {
    console.info('[coworkany-runtime-config] seeded llm env from config', {
        path: llmEnvSeedResult.loadedFromPath,
        provider: llmEnvSeedResult.provider,
        modelId: llmEnvSeedResult.modelId,
        seededKeys: llmEnvSeedResult.seededKeys,
    });
}
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
const taskExecutionService = createMastraTaskExecutionService();
const schedulerDisabled = /^(1|true|yes|on)$/i.test(
    (process.env.COWORKANY_DISABLE_SCHEDULER ?? '').trim(),
);
const listEnabledSkills = () => additionalCommandRuntime.skillStore.listEnabled();
const getVoiceProviderToolByName = (toolName: string) => resolveVoiceProviderMastraToolDefinition(toolName);

configureVoiceProviders({
    listEnabledSkills,
    getToolByName: getVoiceProviderToolByName,
});

function resolveInternalToolDefinition(toolName: string) {
    return resolveRuntimeInternalTool(toolName);
}

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
    await ensureProxyEnvForLlmPath();
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
            listEnabledSkills,
            getToolByName: getVoiceProviderToolByName,
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
        listRuntimeCapabilities: async () => {
            const [mcpSecuritySnapshot, mcpToolsets] = await Promise.all([
                Promise.resolve(getMcpSecuritySnapshot()),
                listMcpToolsetsSafe().catch(() => ({})),
            ]);
            return {
                skills: additionalCommandRuntime.skillStore.list().map((skill) => ({
                    id: skill.manifest.name,
                    name: skill.manifest.name,
                    enabled: skill.enabled,
                    description: skill.manifest.description,
                })),
                toolpacks: additionalCommandRuntime.toolpackStore.list().map((toolpack) => {
                    const runtimeDescriptor = describeRuntimeToolpackState({
                        toolpack,
                        resolveTool: resolveInternalToolDefinition,
                        mcpToolsets,
                        mcpAllowedServerIds: mcpSecuritySnapshot.allowedServerIds,
                        mcpBlockedServerIds: mcpSecuritySnapshot.blockedServerIds,
                    });
                    return {
                        id: toolpack.manifest.id ?? toolpack.manifest.name,
                        name: toolpack.manifest.name,
                        enabled: toolpack.enabled,
                        description: toolpack.manifest.description,
                        tools: toolpack.manifest.tools ?? [],
                        runtimeStatus: runtimeDescriptor.status,
                        callableToolCount: runtimeDescriptor.callableToolCount,
                        unresolvedTools: runtimeDescriptor.unresolvedTools,
                        blockedReason: runtimeDescriptor.blockedReason,
                    };
                }),
            };
        },
        listRuntimeToolsets: async () => {
            const [mcpToolsets, internalToolsets] = await Promise.all([
                listMcpToolsetsSafe(),
                Promise.resolve(buildInternalRuntimeToolsets({
                    toolpacks: additionalCommandRuntime.toolpackStore.listEnabled(),
                    resolveTool: resolveInternalToolDefinition,
                })),
            ]);
            return {
                ...(mcpToolsets as Record<string, Record<string, unknown>>),
                ...internalToolsets,
            };
        },
        isRuntimeMcpEnabled: () => isMcpEnabled(),
        getRuntimeMcpSnapshot: () => {
            const snapshot = getMcpConnectionSnapshot();
            const securitySnapshot = getMcpSecuritySnapshot();
            const hasAllowedServers = securitySnapshot.allowedServerIds.length > 0;
            const inferredStatus = (
                snapshot.status === 'ready'
                && hasAllowedServers
                && snapshot.cachedToolCount === 0
            )
                ? 'degraded'
                : snapshot.status;
            return {
                enabled: snapshot.enabled,
                status: inferredStatus,
                cachedToolCount: snapshot.cachedToolCount,
                cachedToolsetCount: snapshot.cachedToolsetCount,
                allowedServerCount: securitySnapshot.allowedServerIds.length,
                runtimeToolCount: countToolsInToolsets(buildInternalRuntimeToolsets({
                    toolpacks: additionalCommandRuntime.toolpackStore.listEnabled(),
                    resolveTool: resolveInternalToolDefinition,
                })),
            };
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
        executeTaskMessage: taskExecutionService.executeTaskMessage,
        warmupChatRuntime,
    });
    if (!schedulerDisabled) {
        schedulerRuntime = createMastraSchedulerRuntime({
            appDataRoot,
            deps: {
                handleUserMessage,
                resolveResourceIdForTask: (taskId) => processor.resolveResourceIdForTask(taskId),
                emitDesktopEventForTask: (taskId, event) => processor.emitDesktopEventForTask(taskId, event, writeEvent),
            },
        });
        schedulerRuntime.start();
    }
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
        schedulerRuntime?.stop();
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
