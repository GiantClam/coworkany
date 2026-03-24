import { describe, expect, test } from 'bun:test';
import { checkCommandWithBinaryPolicy } from '../src/tools/commandSandbox';

describe('commandSandbox binary policy', () => {
    test('blocks command when requireAllowlist=true and binary is not allowed', () => {
        const result = checkCommandWithBinaryPolicy('python3 script.py', {
            requireAllowlist: true,
            allowedBinaries: ['git', 'bun'],
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('allowlist');
    });

    test('blocks explicitly denied binary even if allowed list includes it', () => {
        const result = checkCommandWithBinaryPolicy('git status', {
            requireAllowlist: true,
            allowedBinaries: ['git'],
            deniedBinaries: ['git'],
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('denied');
    });

    test('allows command when binary and command pattern are both allowed', () => {
        const result = checkCommandWithBinaryPolicy('git status', {
            requireAllowlist: true,
            allowedBinaries: ['git'],
            allowedCommandPatterns: ['^git\\s+(status|diff|log)$'],
        });

        expect(result.allowed).toBe(true);
        expect(result.riskLevel).toBe('safe');
    });

    test('normalizes binary path tokens when checking allowlist', () => {
        const result = checkCommandWithBinaryPolicy('git status', {
            requireAllowlist: true,
            allowedBinaries: ['/usr/bin/git'],
            allowedCommandPatterns: ['^git\\s+(status|diff|log)$'],
        });

        expect(result.allowed).toBe(true);
    });

    test('blocks command when pattern list is provided but command does not match', () => {
        const result = checkCommandWithBinaryPolicy('git push origin main', {
            requireAllowlist: true,
            allowedBinaries: ['git'],
            allowedCommandPatterns: ['^git\\s+(status|diff|log)$'],
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('pattern');
    });

    test('keeps baseline critical block even when policy allowlists binary', () => {
        const result = checkCommandWithBinaryPolicy('rm -rf /', {
            requireAllowlist: true,
            allowedBinaries: ['rm'],
        });

        expect(result.allowed).toBe(false);
        expect(result.riskLevel).toBe('critical');
    });
});
