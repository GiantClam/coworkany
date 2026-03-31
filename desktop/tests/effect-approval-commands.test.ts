import { describe, expect, test } from 'bun:test';
import {
    invokeConfirmEffectCommand,
    invokeDenyEffectCommand,
} from '../src/lib/effectApprovalCommands';

describe('effect approval command helpers', () => {
    test('invokeConfirmEffectCommand sends confirm_effect with boolean remember flag', async () => {
        const invokes: Array<{ command: string; args: Record<string, unknown> }> = [];
        const invokeMock = async (command: string, args?: Record<string, unknown>) => {
            invokes.push({ command, args: args ?? {} });
            return null;
        };

        await invokeConfirmEffectCommand(invokeMock as never, {
            requestId: 'effect-1',
            remember: true,
        });

        expect(invokes).toEqual([
            {
                command: 'confirm_effect',
                args: {
                    requestId: 'effect-1',
                    remember: true,
                },
            },
        ]);
    });

    test('invokeDenyEffectCommand trims reason and sends undefined for empty reason', async () => {
        const invokes: Array<{ command: string; args: Record<string, unknown> }> = [];
        const invokeMock = async (command: string, args?: Record<string, unknown>) => {
            invokes.push({ command, args: args ?? {} });
            return null;
        };

        await invokeDenyEffectCommand(invokeMock as never, {
            requestId: 'effect-2',
            reason: '  too risky  ',
        });
        await invokeDenyEffectCommand(invokeMock as never, {
            requestId: 'effect-3',
            reason: '   ',
        });

        expect(invokes).toEqual([
            {
                command: 'deny_effect',
                args: {
                    requestId: 'effect-2',
                    reason: 'too risky',
                },
            },
            {
                command: 'deny_effect',
                args: {
                    requestId: 'effect-3',
                    reason: undefined,
                },
            },
        ]);
    });
});
