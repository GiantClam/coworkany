import { describe, expect, test } from 'bun:test';
import { resolveAssistantUiApprovalDecision } from '../src/components/Chat/Timeline/Timeline';

describe('resolveAssistantUiApprovalDecision', () => {
    test('skips action when not running in tauri runtime', async () => {
        const invokes: Array<{ command: string; args: Record<string, unknown> }> = [];

        const result = await resolveAssistantUiApprovalDecision({
            input: {
                requestId: 'effect-1',
                decision: 'approve',
            },
            taskId: 'task-1',
            isTauriRuntime: false,
            invokeCommand: async (command: string, args?: Record<string, unknown>) => {
                invokes.push({ command, args: args ?? {} });
                return null;
            },
        });

        expect(result).toBe('skipped');
        expect(invokes).toHaveLength(0);
    });

    test('approves effect with confirm_effect command', async () => {
        const invokes: Array<{ command: string; args: Record<string, unknown> }> = [];

        const result = await resolveAssistantUiApprovalDecision({
            input: {
                requestId: 'effect-approve',
                decision: 'approve',
            },
            taskId: 'task-1',
            isTauriRuntime: true,
            invokeCommand: async (command: string, args?: Record<string, unknown>) => {
                invokes.push({ command, args: args ?? {} });
                return null;
            },
        });

        expect(result).toBe('approved');
        expect(invokes).toEqual([
            {
                command: 'confirm_effect',
                args: {
                    requestId: 'effect-approve',
                    remember: false,
                },
            },
        ]);
    });

    test('denies effect with optional note', async () => {
        const invokes: Array<{ command: string; args: Record<string, unknown> }> = [];

        const result = await resolveAssistantUiApprovalDecision({
            input: {
                requestId: 'effect-deny',
                decision: 'deny',
            },
            taskId: 'task-1',
            isTauriRuntime: true,
            invokeCommand: async (command: string, args?: Record<string, unknown>) => {
                invokes.push({ command, args: args ?? {} });
                return null;
            },
        });

        expect(result).toBe('denied');
        expect(invokes).toEqual([
            {
                command: 'deny_effect',
                args: {
                    requestId: 'effect-deny',
                    reason: undefined,
                },
            },
        ]);
    });

    test('forwards modify_approve note to collaboration after denying pending request', async () => {
        const invokes: Array<{ command: string; args: Record<string, unknown> }> = [];
        const collaborationSubmissions: Array<{
            taskId?: string;
            cardId: string;
            actionId?: string;
            value: string;
        }> = [];

        const result = await resolveAssistantUiApprovalDecision({
            input: {
                requestId: 'effect-modify',
                decision: 'modify_approve',
                note: '  请限制到 reports/ 目录  ',
            },
            taskId: 'task-99',
            isTauriRuntime: true,
            invokeCommand: async (command: string, args?: Record<string, unknown>) => {
                invokes.push({ command, args: args ?? {} });
                return null;
            },
            onTaskCollaborationSubmit: async (input) => {
                collaborationSubmissions.push(input);
            },
        });

        expect(result).toBe('modify_forwarded');
        expect(invokes).toEqual([
            {
                command: 'deny_effect',
                args: {
                    requestId: 'effect-modify',
                    reason: '请限制到 reports/ 目录',
                },
            },
        ]);
        expect(collaborationSubmissions).toEqual([
            {
                taskId: 'task-99',
                cardId: 'effect-modify',
                value: '请按以下修改重新执行：请限制到 reports/ 目录',
            },
        ]);
    });
});

