import { describe, expect, test } from 'bun:test';
import { handleRuntimeCommand } from '../src/handlers/runtime';

function buildRuntimeDeps(overrides?: {
    sendMessageImpl?: (input: any) => Promise<{ runId: string }>;
    approveToolCallImpl?: (input: any) => Promise<void>;
    sendIpcCommandAndWaitImpl?: (
        type: string,
        payload: Record<string, unknown>,
        timeoutMs?: number,
    ) => Promise<Record<string, unknown>>;
}) {
    const emitted: Array<Record<string, unknown>> = [];
    const rawEvents: Array<{ taskId: string; type: string; payload: unknown }> = [];
    const started: Array<{ taskId: string; payload: unknown }> = [];
    const statuses: Array<{ taskId: string; payload: unknown }> = [];
    const conversations: Array<{ taskId: string; role: string; content: unknown }> = [];
    const approvals: Array<{ runId: string; toolCallId: string; approved: boolean }> = [];
    const sentMessages: Array<{ message: string; threadId: string; resourceId: string }> = [];
    const cancelledTasks: Array<{ taskId: string; reason?: string }> = [];
    const clearedHistoryTaskIds: string[] = [];
    const forwardedCommands: Array<{
        type: string;
        payload: Record<string, unknown>;
        timeoutMs?: number;
    }> = [];

    const deps: any = {
        emit: (message: Record<string, unknown>) => {
            emitted.push(message);
        },
        workspaceRoot: '/tmp/workspace',
        ensureTaskRuntimePersistence: () => {},
        pushConversationMessage: (taskId: string, message: { role: string; content: unknown }) => {
            conversations.push({ taskId, role: message.role, content: message.content });
            return { id: `msg-${conversations.length}` };
        },
        createTaskFailedEvent: (taskId: string, payload: Record<string, unknown>) => ({
            type: 'TASK_FAILED',
            taskId,
            payload,
        }),
        createTaskFinishedEvent: (taskId: string, payload: Record<string, unknown>) => ({
            type: 'TASK_FINISHED',
            taskId,
            payload,
        }),
        createChatMessageEvent: (taskId: string, payload: Record<string, unknown>) => ({
            type: 'CHAT_MESSAGE',
            taskId,
            payload,
        }),
        createTextDeltaEvent: (taskId: string, payload: Record<string, unknown>) => ({
            type: 'TEXT_DELTA',
            taskId,
            payload,
        }),
        createToolCallEvent: (taskId: string, payload: Record<string, unknown>) => ({
            type: 'TOOL_CALLED',
            taskId,
            payload,
        }),
        createToolResultEvent: (taskId: string, payload: Record<string, unknown>) => ({
            type: 'TOOL_RESULT',
            taskId,
            payload,
        }),
        getTaskConfig: () => ({ workspacePath: '/tmp/workspace' }),
        taskSessionStore: {
            clearConversation: (taskId: string) => {
                clearedHistoryTaskIds.push(taskId);
            },
            setHistoryLimit: () => {},
            ensureHistoryLimit: () => {},
        },
        taskEventBus: {
            emitRaw: (taskId: string, type: string, payload: unknown) => {
                rawEvents.push({ taskId, type, payload });
            },
            emitStatus: (taskId: string, payload: unknown) => {
                statuses.push({ taskId, payload });
            },
            emitStarted: (taskId: string, payload: unknown) => {
                started.push({ taskId, payload });
            },
            reset: () => {},
            emitChatMessage: () => {},
            emitFinished: () => {},
        },
        mastraRuntime: {
            enabled: true,
            sendMessage: async (input: {
                message: string;
                threadId: string;
                resourceId: string;
                onEvent: (event: any) => void;
            }) => {
                sentMessages.push({
                    message: input.message,
                    threadId: input.threadId,
                    resourceId: input.resourceId,
                });
                if (overrides?.sendMessageImpl) {
                    return await overrides.sendMessageImpl(input);
                }
                input.onEvent({ type: 'text_delta', content: 'mastra reply', runId: 'run-1' });
                input.onEvent({ type: 'complete', runId: 'run-1', finishReason: 'stop' });
                return { runId: 'run-1' };
            },
            approveToolCall: async (input: {
                runId: string;
                toolCallId: string;
                approved: boolean;
                onEvent: (event: any) => void;
            }) => {
                approvals.push({
                    runId: input.runId,
                    toolCallId: input.toolCallId,
                    approved: input.approved,
                });
                if (overrides?.approveToolCallImpl) {
                    await overrides.approveToolCallImpl(input);
                    return;
                }
                input.onEvent({ type: 'complete', runId: input.runId, finishReason: 'stop' });
            },
            cancelTask: async (input: { taskId: string; reason?: string }) => {
                cancelledTasks.push(input);
                return { success: true };
            },
        },
    };
    if (overrides?.sendIpcCommandAndWaitImpl) {
        deps.sendIpcCommandAndWait = async (
            type: string,
            payload: Record<string, unknown>,
            timeoutMs?: number,
        ) => {
            forwardedCommands.push({ type, payload, timeoutMs });
            const response = await overrides.sendIpcCommandAndWaitImpl?.(type, payload, timeoutMs);
            return {
                commandId: `forwarded-${type}`,
                timestamp: new Date().toISOString(),
                ...response,
            };
        };
    }

    return {
        deps,
        emitted,
        rawEvents,
        started,
        statuses,
        conversations,
        approvals,
        sentMessages,
        cancelledTasks,
        clearedHistoryTaskIds,
        forwardedCommands,
    };
}

