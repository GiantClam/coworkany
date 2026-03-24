import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    HostAccessGrantManager,
    deriveBinaryAccessRequest,
    deriveHostAccessRequest,
} from '../src/security/hostAccessGrantManager';

describe('HostAccessGrantManager', () => {
    test('reuses session grants for nested paths with matching access', () => {
        const filePath = path.join(os.tmpdir(), `coworkany-host-grants-${Date.now()}.json`);
        fs.rmSync(filePath, { force: true });
        const manager = new HostAccessGrantManager(filePath);

        manager.recordGrant({
            targetPath: '/Users/tester/Downloads',
            access: ['read', 'write'],
            scope: 'session',
        });

        expect(manager.hasGrant({
            targetPath: '/Users/tester/Downloads/screenshots',
            access: ['read'],
        })).toBe(true);

        expect(manager.hasGrant({
            targetPath: '/Users/tester/Downloads/screenshots',
            access: ['delete'],
        })).toBe(false);
    });

    test('persists permanent grants across manager instances', () => {
        const filePath = path.join(os.tmpdir(), `coworkany-host-grants-${Date.now()}-persistent.json`);
        fs.rmSync(filePath, { force: true });

        const writer = new HostAccessGrantManager(filePath);
        writer.recordGrant({
            targetPath: '/Users/tester/Downloads',
            access: ['read', 'write', 'move'],
            scope: 'persistent',
        });

        const reader = new HostAccessGrantManager(filePath);
        expect(reader.hasGrant({
            targetPath: '/Users/tester/Downloads/Images',
            access: ['read', 'move'],
        })).toBe(true);
    });

    test('derives delete access from filesystem delete effect requests', () => {
        const request = deriveHostAccessRequest({
            id: 'req-1',
            timestamp: new Date().toISOString(),
            effectType: 'filesystem:write',
            source: 'agent',
            payload: {
                path: '/Users/tester/Downloads/a.png',
                operation: 'delete',
                description: 'delete file',
            },
            context: {
                taskId: 'task-1',
            },
        } as any);

        expect(request).toEqual({
            targetPath: '/Users/tester/Downloads/a.png',
            access: ['delete'],
        });
    });

    test('reuses session binary grants for allowed commands', () => {
        const filePath = path.join(os.tmpdir(), `coworkany-host-grants-${Date.now()}-binary.json`);
        fs.rmSync(filePath, { force: true });
        const manager = new HostAccessGrantManager(filePath);

        manager.recordBinaryGrant({
            binaryPath: '/usr/bin/git',
            allowedArgPatterns: ['^git\\s+(status|diff|log)$'],
            scope: 'session',
        });

        expect(manager.hasBinaryGrant({
            binaryPath: 'git',
            command: 'git status',
        })).toBe(true);

        expect(manager.hasBinaryGrant({
            binaryPath: 'git',
            command: 'git push origin main',
        })).toBe(false);
    });

    test('persists persistent binary grants across manager instances', () => {
        const filePath = path.join(os.tmpdir(), `coworkany-host-grants-${Date.now()}-binary-persistent.json`);
        fs.rmSync(filePath, { force: true });

        const writer = new HostAccessGrantManager(filePath);
        writer.recordBinaryGrant({
            binaryPath: '/opt/homebrew/bin/bun',
            scope: 'persistent',
        });

        const reader = new HostAccessGrantManager(filePath);
        expect(reader.hasBinaryGrant({
            binaryPath: 'bun',
            command: 'bun test',
        })).toBe(true);
    });

    test('derives binary access request from shell effect requests', () => {
        const request = deriveBinaryAccessRequest({
            id: 'req-2',
            timestamp: new Date().toISOString(),
            effectType: 'shell:write',
            source: 'agent',
            payload: {
                command: 'git status',
                cwd: '/Users/tester/project',
                description: 'run git status',
            },
            context: {
                taskId: 'task-2',
            },
        } as any);

        expect(request).toEqual({
            binaryPath: 'git',
            commandPattern: '^\\s*git status\\s*$',
        });
    });
});
