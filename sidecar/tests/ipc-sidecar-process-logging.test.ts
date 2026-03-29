import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initializeSidecarProcessLogging } from '../src/ipc/sidecarProcessLogging';

describe('sidecar process logging', () => {
    test('writes log/error/warn entries into rotated log file', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-sidecar-log-'));
        const forwarded: string[] = [];

        const fakeConsole = {
            log: (...args: unknown[]) => {
                forwarded.push(`log:${args.map(String).join(' ')}`);
            },
            error: (...args: unknown[]) => {
                forwarded.push(`error:${args.map(String).join(' ')}`);
            },
            warn: (...args: unknown[]) => {
                forwarded.push(`warn:${args.map(String).join(' ')}`);
            },
        };

        const { logFile, closeLogStreamSafely } = initializeSidecarProcessLogging({
            cwd: tempDir,
            consoleLike: fakeConsole,
            now: () => new Date('2026-03-29T01:02:03.000Z'),
        });

        fakeConsole.log('hello');
        fakeConsole.error('boom');
        fakeConsole.warn('careful');
        await closeLogStreamSafely();

        expect(forwarded).toEqual([
            'error:hello',
            'error:boom',
            'warn:careful',
        ]);
        expect(logFile).toBe(path.join(tempDir, '.coworkany', 'logs', 'sidecar-2026-03-29.log'));
        const logContent = fs.readFileSync(logFile, 'utf-8');
        expect(logContent).toContain('[LOG] hello');
        expect(logContent).toContain('[ERR] boom');
        expect(logContent).toContain('[WRN] careful');
    });

    test('closeLogStreamSafely is idempotent', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-sidecar-log-'));
        const fakeConsole = {
            log: () => {},
            error: () => {},
            warn: () => {},
        };

        const { closeLogStreamSafely } = initializeSidecarProcessLogging({
            cwd: tempDir,
            consoleLike: fakeConsole,
            now: () => new Date('2026-03-29T01:02:03.000Z'),
        });

        await expect(closeLogStreamSafely()).resolves.toBeUndefined();
        await expect(closeLogStreamSafely()).resolves.toBeUndefined();
    });
});