describe('Phase 6: Mastra Protocol Compatibility', () => {
    test('start_task routes to mastra runtime and emits timeline events', async () => {
        const { deps, emitted, started, statuses, conversations, sentMessages } = buildRuntimeDeps();

        const command: any = {
            id: 'cmd-start',
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId: '11111111-1111-1111-1111-111111111111',
                title: 'Mastra Task',
                userQuery: 'hello mastra',
                context: {
                    workspacePath: '/tmp/workspace',
                },
            },
        };

        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        expect(emitted.some((item) => item.type === 'start_task_response')).toBe(true);
        expect(started.length).toBe(1);
        expect(statuses.length).toBeGreaterThan(0);
        expect(conversations.some((item) => item.role === 'user')).toBe(true);
        expect(conversations.some((item) => item.role === 'assistant')).toBe(true);
        expect(sentMessages[0]?.threadId).toBe('11111111-1111-1111-1111-111111111111');
    });

    test('send_task_message routes follow-up to mastra runtime', async () => {
        const { deps, emitted, sentMessages } = buildRuntimeDeps();

        const command: any = {
            id: 'cmd-followup',
            timestamp: new Date().toISOString(),
            type: 'send_task_message',
            payload: {
                taskId: '22222222-2222-2222-2222-222222222222',
                content: 'continue this task',
            },
        };

        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        expect(emitted.some((item) => item.type === 'send_task_message_response')).toBe(true);
        expect(sentMessages.length).toBe(1);
        expect(sentMessages[0]?.message).toBe('continue this task');
    });

    test('start_task with mastra suspended event stays idle and does not finish task', async () => {
        const { deps, emitted, statuses } = buildRuntimeDeps({
            sendMessageImpl: async (input) => {
                input.onEvent({
                    type: 'suspended',
                    runId: 'run-suspended',
                    toolCallId: 'tool-wait',
                    toolName: 'wait_for_user',
                    payload: { reason: 'Need user clarification before continue' },
                });
                input.onEvent({
                    type: 'complete',
                    runId: 'run-suspended',
                    finishReason: 'suspend',
                });
                return { runId: 'run-suspended' };
            },
        });

        const command: any = {
            id: 'cmd-suspend',
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId: '77777777-7777-7777-7777-777777777777',
                title: 'Suspended Task',
                userQuery: 'need clarification',
                context: {
                    workspacePath: '/tmp/workspace',
                },
            },
        };

        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        expect(emitted.some((item) => item.type === 'TASK_FINISHED')).toBe(false);
        expect(
            statuses.some(
                (entry) =>
                    (entry.payload as any)?.status === 'idle'
                    && typeof (entry.payload as any)?.blockingReason === 'string'
                    && (entry.payload as any)?.blockingReason.includes('clarification'),
            ),
        ).toBe(true);
    });

    test('report_effect_result resumes mastra approval flow and finalizes timeline', async () => {
        const { deps, emitted, rawEvents, approvals, conversations } = buildRuntimeDeps({
            sendMessageImpl: async (input) => {
                input.onEvent({
                    type: 'approval_required',
                    runId: 'run-approval',
                    toolCallId: 'tool-1',
                    toolName: 'bash_approval',
                    args: { command: 'rm -rf ./tmp' },
                    resumeSchema: '{}',
                });
                return { runId: 'run-approval' };
            },
            approveToolCallImpl: async (input) => {
                input.onEvent({
                    type: 'text_delta',
                    runId: input.runId,
                    content: 'approval granted, continuing execution',
                });
                input.onEvent({
                    type: 'complete',
                    runId: input.runId,
                    finishReason: 'stop',
                });
            },
        });

        const startCommand: any = {
            id: 'cmd-approval-start',
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId: '33333333-3333-3333-3333-333333333333',
                title: 'Need Approval',
                userQuery: 'delete tmp folder',
                context: {
                    workspacePath: '/tmp/workspace',
                },
            },
        };

        await handleRuntimeCommand(startCommand, deps);

        const effectRequested = rawEvents.find((event) => event.type === 'EFFECT_REQUESTED');
        expect(effectRequested).toBeDefined();
        expect(emitted.some((item) => item.type === 'TASK_FINISHED')).toBe(false);

        const requestId = (effectRequested?.payload as any)?.request?.id;
        expect(typeof requestId).toBe('string');

        const approveCommand: any = {
            id: 'cmd-report-effect',
            timestamp: new Date().toISOString(),
            type: 'report_effect_result',
            payload: {
                requestId,
                success: true,
                duration: 10,
            },
        };

        const handled = await handleRuntimeCommand(approveCommand, deps);
        expect(handled).toBe(true);
        expect(approvals.length).toBe(1);
        expect(approvals[0]?.runId).toBe('run-approval');
        expect(approvals[0]?.toolCallId).toBe('tool-1');
        expect(approvals[0]?.approved).toBe(true);
        expect(emitted.some((item) => item.type === 'TASK_FINISHED')).toBe(true);
        expect(
            conversations.some(
                (item) =>
                    item.role === 'assistant'
                    && typeof item.content === 'string'
                    && item.content.includes('approval granted'),
            ),
        ).toBe(true);
    });

    test('report_effect_result decline path emits EFFECT_DENIED and task finished', async () => {
        const { deps, emitted, rawEvents, approvals, conversations } = buildRuntimeDeps({
            sendMessageImpl: async (input) => {
                input.onEvent({
                    type: 'approval_required',
                    runId: 'run-decline',
                    toolCallId: 'tool-2',
                    toolName: 'delete_files',
                    args: { paths: ['/tmp/a'] },
                    resumeSchema: '{}',
                });
                return { runId: 'run-decline' };
            },
            approveToolCallImpl: async (input) => {
                input.onEvent({
                    type: 'text_delta',
                    runId: input.runId,
                    content: 'request declined, no files were removed',
                });
                input.onEvent({
                    type: 'complete',
                    runId: input.runId,
                    finishReason: 'stop',
                });
            },
        });

        const startCommand: any = {
            id: 'cmd-decline-start',
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId: '55555555-5555-5555-5555-555555555555',
                title: 'Need Decline',
                userQuery: 'do something dangerous',
                context: {
                    workspacePath: '/tmp/workspace',
                },
            },
        };

        await handleRuntimeCommand(startCommand, deps);

        const effectRequested = rawEvents.find((event) => event.type === 'EFFECT_REQUESTED');
        const requestId = (effectRequested?.payload as any)?.request?.id;
        expect(emitted.some((item) => item.type === 'TASK_FINISHED')).toBe(false);

        const declineCommand: any = {
            id: 'cmd-report-effect-decline',
            timestamp: new Date().toISOString(),
            type: 'report_effect_result',
            payload: {
                requestId,
                success: false,
                error: 'user_denied',
                duration: 12,
            },
        };

        const handled = await handleRuntimeCommand(declineCommand, deps);
        expect(handled).toBe(true);
        expect(approvals.length).toBe(1);
        expect(approvals[0]?.approved).toBe(false);
        expect(rawEvents.some((event) => event.type === 'EFFECT_DENIED')).toBe(true);
        expect(emitted.some((item) => item.type === 'TASK_FINISHED')).toBe(true);
        expect(
            conversations.some(
                (item) =>
                    item.role === 'assistant'
                    && typeof item.content === 'string'
                    && item.content.includes('declined'),
            ),
        ).toBe(true);
    });

    test('report_effect_result that re-suspends does not emit task finished', async () => {
        const { deps, emitted, rawEvents, approvals, statuses } = buildRuntimeDeps({
            sendMessageImpl: async (input) => {
                input.onEvent({
                    type: 'approval_required',
                    runId: 'run-resuspend',
                    toolCallId: 'tool-3',
                    toolName: 'bash_approval',
                    args: { command: 'run guarded op' },
                    resumeSchema: '{}',
                });
                return { runId: 'run-resuspend' };
            },
            approveToolCallImpl: async (input) => {
                input.onEvent({
                    type: 'suspended',
                    runId: input.runId,
                    toolCallId: 'tool-wait-again',
                    toolName: 'wait_for_user',
                    payload: { reason: 'Need additional confirmation' },
                });
                input.onEvent({
                    type: 'complete',
                    runId: input.runId,
                    finishReason: 'suspend',
                });
            },
        });

        const startCommand: any = {
            id: 'cmd-resuspend-start',
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId: '88888888-8888-8888-8888-888888888888',
                title: 'Need More Confirmation',
                userQuery: 'do guarded operation',
                context: {
                    workspacePath: '/tmp/workspace',
                },
            },
        };
        await handleRuntimeCommand(startCommand, deps);
        const effectRequested = rawEvents.find((event) => event.type === 'EFFECT_REQUESTED');
        const requestId = (effectRequested?.payload as any)?.request?.id;

        const approveCommand: any = {
            id: 'cmd-resuspend-approve',
            timestamp: new Date().toISOString(),
            type: 'report_effect_result',
            payload: {
                requestId,
                success: true,
                duration: 7,
            },
        };

        const handled = await handleRuntimeCommand(approveCommand, deps);
        expect(handled).toBe(true);
        expect(approvals.length).toBe(1);
        expect(emitted.some((item) => item.type === 'TASK_FINISHED')).toBe(false);
        expect(
            statuses.some(
                (entry) =>
                    (entry.payload as any)?.status === 'idle'
                    && typeof (entry.payload as any)?.blockingReason === 'string'
                    && (entry.payload as any)?.blockingReason.includes('confirmation'),
            ),
        ).toBe(true);
    });

    test('report_effect_result with missing runId emits task failed and skips approveToolCall', async () => {
        const { deps, emitted, rawEvents, approvals } = buildRuntimeDeps({
            sendMessageImpl: async (input) => {
                input.onEvent({
                    type: 'approval_required',
                    toolCallId: 'tool-no-run',
                    toolName: 'bash_approval',
                    args: { command: 'echo test' },
                    resumeSchema: '{}',
                } as any);
                return { runId: 'run-missing-context' };
            },
        });

        const startCommand: any = {
            id: 'cmd-missing-run-start',
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
                title: 'Missing run id',
                userQuery: 'requires approval',
                context: {
                    workspacePath: '/tmp/workspace',
                },
            },
        };
        await handleRuntimeCommand(startCommand, deps);
        const effectRequested = rawEvents.find((event) => event.type === 'EFFECT_REQUESTED');
        const requestId = (effectRequested?.payload as any)?.request?.id;

        const approveCommand: any = {
            id: 'cmd-missing-run-approve',
            timestamp: new Date().toISOString(),
            type: 'report_effect_result',
            payload: {
                requestId,
                success: true,
                duration: 5,
            },
        };
        const handled = await handleRuntimeCommand(approveCommand, deps);
        expect(handled).toBe(true);
        expect(approvals.length).toBe(0);
        expect(
            emitted.some(
                (item) =>
                    item.type === 'TASK_FAILED'
                    && (item as any)?.payload?.errorCode === 'MASTRA_APPROVAL_CONTEXT_INVALID',
            ),
        ).toBe(true);
    });

    test('clear_task_history clears mastra task state and responds', async () => {
        const { deps, emitted, statuses, cancelledTasks, clearedHistoryTaskIds } = buildRuntimeDeps();

        const command: any = {
            id: 'cmd-clear',
            timestamp: new Date().toISOString(),
            type: 'clear_task_history',
            payload: {
                taskId: '44444444-4444-4444-4444-444444444444',
            },
        };

        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        expect(emitted.some((item) => item.type === 'clear_task_history_response')).toBe(true);
        expect(cancelledTasks.length).toBe(1);
        expect(cancelledTasks[0]?.taskId).toBe('44444444-4444-4444-4444-444444444444');
        expect(clearedHistoryTaskIds).toContain('44444444-4444-4444-4444-444444444444');
        expect(statuses.length).toBeGreaterThan(0);
    });

    test('cancel_task in mastra mode cancels runtime and returns idle', async () => {
        const { deps, emitted, statuses, cancelledTasks } = buildRuntimeDeps();
        const taskId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

        const command: any = {
            id: 'cmd-cancel',
            timestamp: new Date().toISOString(),
            type: 'cancel_task',
            payload: {
                taskId,
                reason: 'user_cancelled',
            },
        };

        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        expect(cancelledTasks.some((item) => item.taskId === taskId)).toBe(true);
        expect(emitted.some((item) => item.type === 'cancel_task_response')).toBe(true);
        expect(
            statuses.some(
                (entry) =>
                    (entry.payload as any)?.status === 'idle',
            ),
        ).toBe(true);
    });

    test('resume_interrupted_task in mastra mode replays last user message', async () => {
        const { deps, emitted, sentMessages } = buildRuntimeDeps();
        const taskId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

        const startCommand: any = {
            id: 'cmd-resume-seed-start',
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: 'Seed task',
                userQuery: 'original intent',
                context: {
                    workspacePath: '/tmp/workspace',
                },
            },
        };
        await handleRuntimeCommand(startCommand, deps);
        expect(sentMessages[0]?.message).toBe('original intent');

        const resumeCommand: any = {
            id: 'cmd-resume',
            timestamp: new Date().toISOString(),
            type: 'resume_interrupted_task',
            payload: {
                taskId,
            },
        };
        const handled = await handleRuntimeCommand(resumeCommand, deps);
        expect(handled).toBe(true);
        expect(emitted.some((item) => item.type === 'resume_interrupted_task_response')).toBe(true);
        expect(sentMessages.length).toBeGreaterThanOrEqual(2);
        expect(sentMessages[1]?.message).toBe('original intent');
    });

    test('policy-gate delegated commands emit deterministic fallback responses', async () => {
        const fallbackCommands: Array<{
            type: string;
            payload: Record<string, unknown>;
            responseType: string;
        }> = [
            {
                type: 'read_file',
                payload: { path: '/tmp/demo.txt', encoding: 'utf-8' },
                responseType: 'read_file_response',
            },
            {
                type: 'list_dir',
                payload: { path: '/tmp', recursive: false, maxDepth: 1, includeHidden: false },
                responseType: 'list_dir_response',
            },
            {
                type: 'exec_shell',
                payload: { command: 'ls', args: [], timeout: 1000 },
                responseType: 'exec_shell_response',
            },
            {
                type: 'capture_screen',
                payload: { region: 'window', format: 'png', quality: 90 },
                responseType: 'capture_screen_response',
            },
            {
                type: 'apply_patch',
                payload: {
                    patchId: '12121212-1212-1212-1212-121212121212',
                    patch: {
                        id: '12121212-1212-1212-1212-121212121212',
                        timestamp: new Date().toISOString(),
                        filePath: 'README.md',
                        operation: 'modify',
                        hunks: [],
                        additions: 0,
                        deletions: 0,
                    },
                },
                responseType: 'apply_patch_response',
            },
        ];

        for (const item of fallbackCommands) {
            const { deps, emitted } = buildRuntimeDeps();
            const command: any = {
                id: `cmd-${item.type}`,
                timestamp: new Date().toISOString(),
                type: item.type,
                payload: item.payload,
            };

            const handled = await handleRuntimeCommand(command, deps);
            expect(handled).toBe(true);
            const response = emitted.find((entry) => entry.type === item.responseType);
            expect(response).toBeDefined();
            expect((response as any)?.payload?.success).toBe(false);
            expect((response as any)?.payload?.error).toBe('policy_gate_required');
        }
    });

    test('policy-gate delegated commands are forwarded through IPC bridge when available', async () => {
        const { deps, emitted, forwardedCommands } = buildRuntimeDeps({
            sendIpcCommandAndWaitImpl: async (type, payload) => {
                if (type === 'apply_patch') {
                    return {
                        type: 'apply_patch_response',
                        payload: {
                            patchId: payload.patchId,
                            success: true,
                        },
                    };
                }
                return {
                    type: `${type}_response`,
                    payload: {
                        success: true,
                        echoedType: type,
                    },
                };
            },
        });

        const commands: Array<{ type: string; payload: Record<string, unknown> }> = [
            { type: 'read_file', payload: { path: '/tmp/a' } },
            { type: 'list_dir', payload: { path: '/tmp' } },
            { type: 'exec_shell', payload: { command: 'pwd' } },
            { type: 'capture_screen', payload: { region: 'window', format: 'png', quality: 90 } },
            {
                type: 'apply_patch',
                payload: {
                    patchId: '45454545-4545-4545-4545-454545454545',
                    patch: {
                        id: '45454545-4545-4545-4545-454545454545',
                        timestamp: new Date().toISOString(),
                        filePath: 'README.md',
                        operation: 'modify',
                        hunks: [],
                        additions: 0,
                        deletions: 0,
                    },
                },
            },
        ];

        for (const item of commands) {
            const command: any = {
                id: `cmd-forward-${item.type}`,
                timestamp: new Date().toISOString(),
                type: item.type,
                payload: item.payload,
            };
            const handled = await handleRuntimeCommand(command, deps);
            expect(handled).toBe(true);
            const response = emitted.find((entry) => entry.commandId === command.id);
            expect(response).toBeDefined();
            expect((response as any)?.payload?.success).toBe(true);
        }

        expect(forwardedCommands.map((item) => item.type)).toEqual(
            ['read_file', 'list_dir', 'exec_shell', 'capture_screen', 'apply_patch'],
        );
    });

    test('policy-gate forwarded commands fail with invalid-response error when response type mismatches', async () => {
        const { deps, emitted } = buildRuntimeDeps({
            sendIpcCommandAndWaitImpl: async () => ({
                type: 'unexpected_response_type',
                payload: {
                    success: true,
                },
            }),
        });

        const command: any = {
            id: 'cmd-forward-invalid-read-file',
            timestamp: new Date().toISOString(),
            type: 'read_file',
            payload: { path: '/tmp/a' },
        };
        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        const response = emitted.find((entry) => entry.commandId === command.id);
        expect(response).toBeDefined();
        expect((response as any)?.type).toBe('read_file_response');
        expect((response as any)?.payload?.success).toBe(false);
        expect((response as any)?.payload?.error).toContain('policy_gate_invalid_response');
    });

    test('policy-gate forwarded commands fail with unavailable error when bridge throws', async () => {
        const { deps, emitted } = buildRuntimeDeps({
            sendIpcCommandAndWaitImpl: async () => {
                throw new Error('bridge_down');
            },
        });

        const readFileCommand: any = {
            id: 'cmd-forward-unavailable-read-file',
            timestamp: new Date().toISOString(),
            type: 'read_file',
            payload: { path: '/tmp/a' },
        };
        const readHandled = await handleRuntimeCommand(readFileCommand, deps);
        expect(readHandled).toBe(true);
        const readResponse = emitted.find((entry) => entry.commandId === readFileCommand.id);
        expect(readResponse).toBeDefined();
        expect((readResponse as any)?.type).toBe('read_file_response');
        expect((readResponse as any)?.payload?.success).toBe(false);
        expect((readResponse as any)?.payload?.error).toContain('policy_gate_unavailable:bridge_down');

        const applyPatchCommand: any = {
            id: 'cmd-forward-unavailable-apply-patch',
            timestamp: new Date().toISOString(),
            type: 'apply_patch',
            payload: {
                patchId: '56565656-5656-5656-5656-565656565656',
                patch: {
                    id: '56565656-5656-5656-5656-565656565656',
                    timestamp: new Date().toISOString(),
                    filePath: 'README.md',
                    operation: 'modify',
                    hunks: [],
                    additions: 0,
                    deletions: 0,
                },
            },
        };
        const patchHandled = await handleRuntimeCommand(applyPatchCommand, deps);
        expect(patchHandled).toBe(true);
        const patchResponse = emitted.find((entry) => entry.commandId === applyPatchCommand.id);
        expect(patchResponse).toBeDefined();
        expect((patchResponse as any)?.type).toBe('apply_patch_response');
        expect((patchResponse as any)?.payload?.success).toBe(false);
        expect((patchResponse as any)?.payload?.patchId).toBe('56565656-5656-5656-5656-565656565656');
        expect((patchResponse as any)?.payload?.error).toContain('policy_gate_unavailable:bridge_down');
        expect((patchResponse as any)?.payload?.errorCode).toBe('io_error');
    });

    test('get_policy_config returns default policies and empty allow/block lists', async () => {
        const { deps, emitted } = buildRuntimeDeps();
        const command: any = {
            id: 'cmd-get-policy-config',
            timestamp: new Date().toISOString(),
            type: 'get_policy_config',
            payload: {},
        };

        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        const response = emitted.find((entry) => entry.type === 'get_policy_config_response');
        expect(response).toBeDefined();
        expect((response as any)?.payload?.defaultPolicies?.['filesystem:read']).toBe('never');
        expect((response as any)?.payload?.defaultPolicies?.['filesystem:write']).toBe('always');
        expect(Array.isArray((response as any)?.payload?.allowlists?.commands)).toBe(true);
        expect(Array.isArray((response as any)?.payload?.blocklists?.commands)).toBe(true);
    });

    test('get_policy_config uses forwarded policy snapshot when bridge is available', async () => {
        const { deps, emitted, forwardedCommands } = buildRuntimeDeps({
            sendIpcCommandAndWaitImpl: async (type) => ({
                type: `${type}_response`,
                payload: {
                    defaultPolicies: {
                        'filesystem:read': 'never',
                        'filesystem:write': 'always',
                    },
                    allowlists: {
                        commands: ['git status'],
                        domains: ['example.com'],
                        paths: ['/tmp'],
                    },
                    blocklists: {
                        commands: ['rm -rf'],
                        domains: [],
                        paths: [],
                    },
                },
            }),
        });
        const command: any = {
            id: 'cmd-get-policy-config-forward',
            timestamp: new Date().toISOString(),
            type: 'get_policy_config',
            payload: {},
        };

        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        const response = emitted.find((entry) => entry.type === 'get_policy_config_response');
        expect(response).toBeDefined();
        expect((response as any)?.payload?.allowlists?.commands).toEqual(['git status']);
        expect(forwardedCommands.map((item) => item.type)).toEqual(['get_policy_config']);
    });

    test('get_policy_config falls back to defaults when forwarded response type is invalid', async () => {
        const { deps, emitted } = buildRuntimeDeps({
            sendIpcCommandAndWaitImpl: async () => ({
                type: 'unexpected_response_type',
                payload: {
                    whatever: true,
                },
            }),
        });
        const command: any = {
            id: 'cmd-get-policy-config-invalid-response',
            timestamp: new Date().toISOString(),
            type: 'get_policy_config',
            payload: {},
        };
        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        const response = emitted.find((entry) => entry.type === 'get_policy_config_response');
        expect(response).toBeDefined();
        expect((response as any)?.payload?.defaultPolicies?.['filesystem:read']).toBe('never');
        expect((response as any)?.payload?.defaultPolicies?.['filesystem:write']).toBe('always');
    });

    test('get_policy_config falls back to defaults when bridge throws', async () => {
        const { deps, emitted } = buildRuntimeDeps({
            sendIpcCommandAndWaitImpl: async () => {
                throw new Error('policy_service_unavailable');
            },
        });
        const command: any = {
            id: 'cmd-get-policy-config-forward-error',
            timestamp: new Date().toISOString(),
            type: 'get_policy_config',
            payload: {},
        };
        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        const response = emitted.find((entry) => entry.type === 'get_policy_config_response');
        expect(response).toBeDefined();
        expect((response as any)?.payload?.defaultPolicies?.['filesystem:read']).toBe('never');
        expect((response as any)?.payload?.defaultPolicies?.['filesystem:write']).toBe('always');
        expect(Array.isArray((response as any)?.payload?.allowlists?.commands)).toBe(true);
        expect(Array.isArray((response as any)?.payload?.blocklists?.commands)).toBe(true);
    });

    test('propose_patch and reject_patch are handled via patch lifecycle events', async () => {
        const { deps, emitted, rawEvents } = buildRuntimeDeps();
        const taskId = 'dededeed-dede-dede-dede-dededededede';
        const patchId = 'abababab-abab-abab-abab-abababababab';

        const proposeCommand: any = {
            id: 'cmd-propose-patch',
            timestamp: new Date().toISOString(),
            type: 'propose_patch',
            payload: {
                taskId,
                patch: {
                    id: patchId,
                    timestamp: new Date().toISOString(),
                    filePath: 'src/demo.ts',
                    operation: 'modify',
                    hunks: [],
                    additions: 1,
                    deletions: 0,
                },
            },
        };

        const proposeHandled = await handleRuntimeCommand(proposeCommand, deps);
        expect(proposeHandled).toBe(true);
        expect(emitted.some((entry) => entry.type === 'propose_patch_response')).toBe(true);
        expect(rawEvents.some((entry) => entry.type === 'PATCH_PROPOSED')).toBe(true);

        const rejectCommand: any = {
            id: 'cmd-reject-patch',
            timestamp: new Date().toISOString(),
            type: 'reject_patch',
            payload: {
                patchId,
                reason: 'manual_review_failed',
            },
        };
        const rejectHandled = await handleRuntimeCommand(rejectCommand, deps);
        expect(rejectHandled).toBe(true);
        expect(emitted.some((entry) => entry.type === 'reject_patch_response')).toBe(true);
        expect(rawEvents.some((entry) => entry.type === 'PATCH_REJECTED')).toBe(true);
    });

    test('propose_patch is forwarded to policy-gate bridge when available', async () => {
        const patchId = '98989898-9898-9898-9898-989898989898';
        const { deps, emitted, rawEvents, forwardedCommands } = buildRuntimeDeps({
            sendIpcCommandAndWaitImpl: async () => ({
                type: 'propose_patch_response',
                payload: {
                    patchId,
                    shadowPath: `/tmp/.coworkany/shadow/${patchId}`,
                },
            }),
        });

        const command: any = {
            id: 'cmd-forward-propose-patch',
            timestamp: new Date().toISOString(),
            type: 'propose_patch',
            payload: {
                taskId: 'fefefefe-fefe-fefe-fefe-fefefefefefe',
                patch: {
                    id: patchId,
                    timestamp: new Date().toISOString(),
                    filePath: 'src/demo.ts',
                    operation: 'modify',
                    hunks: [],
                    additions: 2,
                    deletions: 1,
                },
            },
        };

        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        expect(forwardedCommands.map((item) => item.type)).toEqual(['propose_patch']);
        const response = emitted.find((entry) => entry.commandId === command.id);
        expect(response).toBeDefined();
        expect((response as any)?.type).toBe('propose_patch_response');
        expect((response as any)?.payload?.patchId).toBe(patchId);
        expect((response as any)?.payload?.shadowPath).toContain(patchId);
        expect(rawEvents.some((entry) => entry.type === 'PATCH_PROPOSED')).toBe(true);
    });

    test('propose_patch retries once on timeout and succeeds through policy-gate bridge', async () => {
        const patchId = 'acacacac-acac-acac-acac-acacacacacac';
        let attempts = 0;
        const { deps, emitted, rawEvents, forwardedCommands } = buildRuntimeDeps({
            sendIpcCommandAndWaitImpl: async () => {
                attempts += 1;
                if (attempts === 1) {
                    throw new Error('IPC response timeout for propose_patch');
                }
                return {
                    type: 'propose_patch_response',
                    payload: {
                        patchId,
                        shadowPath: `/tmp/.coworkany/shadow/${patchId}`,
                    },
                };
            },
        });
        const command: any = {
            id: 'cmd-forward-propose-patch-retry',
            timestamp: new Date().toISOString(),
            type: 'propose_patch',
            payload: {
                taskId: '12121212-3434-5656-7878-909090909090',
                patch: {
                    id: patchId,
                    timestamp: new Date().toISOString(),
                    filePath: 'src/demo.ts',
                    operation: 'modify',
                    hunks: [],
                    additions: 1,
                    deletions: 0,
                },
            },
        };
        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        expect(forwardedCommands.map((item) => item.type)).toEqual(['propose_patch', 'propose_patch']);
        const response = emitted.find((entry) => entry.commandId === command.id);
        expect(response).toBeDefined();
        expect((response as any)?.type).toBe('propose_patch_response');
        expect((response as any)?.payload?.patchId).toBe(patchId);
        expect((response as any)?.payload?.error).toBeUndefined();
        expect(rawEvents.some((entry) => entry.type === 'PATCH_PROPOSED')).toBe(true);
    });

    test('propose_patch returns unavailable error when policy-gate bridge keeps timing out', async () => {
        const patchId = 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb';
        const { deps, emitted, rawEvents, forwardedCommands } = buildRuntimeDeps({
            sendIpcCommandAndWaitImpl: async () => {
                throw new Error('IPC response timeout for propose_patch');
            },
        });
        const command: any = {
            id: 'cmd-forward-propose-patch-timeout',
            timestamp: new Date().toISOString(),
            type: 'propose_patch',
            payload: {
                taskId: '23232323-3434-4545-5656-676767676767',
                patch: {
                    id: patchId,
                    timestamp: new Date().toISOString(),
                    filePath: 'src/demo.ts',
                    operation: 'modify',
                    hunks: [],
                    additions: 1,
                    deletions: 0,
                },
            },
        };
        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        expect(forwardedCommands.map((item) => item.type)).toEqual(['propose_patch', 'propose_patch']);
        const response = emitted.find((entry) => entry.commandId === command.id);
        expect(response).toBeDefined();
        expect((response as any)?.type).toBe('propose_patch_response');
        expect((response as any)?.payload?.patchId).toBe(patchId);
        expect((response as any)?.payload?.error).toContain('policy_gate_unavailable:IPC response timeout');
        expect(rawEvents.some((entry) => entry.type === 'PATCH_PROPOSED')).toBe(false);
    });

    test('propose_patch returns invalid-response error when forwarded type mismatches', async () => {
        const patchId = 'dcdcdcdc-dcdc-dcdc-dcdc-dcdcdcdcdcdc';
        const { deps, emitted, rawEvents } = buildRuntimeDeps({
            sendIpcCommandAndWaitImpl: async () => ({
                type: 'unexpected_response_type',
                payload: {},
            }),
        });
        const command: any = {
            id: 'cmd-forward-propose-patch-invalid',
            timestamp: new Date().toISOString(),
            type: 'propose_patch',
            payload: {
                taskId: '45454545-5656-6767-7878-898989898989',
                patch: {
                    id: patchId,
                    timestamp: new Date().toISOString(),
                    filePath: 'src/demo.ts',
                    operation: 'modify',
                    hunks: [],
                    additions: 2,
                    deletions: 1,
                },
            },
        };
        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        const response = emitted.find((entry) => entry.commandId === command.id);
        expect(response).toBeDefined();
        expect((response as any)?.type).toBe('propose_patch_response');
        expect((response as any)?.payload?.patchId).toBe(patchId);
        expect((response as any)?.payload?.error).toContain('policy_gate_invalid_response');
        expect(rawEvents.some((entry) => entry.type === 'PATCH_PROPOSED')).toBe(false);
    });

    test('reject_patch is forwarded through policy-gate bridge when available', async () => {
        const patchId = 'edededed-eded-eded-eded-edededededed';
        const { deps, emitted, rawEvents, forwardedCommands } = buildRuntimeDeps({
            sendIpcCommandAndWaitImpl: async () => ({
                type: 'reject_patch_response',
                payload: {
                    patchId,
                },
            }),
        });
        const command: any = {
            id: 'cmd-forward-reject-patch',
            timestamp: new Date().toISOString(),
            type: 'reject_patch',
            payload: {
                patchId,
                reason: 'manual_review_failed',
            },
        };
        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        expect(forwardedCommands.map((item) => item.type)).toEqual(['reject_patch']);
        const response = emitted.find((entry) => entry.commandId === command.id);
        expect(response).toBeDefined();
        expect((response as any)?.type).toBe('reject_patch_response');
        expect((response as any)?.payload?.patchId).toBe(patchId);
        expect(rawEvents.some((entry) => entry.type === 'PATCH_REJECTED')).toBe(true);
    });

    test('reject_patch retries once on timeout and succeeds through policy-gate bridge', async () => {
        const patchId = 'f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1';
        let attempts = 0;
        const { deps, emitted, forwardedCommands } = buildRuntimeDeps({
            sendIpcCommandAndWaitImpl: async () => {
                attempts += 1;
                if (attempts === 1) {
                    throw new Error('IPC response timeout for reject_patch');
                }
                return {
                    type: 'reject_patch_response',
                    payload: { patchId },
                };
            },
        });
        const command: any = {
            id: 'cmd-forward-reject-patch-retry',
            timestamp: new Date().toISOString(),
            type: 'reject_patch',
            payload: {
                patchId,
                reason: 'manual_review_failed',
            },
        };
        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        expect(forwardedCommands.map((item) => item.type)).toEqual(['reject_patch', 'reject_patch']);
        const response = emitted.find((entry) => entry.commandId === command.id);
        expect(response).toBeDefined();
        expect((response as any)?.type).toBe('reject_patch_response');
        expect((response as any)?.payload?.patchId).toBe(patchId);
        expect((response as any)?.payload?.error).toBeUndefined();
    });

    test('reject_patch returns unavailable error when policy-gate bridge keeps timing out', async () => {
        const patchId = 'f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2';
        const { deps, emitted, forwardedCommands } = buildRuntimeDeps({
            sendIpcCommandAndWaitImpl: async () => {
                throw new Error('IPC response timeout for reject_patch');
            },
        });
        const command: any = {
            id: 'cmd-forward-reject-patch-timeout',
            timestamp: new Date().toISOString(),
            type: 'reject_patch',
            payload: {
                patchId,
                reason: 'manual_review_failed',
            },
        };
        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        expect(forwardedCommands.map((item) => item.type)).toEqual(['reject_patch', 'reject_patch']);
        const response = emitted.find((entry) => entry.commandId === command.id);
        expect(response).toBeDefined();
        expect((response as any)?.type).toBe('reject_patch_response');
        expect((response as any)?.payload?.patchId).toBe(patchId);
        expect((response as any)?.payload?.error).toContain('policy_gate_unavailable:IPC response timeout');
    });

    test('reject_patch returns invalid-response error when forwarded type mismatches', async () => {
        const patchId = 'f3f3f3f3-f3f3-f3f3-f3f3-f3f3f3f3f3f3';
        const { deps, emitted } = buildRuntimeDeps({
            sendIpcCommandAndWaitImpl: async () => ({
                type: 'unexpected_response_type',
                payload: {},
            }),
        });
        const command: any = {
            id: 'cmd-forward-reject-patch-invalid',
            timestamp: new Date().toISOString(),
            type: 'reject_patch',
            payload: {
                patchId,
                reason: 'manual_review_failed',
            },
        };
        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        const response = emitted.find((entry) => entry.commandId === command.id);
        expect(response).toBeDefined();
        expect((response as any)?.type).toBe('reject_patch_response');
        expect((response as any)?.payload?.patchId).toBe(patchId);
        expect((response as any)?.payload?.error).toContain('policy_gate_invalid_response');
    });

    test('policy-gate delegated command retries once on timeout and succeeds', async () => {
        let attempts = 0;
        const { deps, emitted, forwardedCommands } = buildRuntimeDeps({
            sendIpcCommandAndWaitImpl: async () => {
                attempts += 1;
                if (attempts === 1) {
                    throw new Error('IPC response timeout for read_file');
                }
                return {
                    type: 'read_file_response',
                    payload: {
                        success: true,
                        content: 'ok',
                    },
                };
            },
        });
        const command: any = {
            id: 'cmd-forward-read-file-timeout-retry',
            timestamp: new Date().toISOString(),
            type: 'read_file',
            payload: { path: '/tmp/a' },
        };
        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        expect(forwardedCommands.map((item) => item.type)).toEqual(['read_file', 'read_file']);
        const response = emitted.find((entry) => entry.commandId === command.id);
        expect(response).toBeDefined();
        expect((response as any)?.type).toBe('read_file_response');
        expect((response as any)?.payload?.success).toBe(true);
        expect((response as any)?.payload?.content).toBe('ok');
    });

    test('start_autonomous_task is rejected in mastra mode', async () => {
        const { deps, emitted } = buildRuntimeDeps();

        const command: any = {
            id: 'cmd-auto-start',
            timestamp: new Date().toISOString(),
            type: 'start_autonomous_task',
            payload: {
                taskId: '66666666-6666-6666-6666-666666666666',
                query: 'run in autonomous mode',
            },
        };

        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        const response = emitted.find((item) => item.type === 'start_autonomous_task_response');
        expect(response).toBeDefined();
        expect((response as any)?.payload?.success).toBe(false);
        expect((response as any)?.payload?.error).toBe('unsupported_in_mastra_runtime');
    });

    test('list_autonomous_tasks returns unsupported in mastra mode', async () => {
        const { deps, emitted } = buildRuntimeDeps();

        const command: any = {
            id: 'cmd-auto-list',
            timestamp: new Date().toISOString(),
            type: 'list_autonomous_tasks',
            payload: {},
        };

        const handled = await handleRuntimeCommand(command, deps);
        expect(handled).toBe(true);
        const response = emitted.find((item) => item.type === 'list_autonomous_tasks_response');
        expect(response).toBeDefined();
        expect((response as any)?.payload?.success).toBe(false);
        expect((response as any)?.payload?.error).toBe('unsupported_in_mastra_runtime');
        expect(Array.isArray((response as any)?.payload?.tasks)).toBe(true);
    });

    test('autonomous control commands are all rejected in mastra mode', async () => {
        const unsupportedCommands: Array<{
            type: string;
            responseType: string;
            payload: Record<string, unknown>;
        }> = [
            {
                type: 'get_autonomous_task_status',
                responseType: 'get_autonomous_task_status_response',
                payload: { taskId: '99999999-9999-9999-9999-999999999999' },
            },
            {
                type: 'pause_autonomous_task',
                responseType: 'pause_autonomous_task_response',
                payload: { taskId: '99999999-9999-9999-9999-999999999999' },
            },
            {
                type: 'resume_autonomous_task',
                responseType: 'resume_autonomous_task_response',
                payload: { taskId: '99999999-9999-9999-9999-999999999999' },
            },
            {
                type: 'cancel_autonomous_task',
                responseType: 'cancel_autonomous_task_response',
                payload: { taskId: '99999999-9999-9999-9999-999999999999' },
            },
        ];

        for (const item of unsupportedCommands) {
            const { deps, emitted } = buildRuntimeDeps();
            const command: any = {
                id: `cmd-${item.type}`,
                timestamp: new Date().toISOString(),
                type: item.type,
                payload: item.payload,
            };

            const handled = await handleRuntimeCommand(command, deps);
            expect(handled).toBe(true);
            const response = emitted.find((entry) => entry.type === item.responseType);
            expect(response).toBeDefined();
            expect((response as any)?.payload?.success).toBe(false);
            expect((response as any)?.payload?.error).toBe('unsupported_in_mastra_runtime');
        }
    });
});
