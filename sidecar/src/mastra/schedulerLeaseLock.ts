import * as fs from 'fs';
import * as path from 'path';

type LeasePayload = {
    ownerId: string;
    pid: number;
    acquiredAt: string;
    expiresAt: string;
};

export type SchedulerLeaseHandle = {
    ownerId: string;
    renew: () => void;
    release: () => void;
};

type SchedulerLeaseInput = {
    lockFilePath: string;
    ownerId: string;
    leaseMs: number;
    getNow?: () => Date;
};

function readLeasePayload(lockFilePath: string): LeasePayload | null {
    if (!fs.existsSync(lockFilePath)) {
        return null;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(lockFilePath, 'utf-8')) as unknown;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return null;
        }
        const payload = raw as Record<string, unknown>;
        const ownerId = typeof payload.ownerId === 'string' ? payload.ownerId : '';
        const pid = typeof payload.pid === 'number' && Number.isFinite(payload.pid)
            ? Math.floor(payload.pid)
            : Number.NaN;
        const acquiredAt = typeof payload.acquiredAt === 'string' ? payload.acquiredAt : '';
        const expiresAt = typeof payload.expiresAt === 'string' ? payload.expiresAt : '';
        if (!ownerId || !acquiredAt || !expiresAt || !Number.isFinite(pid)) {
            return null;
        }
        return {
            ownerId,
            pid,
            acquiredAt,
            expiresAt,
        };
    } catch {
        return null;
    }
}

function safeUnlink(lockFilePath: string): void {
    try {
        fs.unlinkSync(lockFilePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
}

function isExpired(payload: LeasePayload, now: Date): boolean {
    return new Date(payload.expiresAt).getTime() <= now.getTime();
}

// Ported from claude-code/src/utils/genericProcessUtils.ts.
function isProcessRunning(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 1) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

// Ported from claude-code/src/utils/cronTasksLock.ts (atomic O_EXCL create + ENOENT retry).
function tryCreateLockFile(lockFilePath: string, payload: LeasePayload): boolean {
    const body = JSON.stringify(payload);
    try {
        const fd = fs.openSync(lockFilePath, 'wx');
        try {
            fs.writeFileSync(fd, body, 'utf-8');
        } finally {
            fs.closeSync(fd);
        }
        return true;
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
            return false;
        }
        if (code === 'ENOENT') {
            fs.mkdirSync(path.dirname(lockFilePath), { recursive: true });
            try {
                const fd = fs.openSync(lockFilePath, 'wx');
                try {
                    fs.writeFileSync(fd, body, 'utf-8');
                } finally {
                    fs.closeSync(fd);
                }
                return true;
            } catch (retryError) {
                if ((retryError as NodeJS.ErrnoException).code === 'EEXIST') {
                    return false;
                }
                throw retryError;
            }
        }
        throw error;
    }
}

export function tryAcquireSchedulerLease(input: SchedulerLeaseInput): SchedulerLeaseHandle | null {
    const getNow = input.getNow ?? (() => new Date());
    fs.mkdirSync(path.dirname(input.lockFilePath), { recursive: true });

    const writeLeasePayload = (payload: LeasePayload): void => {
        fs.writeFileSync(input.lockFilePath, JSON.stringify(payload), 'utf-8');
    };

    const createLeasePayload = (): LeasePayload => {
        const now = getNow();
        return {
            ownerId: input.ownerId,
            pid: process.pid,
            acquiredAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + input.leaseMs).toISOString(),
        };
    };

    if (!tryCreateLockFile(input.lockFilePath, createLeasePayload())) {
        const now = getNow();
        const existing = readLeasePayload(input.lockFilePath);

        // Idempotent reacquire for same owner; refresh pid/lease if needed.
        if (existing?.ownerId === input.ownerId) {
            if (existing.pid !== process.pid || isExpired(existing, now)) {
                const refreshed = createLeasePayload();
                writeLeasePayload({
                    ...refreshed,
                    acquiredAt: existing.acquiredAt || refreshed.acquiredAt,
                });
            }
        } else if (existing && !isExpired(existing, now) && isProcessRunning(existing.pid)) {
            return null;
        } else {
            // Stale lock (expired / dead pid / corrupt) -> recover once.
            try {
                safeUnlink(input.lockFilePath);
            } catch {
                return null;
            }
            if (!tryCreateLockFile(input.lockFilePath, createLeasePayload())) {
                return null;
            }
        }
    }

    let released = false;
    const release = (): void => {
        if (released) {
            return;
        }
        released = true;
        const existing = readLeasePayload(input.lockFilePath);
        if (!existing || existing.ownerId !== input.ownerId) {
            return;
        }
        safeUnlink(input.lockFilePath);
    };

    const renew = (): void => {
        if (released) {
            return;
        }
        const existing = readLeasePayload(input.lockFilePath);
        if (!existing || existing.ownerId !== input.ownerId) {
            released = true;
            return;
        }
        writeLeasePayload({
            ownerId: input.ownerId,
            pid: process.pid,
            acquiredAt: existing.acquiredAt,
            expiresAt: new Date(getNow().getTime() + input.leaseMs).toISOString(),
        });
    };

    return {
        ownerId: input.ownerId,
        renew,
        release,
    };
}
