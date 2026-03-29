import * as readline from 'readline';
import * as path from 'path';
import { getMastraHealth } from './mastra';
import { handleApprovalResponse, handleUserMessage } from './ipc/streaming';
import { createMastraEntrypointProcessor } from './mastra/entrypoint';
import { createVoiceProviderBindings } from './mastra/runtimeBindings';
import { getVoicePlaybackState, stopVoicePlayback } from './tools/core/voice';
import { globalToolRegistry } from './tools/registry';
import { STANDARD_TOOLS } from './tools/standard';
import { createMastraAdditionalCommandHandler } from './mastra/additionalCommands';
import { createMastraSchedulerRuntime } from './mastra/schedulerRuntime';

const workspaceRoot = process.cwd();
const appDataRoot = process.env.COWORKANY_APP_DATA_DIR?.trim()
    || path.join(workspaceRoot, '.coworkany');
const additionalCommandRuntime = createMastraAdditionalCommandHandler({
    workspaceRoot,
    appDataRoot,
});

function writeEvent(event: Record<string, unknown>): void {
    process.stdout.write(`${JSON.stringify(event)}\n`);
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
        schedulerRuntime.stop();
    }

    if (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
    }
}

run().catch((error) => {
    writeEvent({ type: 'error', message: String(error) });
    process.exitCode = 1;
});
