import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { tryAcquireSchedulerLease } from '../src/mastra/schedulerLeaseLock';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

function createLockPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-mastra-lease-lock-'));
    tempDirs.push(dir);
    return path.join(dir, 'scheduled-tasks.poll.lock');
}

describe('scheduler lease lock', () => {
    test('allows only one live owner at a time', () => {
        const lockFilePath = createLockPath();
        const now = new Date('2026-04-01T00:00:00.000Z');
        const ownerA = tryAcquireSchedulerLease({
            lockFilePath,
            ownerId: 'owner-a',
            leaseMs: 120_000,
            getNow: () => now,
        });
        const ownerB = tryAcquireSchedulerLease({
            lockFilePath,
            ownerId: 'owner-b',
            leaseMs: 120_000,
            getNow: () => now,
        });

        expect(ownerA).toBeDefined();
        expect(ownerB).toBeNull();
        ownerA?.release();
    });

    test('recovers stale lock with dead pid even before expiration', () => {
        const lockFilePath = createLockPath();
        fs.mkdirSync(path.dirname(lockFilePath), { recursive: true });
        fs.writeFileSync(
            lockFilePath,
            JSON.stringify({
                ownerId: 'stale-owner',
                pid: 999_999_999,
                acquiredAt: '2026-04-01T00:00:00.000Z',
                expiresAt: '2099-01-01T00:00:00.000Z',
            }),
            'utf-8',
        );

        const acquired = tryAcquireSchedulerLease({
            lockFilePath,
            ownerId: 'owner-live',
            leaseMs: 120_000,
            getNow: () => new Date('2026-04-01T00:01:00.000Z'),
        });

        expect(acquired).toBeDefined();
        const payload = JSON.parse(fs.readFileSync(lockFilePath, 'utf-8')) as Record<string, unknown>;
        expect(payload.ownerId).toBe('owner-live');
        expect(payload.pid).toBe(process.pid);
        acquired?.release();
    });

    test('reacquire for same owner refreshes pid + expiresAt', () => {
        const lockFilePath = createLockPath();
        fs.mkdirSync(path.dirname(lockFilePath), { recursive: true });
        fs.writeFileSync(
            lockFilePath,
            JSON.stringify({
                ownerId: 'owner-reacquire',
                pid: 12345,
                acquiredAt: '2026-04-01T00:00:00.000Z',
                expiresAt: '2026-04-01T00:00:10.000Z',
            }),
            'utf-8',
        );

        const acquired = tryAcquireSchedulerLease({
            lockFilePath,
            ownerId: 'owner-reacquire',
            leaseMs: 120_000,
            getNow: () => new Date('2026-04-01T00:01:00.000Z'),
        });

        expect(acquired).toBeDefined();
        const payload = JSON.parse(fs.readFileSync(lockFilePath, 'utf-8')) as Record<string, unknown>;
        expect(payload.ownerId).toBe('owner-reacquire');
        expect(payload.pid).toBe(process.pid);
        expect(String(payload.expiresAt)).toBe('2026-04-01T00:03:00.000Z');
        acquired?.release();
    });
});
