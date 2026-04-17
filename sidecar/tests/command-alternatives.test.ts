import { describe, expect, test } from 'bun:test';
import {
    buildCommandRecoveryHints,
    discoverInstalledCommandCandidates,
    isLikelyCommandNotFoundFailure,
} from '../src/utils/commandAlternatives';

describe('command alternatives and recovery hints', () => {
    test('detects command-not-found style failures', () => {
        expect(isLikelyCommandNotFoundFailure({
            stderr: '/bin/sh: fooo: command not found',
            exitCode: 127,
        })).toBe(true);
        expect(isLikelyCommandNotFoundFailure({
            stderr: 'Permission denied',
            exitCode: 1,
        })).toBe(false);
    });

    test('builds recovery hints with probe commands for missing command', () => {
        const hints = buildCommandRecoveryHints({
            command: 'pythonn --version',
            stderr: '/bin/sh: pythonn: command not found',
            exitCode: 127,
            platform: 'linux',
        });
        expect(hints).not.toBeNull();
        expect(hints?.baseCommand).toBe('pythonn');
        expect((hints?.probeCommands.length ?? 0) > 0).toBe(true);
        expect(typeof hints?.suggestion).toBe('string');
    });

    test('returns null recovery hints for non-missing-command errors', () => {
        const hints = buildCommandRecoveryHints({
            command: 'ls /root',
            stderr: 'Permission denied',
            exitCode: 1,
            platform: 'linux',
        });
        expect(hints).toBeNull();
    });

    test('discoverInstalledCommandCandidates returns bounded list', () => {
        const candidates = discoverInstalledCommandCandidates('pythonn', 'linux');
        expect(Array.isArray(candidates)).toBe(true);
        expect(candidates.length <= 8).toBe(true);
    });
});
