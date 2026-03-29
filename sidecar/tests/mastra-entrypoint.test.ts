import { describe, expect, test } from 'bun:test';
import { createMastraEntrypointProcessor } from '../src/mastra/entrypoint';
import type { DesktopEvent } from '../src/ipc/bridge';

type UserMessageCall = {
    message: string;
    threadId: string;
    resourceId: string;
};

type ApprovalCall = {
    runId: string;
    toolCallId: string;
    approved: boolean;
};

function createHarness(overrides?: {
    onHandleUserMessage?: (
        input: UserMessageCall,
        emit: (event: DesktopEvent) => void,
    ) => Promise<{ runId: string }>;
    onHandleApprovalResponse?: (
        input: ApprovalCall,
        emit: (event: DesktopEvent) => void,
    ) => Promise<void>;
    onOutgoing?: (
        message: Record<string, unknown>,
        injectIncoming: (command: Record<string, unknown>) => Promise<void>,
    ) => void | Promise<void>;
    stopVoicePlaybackResult?: boolean;
    voiceState?: Record<string, unknown>;
    voiceProviderStatus?: Record<string, unknown>;
    transcribeResult?: Record<string, unknown>;
    onAdditionalCommand?: (
        command: Record<string, unknown>,
    ) => Promise<Record<string, unknown> | null>;
    onScheduleTaskIfNeeded?: (input: {
        sourceTaskId: string;
        title?: string;
        message: string;
        workspacePath: string;
        config?: Record<string, unknown>;
    }) => Promise<{
        scheduled: boolean;
        summary?: string;
        error?: string;
    }>;
    onCancelScheduledTasksForSourceTask?: (input: {
        sourceTaskId: string;
        userMessage: string;
    }) => Promise<{
        success: boolean;
        cancelledCount: number;
        cancelledTitles: string[];
    }>;
}) {
    const outgoing: Array<Record<string, unknown>> = [];
    const userMessageCalls: UserMessageCall[] = [];
    const approvalCalls: ApprovalCall[] = [];

    const processor = createMastraEntrypointProcessor({
        handleUserMessage: async (message, threadId, resourceId, emit) => {
            const input = { message, threadId, resourceId };
            userMessageCalls.push(input);
            if (overrides?.onHandleUserMessage) {
                return await overrides.onHandleUserMessage(input, emit);
            }
            emit({
                type: 'text_delta',
                runId: 'run-default',
                content: 'default reply',
            });
            emit({
                type: 'complete',
                runId: 'run-default',
                finishReason: 'stop',
            });
            return { runId: 'run-default' };
        },
        handleApprovalResponse: async (runId, toolCallId, approved, emit) => {
            const input = { runId, toolCallId, approved };
            approvalCalls.push(input);
            if (overrides?.onHandleApprovalResponse) {
                await overrides.onHandleApprovalResponse(input, emit);
                return;
            }
            emit({
                type: 'complete',
                runId,
                finishReason: approved ? 'stop' : 'declined',
            });
        },
        getMastraHealth: () => ({
            agents: ['coworker', 'supervisor'],
            workflows: ['controlPlane'],
            storageConfigured: true,
        }),
        stopVoicePlayback: async () => overrides?.stopVoicePlaybackResult ?? true,
        getVoicePlaybackState: () => overrides?.voiceState ?? {
            isSpeaking: false,
            canStop: false,
        },
        getVoiceProviderStatus: () => overrides?.voiceProviderStatus ?? {
            preferredAsr: 'system',
            preferredTts: 'system',
            hasCustomAsr: false,
            hasCustomTts: false,
            providers: {
                asr: [],
                tts: [],
            },
        },
        transcribeWithCustomAsr: async () => overrides?.transcribeResult ?? {
            success: false,
            error: 'transcription_unavailable',
        },
        handleAdditionalCommand: async (command) => {
            if (!overrides?.onAdditionalCommand) {
                return null;
            }
            return await overrides.onAdditionalCommand(command as Record<string, unknown>);
        },
        scheduleTaskIfNeeded: async (input) => {
            if (!overrides?.onScheduleTaskIfNeeded) {
                return { scheduled: false };
            }
            return await overrides.onScheduleTaskIfNeeded(input);
        },
        cancelScheduledTasksForSourceTask: async (input) => {
            if (!overrides?.onCancelScheduledTasksForSourceTask) {
                return {
                    success: false,
                    cancelledCount: 0,
                    cancelledTitles: [],
                };
            }
            return await overrides.onCancelScheduledTasksForSourceTask(input);
        },
        getNowIso: () => '2026-03-30T00:00:00.000Z',
        createId: () => 'req-fixed',
    });

    const emit = (message: Record<string, unknown>) => {
        outgoing.push(message);
        if (overrides?.onOutgoing) {
            void overrides.onOutgoing(message, async (command) => {
                await processor.processMessage(command, emit);
            });
        }
    };

    return {
        outgoing,
        userMessageCalls,
        approvalCalls,
        process: async (command: Record<string, unknown>) => {
            await processor.processMessage(command, emit);
        },
    };
}

