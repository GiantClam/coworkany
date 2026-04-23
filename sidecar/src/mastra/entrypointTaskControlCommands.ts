import type { TaskRuntimeState } from './taskRuntimeState';
import { failGuard, passGuard, runGuardPipeline } from './entrypointGuardPipeline';

type PendingApproval = {
    taskId: string;
    runId: string;
    toolCallId: string;
    toolName: string;
};

type HandleTaskControlCommandsInput = {
    commandType: string;
    commandId: string;
    payload: Record<string, unknown>;
    getString: (value: unknown) => string | null;
    pendingApprovals: Map<string, PendingApproval>;
    clearPendingApprovalsForTask: (taskId: string) => void;
    cancelScheduledTasksForSourceTask?: (input: {
        sourceTaskId: string;
        userMessage: string;
    }) => Promise<{
        success: boolean;
        cancelledCount: number;
        cancelledTitles: string[];
    }>;
    taskStates: Map<string, TaskRuntimeState>;
    upsertTaskState: (
        taskId: string,
        patch: Partial<TaskRuntimeState>,
    ) => TaskRuntimeState;
    appendTranscript: (taskId: string, role: 'user' | 'assistant' | 'system', content: string) => void;
    applyPolicyDecision: (input: {
        requestId: string;
        action: 'task_command' | 'forward_command' | 'approval_result';
        commandType?: string;
        taskId?: string;
        source: string;
        payload?: Record<string, unknown>;
        approved?: boolean;
    }) => {
        allowed: boolean;
        reason: string;
        ruleId: string;
    };
    handleApprovalResponse: (input: {
        runId: string;
        toolCallId: string;
        approved: boolean;
        taskId: string;
    }) => Promise<void>;
    emitInvalidPayload: (type: string, extra?: Record<string, unknown>) => void;
    emitFor: (type: string, responsePayload: Record<string, unknown>) => void;
    emitCurrent: (responsePayload: Record<string, unknown>) => void;
    emitTaskEvent?: (
        taskId: string,
        type: 'TASK_FAILED' | 'TASK_STATUS',
        payload: Record<string, unknown>,
    ) => void;
};

type TaskControlCommandType =
    | 'report_effect_result'
    | 'request_effect_response'
    | 'clear_task_history'
    | 'cancel_task';

function isTaskControlCommandType(commandType: string): commandType is TaskControlCommandType {
    return commandType === 'report_effect_result'
        || commandType === 'request_effect_response'
        || commandType === 'clear_task_history'
        || commandType === 'cancel_task';
}

function toOptionalRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function normalizeApprovalResultPayload(
    payload: Record<string, unknown>,
    getString: (value: unknown) => string | null,
): {
    requestId: string;
    success: boolean;
    normalizedPayload: Record<string, unknown>;
} | null {
    const directRequestId = getString(payload.requestId);
    const directSuccess = payload.success;
    if (directRequestId && typeof directSuccess === 'boolean') {
        return {
            requestId: directRequestId,
            success: directSuccess,
            normalizedPayload: payload,
        };
    }

    const nestedResponse = toOptionalRecord(payload.response);
    if (!nestedResponse) {
        return null;
    }
    const nestedRequestId = getString(nestedResponse.requestId);
    const nestedApproved = nestedResponse.approved;
    if (!nestedRequestId || typeof nestedApproved !== 'boolean') {
        return null;
    }

    return {
        requestId: nestedRequestId,
        success: nestedApproved,
        normalizedPayload: {
            ...payload,
            requestId: nestedRequestId,
            success: nestedApproved,
            reason: getString(payload.reason) ?? getString(nestedResponse.denialReason) ?? undefined,
            approvalType: payload.approvalType ?? nestedResponse.approvalType,
        },
    };
}

