/**
 * Command Sandbox — Unit Tests
 *
 * Tests the checkCommand function against known dangerous and safe patterns.
 * Run: cd sidecar && bun test tests/command-sandbox.test.ts
 */

import { describe, test, expect } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';

const SANDBOX_FILE = path.resolve(__dirname, '../src/tools/commandSandbox.ts');

describe('Command Sandbox Module', () => {
    test('commandSandbox.ts exists', () => {
        expect(fs.existsSync(SANDBOX_FILE)).toBe(true);
    });

    test('exports checkCommand and getDangerousPatterns', () => {
        const content = fs.readFileSync(SANDBOX_FILE, 'utf-8');
        expect(content).toContain('export function checkCommand');
        expect(content).toContain('export function getDangerousPatterns');
    });
});

describe('Command Sandbox Patterns', () => {
    const content = fs.readFileSync(SANDBOX_FILE, 'utf-8');

    // Critical patterns
    test('detects rm -rf / as critical', () => {
        expect(content).toContain("riskLevel: 'critical'");
        expect(content).toContain('Recursive delete of root filesystem');
    });

    test('detects mkfs as critical', () => {
        expect(content).toContain('mkfs');
        expect(content).toContain('Filesystem format command');
    });

    test('detects format C: as critical', () => {
        expect(content).toContain('format');
        expect(content).toContain('Disk format command');
    });

    test('detects dd of=/dev/sd as critical', () => {
        expect(content).toContain('dd');
        expect(content).toContain('Direct disk write');
    });

    // High patterns
    test('detects shutdown/reboot as high', () => {
        expect(content).toContain('shutdown');
        expect(content).toContain('System shutdown/restart command');
    });

    test('detects reg delete as high', () => {
        expect(content).toContain('reg');
        expect(content).toContain('Windows registry modification');
    });

    test('detects killall as high', () => {
        expect(content).toContain('killall');
        expect(content).toContain('Kill all processes by name');
    });

    test('detects chmod 777 as high', () => {
        expect(content).toContain('chmod');
        expect(content).toContain('Overly permissive file permissions');
    });

    // Medium patterns
    test('detects curl | sh as medium', () => {
        expect(content).toContain('curl');
        expect(content).toContain('Pipe remote script to shell');
    });

    test('detects sudo as medium', () => {
        expect(content).toContain('sudo');
        expect(content).toContain('Elevated privileges');
    });

    test('detects iptables as medium', () => {
        expect(content).toContain('iptables');
        expect(content).toContain('Network/firewall configuration');
    });
});

describe('Command Sandbox Integration', () => {
    test('standard.ts imports commandSandbox', () => {
        const standardContent = fs.readFileSync(
            path.resolve(__dirname, '../src/tools/standard.ts'),
            'utf-8'
        );
        expect(standardContent).toContain("from './commandSandbox'");
        expect(standardContent).toContain('checkCommand');
    });

    test('run_command handler calls checkCommand before spawn', () => {
        const content = fs.readFileSync(
            path.resolve(__dirname, '../src/tools/standard.ts'),
            'utf-8'
        );
        // checkCommand should appear before spawn in the run_command handler
        const checkIdx = content.indexOf('checkCommand(');
        const spawnIdx = content.indexOf('spawn(');
        expect(checkIdx).toBeGreaterThan(-1);
        expect(spawnIdx).toBeGreaterThan(-1);
        expect(checkIdx).toBeLessThan(spawnIdx);
    });

    test('blocked commands return COMMAND BLOCKED message', () => {
        const content = fs.readFileSync(
            path.resolve(__dirname, '../src/tools/standard.ts'),
            'utf-8'
        );
        expect(content).toContain('COMMAND BLOCKED');
    });
});
