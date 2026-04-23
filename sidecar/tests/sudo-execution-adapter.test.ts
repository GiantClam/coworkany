import { describe, expect, test } from 'bun:test';
import {
    appendSudoFailureHint,
    buildSudoExecutionPlan,
    hasSudoFailure,
} from '../src/tools/sudoExecution';

describe('sudo execution adapter', () => {
    test('keeps non-sudo command unchanged', () => {
        const plan = buildSudoExecutionPlan('echo hello', { env: {} });
        expect(plan.isSudoCommand).toBe(false);
        expect(plan.commandToRun).toBe('echo hello');
        expect(plan.stdinData).toBeUndefined();
        expect(plan.nonInteractive).toBe(false);
    });

    test('injects sudo password via stdin when env is configured', () => {
        const plan = buildSudoExecutionPlan('sudo shutdown -h +1', {
            env: { COWORKANY_SUDO_PASSWORD: 'secret' },
        });
        expect(plan.isSudoCommand).toBe(true);
        expect(plan.usesPassword).toBe(true);
        expect(plan.passwordEnvKey).toBe('COWORKANY_SUDO_PASSWORD');
        expect(plan.commandToRun).toBe("sudo -S -p '' shutdown -h +1");
        expect(plan.stdinData).toBe('secret\n');
    });

    test('prefers non-interactive sudo when password is not configured', () => {
        const plan = buildSudoExecutionPlan('sudo shutdown -h +1', { env: {} });
        expect(plan.isSudoCommand).toBe(true);
        expect(plan.usesPassword).toBe(false);
        expect(plan.nonInteractive).toBe(true);
        expect(plan.commandToRun).toBe('sudo -n shutdown -h +1');
        expect(plan.stdinData).toBeUndefined();
    });

    test('does not duplicate non-interactive option', () => {
        const plan = buildSudoExecutionPlan('sudo -n shutdown -h +1', { env: {} });
        expect(plan.commandToRun).toBe('sudo -n shutdown -h +1');
    });

    test('detects and annotates sudo failure output', () => {
        const stderr = 'sudo: a password is required';
        expect(hasSudoFailure(stderr)).toBe(true);
        const annotated = appendSudoFailureHint({
            command: 'sudo -n shutdown -h +1',
            stderr,
            usesPassword: false,
        });
        expect(annotated).toContain('COWORKANY_SUDO_PASSWORD');
    });
});