describe('mastra entrypoint processor', () => {
    test('start_task maps to handleUserMessage and emits protocol response + task events', async () => {
        const harness = createHarness();
        await harness.process({
            id: 'cmd-start',
            type: 'start_task',
            payload: {
                taskId: 'task-1',
                title: 'demo',
                userQuery: 'hello',
                context: { workspacePath: '/tmp/workspace' },
            },
        });

        expect(harness.userMessageCalls.length).toBe(1);
        expect(harness.userMessageCalls[0]?.threadId).toBe('task-1');
        expect(harness.userMessageCalls[0]?.resourceId).toBe('employee-task-1');
        expect(
            harness.outgoing.some(
                (message) =>
                    message.type === 'start_task_response'
                    && (message.payload as Record<string, unknown>)?.success === true,
            ),
        ).toBe(true);
        expect(harness.outgoing.some((message) => message.type === 'TASK_STARTED')).toBe(true);
        expect(harness.outgoing.some((message) => message.type === 'TEXT_DELTA')).toBe(true);
        expect(harness.outgoing.some((message) => message.type === 'TASK_FINISHED')).toBe(true);
    });

    test('send_task_message routes to existing task thread and emits response', async () => {
        const harness = createHarness();
        await harness.process({
            id: 'cmd-followup',
            type: 'send_task_message',
            payload: {
                taskId: 'task-2',
                content: 'continue',
            },
        });

        expect(harness.userMessageCalls.length).toBe(1);
        expect(harness.userMessageCalls[0]?.threadId).toBe('task-2');
        expect(harness.userMessageCalls[0]?.message).toBe('continue');
        expect(
            harness.outgoing.some(
                (message) =>
                    message.type === 'send_task_message_response'
                    && (message.payload as Record<string, unknown>)?.success === true,
            ),
        ).toBe(true);
    });

    test('token usage desktop events are forwarded as TOKEN_USAGE payloads', async () => {
        const harness = createHarness({
            onHandleUserMessage: async (_input, emit) => {
                emit({
                    type: 'token_usage',
                    runId: 'run-token',
                    modelId: 'anthropic/claude-sonnet-4-5',
                    provider: 'anthropic',
                    usage: {
                        inputTokens: 11,
                        outputTokens: 7,
                        totalTokens: 18,
                        cacheCreationInputTokens: 3,
                        cacheReadInputTokens: 2,
                    },
                });
                emit({
                    type: 'complete',
                    runId: 'run-token',
                    finishReason: 'stop',
                });
                return { runId: 'run-token' };
            },
        });

        await harness.process({
            id: 'cmd-token-usage',
            type: 'start_task',
            payload: {
                taskId: 'task-token',
                userQuery: 'count tokens',
            },
        });

        const tokenUsage = harness.outgoing.find((message) => message.type === 'TOKEN_USAGE');
        expect(tokenUsage).toBeDefined();
        expect(tokenUsage?.taskId).toBe('task-token');
        expect(tokenUsage?.payload).toMatchObject({
            inputTokens: 11,
            outputTokens: 7,
            modelId: 'anthropic/claude-sonnet-4-5',
            provider: 'anthropic',
        });
    });

    test('approval_required maps to EFFECT_REQUESTED and report_effect_result resumes run', async () => {
        const harness = createHarness({
            onHandleUserMessage: async (_input, emit) => {
                emit({
                    type: 'approval_required',
                    runId: 'run-approval',
                    toolCallId: 'tool-1',
                    toolName: 'bash_approval',
                    args: { command: 'rm -rf /tmp/demo' },
                    resumeSchema: '{}',
                });
                return { runId: 'run-approval' };
            },
        });

        await harness.process({
            id: 'cmd-approval',
            type: 'start_task',
            payload: {
                taskId: 'task-3',
                userQuery: 'dangerous op',
            },
        });

        const effectRequested = harness.outgoing.find((message) => message.type === 'EFFECT_REQUESTED');
        expect(effectRequested).toBeDefined();
        const requestId = ((effectRequested?.payload as Record<string, unknown>)?.request as Record<string, unknown>)?.id;
        expect(requestId).toBe('req-fixed');

        await harness.process({
            id: 'cmd-report-effect',
            type: 'report_effect_result',
            payload: {
                requestId,
                success: true,
            },
        });

        expect(harness.approvalCalls.length).toBe(1);
        expect(harness.approvalCalls[0]).toEqual({
            runId: 'run-approval',
            toolCallId: 'tool-1',
            approved: true,
        });
        expect(
            harness.outgoing.some(
                (message) =>
                    message.type === 'report_effect_result_response'
                    && (message.payload as Record<string, unknown>)?.success === true,
            ),
        ).toBe(true);
    });

    test('report_effect_result returns not-found when request id is unknown', async () => {
        const harness = createHarness();
        await harness.process({
            id: 'cmd-report-effect-missing',
            type: 'report_effect_result',
            payload: {
                requestId: 'missing',
                success: true,
            },
        });

        expect(harness.approvalCalls.length).toBe(0);
        const response = harness.outgoing.find((message) => message.type === 'report_effect_result_response');
        expect(response).toBeDefined();
        const payload = response?.payload as Record<string, unknown>;
        expect(payload.success).toBe(false);
        expect(payload.error).toBe('approval_request_not_found');
    });

    test('supports legacy simple commands for health_check and user_message', async () => {
        const harness = createHarness();
        await harness.process({ type: 'health_check' });
        expect(harness.outgoing.some((message) => message.type === 'health')).toBe(true);

        await harness.process({
            type: 'user_message',
            message: 'hello',
            threadId: 'thread-simple',
            resourceId: 'res-simple',
        });
        expect(harness.userMessageCalls.length).toBe(1);
        expect(harness.userMessageCalls[0]?.threadId).toBe('thread-simple');
        expect(harness.userMessageCalls[0]?.resourceId).toBe('res-simple');
    });

    test('bootstrap_runtime_context + get_runtime_snapshot return protocol-compatible snapshot payload', async () => {
        const harness = createHarness();

        await harness.process({
            id: 'cmd-bootstrap',
            type: 'bootstrap_runtime_context',
            payload: {
                runtimeContext: {
                    platform: 'darwin',
                },
            },
        });
        await harness.process({
            id: 'cmd-start',
            type: 'start_task',
            payload: {
                taskId: 'task-snapshot',
                title: 'snapshot',
                userQuery: 'hello snapshot',
                context: { workspacePath: '/tmp/ws-snapshot' },
            },
        });
        await harness.process({
            id: 'cmd-snapshot',
            type: 'get_runtime_snapshot',
            payload: {},
        });

        const bootstrapResponse = harness.outgoing.find((message) => message.type === 'bootstrap_runtime_context_response');
        expect(bootstrapResponse).toBeDefined();
        expect((bootstrapResponse?.payload as Record<string, unknown>)?.success).toBe(true);

        const snapshotResponse = harness.outgoing.find((message) => message.type === 'get_runtime_snapshot_response');
        expect(snapshotResponse).toBeDefined();
        const snapshotPayload = (snapshotResponse?.payload as Record<string, unknown>)?.snapshot as Record<string, unknown>;
        expect((snapshotResponse?.payload as Record<string, unknown>)?.success).toBe(true);
        expect(snapshotPayload.count).toBe(1);
        const tasks = snapshotPayload.tasks as Array<Record<string, unknown>>;
        expect(tasks[0]?.taskId).toBe('task-snapshot');
        expect(tasks[0]?.workspacePath).toBe('/tmp/ws-snapshot');
    });

    test('resume_interrupted_task replays the last user message for the same task', async () => {
        const harness = createHarness();
        await harness.process({
            id: 'cmd-start-resume',
            type: 'start_task',
            payload: {
                taskId: 'task-resume',
                userQuery: 'keep this context',
                context: { workspacePath: '/tmp/ws-resume' },
            },
        });

        await harness.process({
            id: 'cmd-resume',
            type: 'resume_interrupted_task',
            payload: {
                taskId: 'task-resume',
            },
        });

        expect(harness.userMessageCalls.length).toBe(2);
        expect(harness.userMessageCalls[1]?.threadId).toBe('task-resume');
        expect(harness.userMessageCalls[1]?.message).toBe('keep this context');
        const response = harness.outgoing.find((message) => message.type === 'resume_interrupted_task_response');
        expect(response).toBeDefined();
        expect((response?.payload as Record<string, unknown>)?.success).toBe(true);
    });

    test('get_tasks returns workspace-scoped task list', async () => {
        const harness = createHarness();
        await harness.process({
            id: 'cmd-start-a',
            type: 'start_task',
            payload: {
                taskId: 'task-a',
                title: 'A',
                userQuery: 'a',
                context: { workspacePath: '/tmp/ws-a' },
            },
        });
        await harness.process({
            id: 'cmd-start-b',
            type: 'start_task',
            payload: {
                taskId: 'task-b',
                title: 'B',
                userQuery: 'b',
                context: { workspacePath: '/tmp/ws-b' },
            },
        });

        await harness.process({
            id: 'cmd-get-tasks',
            type: 'get_tasks',
            payload: {
                workspacePath: '/tmp/ws-a',
            },
        });

        const response = harness.outgoing.find((message) => message.type === 'get_tasks_response');
        expect(response).toBeDefined();
        const payload = response?.payload as Record<string, unknown>;
        expect(payload.success).toBe(true);
        expect(payload.count).toBe(1);
        const tasks = payload.tasks as Array<Record<string, unknown>>;
        expect(tasks[0]?.taskId).toBe('task-a');
    });

    test('start_task returns scheduled confirmation when scheduler accepts the request', async () => {
        const harness = createHarness({
            onScheduleTaskIfNeeded: async () => ({
                scheduled: true,
                summary: '已安排在 03/30 10:00:00 执行：提醒我喝水。',
            }),
        });

        await harness.process({
            id: 'cmd-scheduled-start',
            type: 'start_task',
            payload: {
                taskId: 'task-scheduled',
                title: 'hydration',
                userQuery: '10分钟后提醒我喝水',
                context: { workspacePath: '/tmp/ws-scheduled' },
            },
        });

        expect(harness.userMessageCalls.length).toBe(0);
        const response = harness.outgoing.find((message) => message.type === 'start_task_response');
        expect((response?.payload as Record<string, unknown>)?.success).toBe(true);
        const summaryDelta = harness.outgoing.find((message) =>
            message.type === 'TEXT_DELTA'
            && (message.payload as Record<string, unknown>)?.delta === '已安排在 03/30 10:00:00 执行：提醒我喝水。',
        );
        expect(summaryDelta).toBeDefined();
        const finished = harness.outgoing.find((message) => message.type === 'TASK_FINISHED');
        expect((finished?.payload as Record<string, unknown>)?.finishReason).toBe('scheduled');
    });

    test('send_task_message can cancel scheduled tasks via cancellation intent', async () => {
        const harness = createHarness({
            onCancelScheduledTasksForSourceTask: async () => ({
                success: true,
                cancelledCount: 2,
                cancelledTitles: ['提醒喝水', '站起来活动'],
            }),
        });

        await harness.process({
            id: 'cmd-cancel-scheduled',
            type: 'send_task_message',
            payload: {
                taskId: 'task-cancel',
                content: '取消这个定时任务',
            },
        });

        expect(harness.userMessageCalls.length).toBe(0);
        const response = harness.outgoing.find((message) => message.type === 'send_task_message_response');
        expect((response?.payload as Record<string, unknown>)?.success).toBe(true);
        const summaryDelta = harness.outgoing.find((message) =>
            message.type === 'TEXT_DELTA'
            && (message.payload as Record<string, unknown>)?.delta === '已取消 2 个定时任务。',
        );
        expect(summaryDelta).toBeDefined();
    });

    test('uses bootstrap runtime resourceId as memory scope fallback', async () => {
        const harness = createHarness();
        await harness.process({
            id: 'cmd-bootstrap-resource',
            type: 'bootstrap_runtime_context',
            payload: {
                runtimeContext: {
                    platform: 'darwin',
                    resourceId: 'employee-shared',
                },
            },
        });
        await harness.process({
            id: 'cmd-start-resource',
            type: 'start_task',
            payload: {
                taskId: 'task-memory-scope',
                title: 'memory scope',
                userQuery: 'remember my preference',
                context: { workspacePath: '/tmp/ws-memory' },
            },
        });

        expect(harness.userMessageCalls.length).toBe(1);
        expect(harness.userMessageCalls[0]?.resourceId).toBe('employee-shared');
    });

    test('voice commands return protocol-compatible responses', async () => {
        const harness = createHarness({
            stopVoicePlaybackResult: true,
            voiceState: {
                isSpeaking: false,
                canStop: false,
                reason: 'user_requested',
            },
            voiceProviderStatus: {
                preferredAsr: 'custom',
                preferredTts: 'system',
                hasCustomAsr: true,
                hasCustomTts: false,
                providers: {
                    asr: [{ id: 'asr-1' }],
                    tts: [],
                },
            },
            transcribeResult: {
                success: true,
                text: 'hello world',
                providerId: 'asr-1',
            },
        });

        await harness.process({
            id: 'cmd-voice-state',
            type: 'get_voice_state',
            payload: {},
        });
        await harness.process({
            id: 'cmd-stop-voice',
            type: 'stop_voice',
            payload: {},
        });
        await harness.process({
            id: 'cmd-provider-status',
            type: 'get_voice_provider_status',
            payload: {
                providerMode: 'auto',
            },
        });
        await harness.process({
            id: 'cmd-transcribe',
            type: 'transcribe_voice',
            payload: {
                audioBase64: 'ZGVtby1hdWRpbw==',
                mimeType: 'audio/wav',
            },
        });

        const stateResponse = harness.outgoing.find((message) => message.type === 'get_voice_state_response');
        expect((stateResponse?.payload as Record<string, unknown>)?.success).toBe(true);
        expect(((stateResponse?.payload as Record<string, unknown>)?.state as Record<string, unknown>)?.isSpeaking).toBe(false);

        const stopResponse = harness.outgoing.find((message) => message.type === 'stop_voice_response');
        expect((stopResponse?.payload as Record<string, unknown>)?.success).toBe(true);
        expect((stopResponse?.payload as Record<string, unknown>)?.stopped).toBe(true);

        const providerResponse = harness.outgoing.find((message) => message.type === 'get_voice_provider_status_response');
        expect((providerResponse?.payload as Record<string, unknown>)?.success).toBe(true);
        expect((providerResponse?.payload as Record<string, unknown>)?.preferredAsr).toBe('custom');

        const transcribeResponse = harness.outgoing.find((message) => message.type === 'transcribe_voice_response');
        expect((transcribeResponse?.payload as Record<string, unknown>)?.success).toBe(true);
        expect((transcribeResponse?.payload as Record<string, unknown>)?.text).toBe('hello world');
    });

    test('autonomous command family returns mastra unsupported payloads with stable shapes', async () => {
        const harness = createHarness();
        await harness.process({
            id: 'cmd-start-auto',
            type: 'start_autonomous_task',
            payload: {
                taskId: 'auto-1',
                query: 'run async',
            },
        });
        await harness.process({
            id: 'cmd-auto-status',
            type: 'get_autonomous_task_status',
            payload: {
                taskId: 'auto-1',
            },
        });
        await harness.process({
            id: 'cmd-auto-list',
            type: 'list_autonomous_tasks',
            payload: {},
        });

        const startResponse = harness.outgoing.find((message) => message.type === 'start_autonomous_task_response');
        expect((startResponse?.payload as Record<string, unknown>)?.success).toBe(false);
        expect((startResponse?.payload as Record<string, unknown>)?.taskId).toBe('auto-1');
        expect((startResponse?.payload as Record<string, unknown>)?.error).toBe('unsupported_in_mastra_runtime');

        const statusResponse = harness.outgoing.find((message) => message.type === 'get_autonomous_task_status_response');
        expect((statusResponse?.payload as Record<string, unknown>)?.success).toBe(false);
        expect((statusResponse?.payload as Record<string, unknown>)?.task).toBe(null);
        expect((statusResponse?.payload as Record<string, unknown>)?.error).toBe('unsupported_in_mastra_runtime');

        const listResponse = harness.outgoing.find((message) => message.type === 'list_autonomous_tasks_response');
        expect((listResponse?.payload as Record<string, unknown>)?.success).toBe(false);
        expect((listResponse?.payload as Record<string, unknown>)?.error).toBe('unsupported_in_mastra_runtime');
        expect((listResponse?.payload as Record<string, unknown>)?.tasks).toEqual([]);
    });

    test('delegates unknown commands to additional command handler when provided', async () => {
        const harness = createHarness({
            onAdditionalCommand: async (command) => {
                if (command.type !== 'list_workspaces') {
                    return null;
                }
                return {
                    commandId: command.id,
                    timestamp: '2026-03-30T00:00:00.000Z',
                    type: 'list_workspaces_response',
                    payload: {
                        workspaces: [],
                    },
                };
            },
        });

        await harness.process({
            id: 'cmd-list-workspaces',
            type: 'list_workspaces',
            payload: {},
        });

        const response = harness.outgoing.find((message) => message.type === 'list_workspaces_response');
        expect(response).toBeDefined();
        expect((response?.payload as Record<string, unknown>)?.workspaces).toEqual([]);
    });

    test('forwards read_file and returns forwarded response payload', async () => {
        const harness = createHarness({
            onOutgoing: async (message, injectIncoming) => {
                if (message.type !== 'read_file') {
                    return;
                }
                const forwardedId = message.id;
                expect(typeof forwardedId).toBe('string');
                await injectIncoming({
                    type: 'read_file_response',
                    commandId: forwardedId,
                    payload: {
                        success: true,
                        content: 'hello',
                    },
                });
            },
        });

        await harness.process({
            id: 'cmd-read-file',
            type: 'read_file',
            payload: {
                path: '/tmp/demo.txt',
            },
        });

        const response = harness.outgoing.find((message) => message.type === 'read_file_response');
        expect(response).toBeDefined();
        expect(response?.commandId).toBe('cmd-read-file');
        expect((response?.payload as Record<string, unknown>)?.success).toBe(true);
        expect((response?.payload as Record<string, unknown>)?.content).toBe('hello');
    });

    test('returns policy_gate_invalid_response when forwarded type mismatches', async () => {
        const harness = createHarness({
            onOutgoing: async (message, injectIncoming) => {
                if (message.type !== 'list_dir') {
                    return;
                }
                await injectIncoming({
                    type: 'read_file_response',
                    commandId: message.id,
                    payload: {
                        success: true,
                    },
                });
            },
        });

        await harness.process({
            id: 'cmd-list-dir',
            type: 'list_dir',
            payload: {
                path: '/tmp',
            },
        });

        const response = harness.outgoing.find((message) => message.type === 'list_dir_response');
        expect(response).toBeDefined();
        const payload = response?.payload as Record<string, unknown>;
        expect(payload.success).toBe(false);
        expect(payload.error).toBe('policy_gate_invalid_response:read_file_response');
    });

    test('apply_patch returns io_error payload when policy gate is unavailable', async () => {
        const harness = createHarness({
            onOutgoing: (message) => {
                if (message.type === 'apply_patch') {
                    throw new Error('desktop unavailable');
                }
            },
        });

        await harness.process({
            id: 'cmd-apply-patch',
            type: 'apply_patch',
            payload: {
                patchId: 'patch-1',
            },
        });

        const response = harness.outgoing.find((message) => message.type === 'apply_patch_response');
        expect(response).toBeDefined();
        const payload = response?.payload as Record<string, unknown>;
        expect(payload.patchId).toBe('patch-1');
        expect(payload.success).toBe(false);
        expect(payload.errorCode).toBe('io_error');
        expect(payload.error).toBe('policy_gate_unavailable:desktop unavailable');
    });
});