export async function handleTaskControlCommands(
    input: HandleTaskControlCommandsInput,
): Promise<boolean> {
    if (!isTaskControlCommandType(input.commandType)) {
        return false;
    }
    const { commandType, commandId, payload } = input;

    if (commandType === 'report_effect_result' || commandType === 'request_effect_response') {
        const normalizedApproval = normalizeApprovalResultPayload(payload, input.getString);
        if (!normalizedApproval) {
            input.emitInvalidPayload('report_effect_result_response');
            return true;
        }
        const { requestId, success, normalizedPayload } = normalizedApproval;
        const pending = input.pendingApprovals.get(requestId);
        if (!pending) {
            input.emitFor('report_effect_result_response', {
                success: false,
                requestId,
                error: 'approval_request_not_found',
            });
            return true;
        }
        const awaitingUserConfirmation = commandType === 'request_effect_response'
            && !success
            && input.getString(normalizedPayload.reason) === 'awaiting_confirmation';
        if (awaitingUserConfirmation) {
            input.emitFor('report_effect_result_response', {
                success: true,
                requestId,
                awaitingUserConfirmation: true,
                resumeDispatched: false,
            });
            return true;
        }
        input.pendingApprovals.delete(requestId);
        const approvalDecision = input.applyPolicyDecision({
            requestId,
            action: 'approval_result',
            commandType,
            taskId: pending.taskId,
            source: 'effect_result',
            payload: {
                ...normalizedPayload,
                toolName: pending.toolName,
                toolCallId: pending.toolCallId,
            },
            approved: success,
        });
        const approvalGuard = await runGuardPipeline<undefined>([
            () => {
                if (!approvalDecision.allowed) {
                    return failGuard(`policy_denied:${approvalDecision.reason}`, undefined);
                }
                return passGuard();
            },
        ]);
        const approvedForRuntime = success && approvalGuard.ok;
        if (success && !approvedForRuntime) {
            input.appendTranscript(
                pending.taskId,
                'system',
                `Approval denied by policy (${approvalDecision.reason}) for ${pending.toolName}.`,
            );
        }
        input.emitFor('report_effect_result_response', {
            success: true,
            requestId,
            appliedApproval: approvedForRuntime,
            resumeDispatched: true,
            policyDecision: {
                allowed: approvalDecision.allowed,
                reason: approvalDecision.reason,
                ruleId: approvalDecision.ruleId,
            },
        });
        try {
            await input.handleApprovalResponse({
                runId: pending.runId ?? '',
                toolCallId: pending.toolCallId,
                approved: approvedForRuntime,
                taskId: pending.taskId,
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            input.appendTranscript(
                pending.taskId,
                'system',
                `Approval resume failed for ${pending.toolName}: ${errorMessage}`,
            );
            const existingRetry = input.taskStates.get(pending.taskId)?.retry;
            input.upsertTaskState(pending.taskId, {
                status: 'failed',
                suspended: false,
                suspensionReason: undefined,
                checkpoint: undefined,
                retry: existingRetry
                    ? {
                        ...existingRetry,
                        lastError: `approval_resume_failed:${errorMessage}`,
                    }
                    : undefined,
            });
            input.emitTaskEvent?.(pending.taskId, 'TASK_FAILED', {
                error: `Approval resume failed: ${errorMessage}`,
                errorCode: 'E_APPROVAL_RESUME_FAILED',
                recoverable: true,
                suggestion: 'Retry the task, then approve again if required.',
            });
        }
        return true;
    }

    const taskId = input.getString(payload.taskId) ?? '';
    const taskControlGuard = await runGuardPipeline<undefined>([
        () => {
            if (!taskId) {
                return passGuard();
            }
            const taskControlDecision = input.applyPolicyDecision({
                requestId: commandId,
                action: 'task_command',
                commandType,
                taskId,
                source: 'task_control',
                payload,
            });
            if (!taskControlDecision.allowed) {
                return failGuard(`policy_denied:${taskControlDecision.reason}`, undefined);
            }
            return passGuard();
        },
    ]);
    if (!taskControlGuard.ok) {
        input.emitCurrent({
            success: false,
            taskId,
            error: taskControlGuard.error,
        });
        return true;
    }
    let cancelledScheduledCount = 0;
    if (taskId) {
        input.clearPendingApprovalsForTask(taskId);
        if (commandType === 'cancel_task') {
            if (input.cancelScheduledTasksForSourceTask) {
                const cancelled = await input.cancelScheduledTasksForSourceTask({
                    sourceTaskId: taskId,
                    userMessage: 'cancel_task',
                });
                cancelledScheduledCount = cancelled.cancelledCount;
            }
            input.upsertTaskState(taskId, {
                status: 'idle',
                suspended: false,
                suspensionReason: undefined,
                checkpoint: undefined,
            });
        } else {
            const existingRetry = input.taskStates.get(taskId)?.retry;
            input.upsertTaskState(taskId, {
                status: 'idle',
                suspended: false,
                suspensionReason: undefined,
                checkpoint: undefined,
                lastUserMessage: undefined,
                retry: existingRetry
                    ? {
                        ...existingRetry,
                        attempts: 0,
                        lastRetryAt: undefined,
                        lastError: undefined,
                    }
                    : undefined,
            });
        }
    }
    const responsePayload: Record<string, unknown> = {
        success: true,
        taskId,
    };
    if (commandType === 'cancel_task') {
        responsePayload.cancelledScheduledCount = cancelledScheduledCount;
    }
    input.emitCurrent(responsePayload);
    return true;
}
