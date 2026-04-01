import { describe, expect, test } from 'bun:test';
import { createMastraPolicyEngine } from '../src/mastra/policyEngine';

describe('mastra policy engine', () => {
    test('allows by default when no deny rule matches', () => {
        const engine = createMastraPolicyEngine();
        const decision = engine.evaluate({
            action: 'forward_command',
            commandType: 'read_file',
        });

        expect(decision.allowed).toBe(true);
        expect(decision.ruleId).toBe('default-allow');
    });

    test('denies configured forwarded command', () => {
        const engine = createMastraPolicyEngine({
            denyForwardCommandTypes: ['read_file'],
        });
        const decision = engine.evaluate({
            action: 'forward_command',
            commandType: 'read_file',
        });

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe('forward_command_blocked:read_file');
        expect(decision.ruleId).toBe('deny-forward-command');
    });

    test('denies configured approved tool while still allowing manual deny', () => {
        const engine = createMastraPolicyEngine({
            denyApprovedTools: ['bash_approval'],
        });

        const denyApprovedDecision = engine.evaluate({
            action: 'approval_result',
            approved: true,
            payload: {
                toolName: 'bash_approval',
            },
        });
        const userDeniedDecision = engine.evaluate({
            action: 'approval_result',
            approved: false,
            payload: {
                toolName: 'bash_approval',
            },
        });

        expect(denyApprovedDecision.allowed).toBe(false);
        expect(denyApprovedDecision.reason).toBe('approval_blocked:bash_approval');
        expect(userDeniedDecision.allowed).toBe(true);
    });
});
