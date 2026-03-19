export class TaskCancelledError extends Error {
    readonly taskId: string;

    constructor(taskId: string, reason?: string) {
        super(reason || 'task_cancelled');
        this.name = 'TaskCancelledError';
        this.taskId = taskId;
    }
}

type CancellationEntry = {
    requested: boolean;
    reason?: string;
    waiters: Set<(reason: string) => void>;
};

export class TaskCancellationRegistry {
    private readonly entries = new Map<string, CancellationEntry>();

    request(taskId: string, reason?: string): string {
        const existing = this.entries.get(taskId);
        const resolvedReason = reason?.trim() || existing?.reason || 'Task cancelled by user';
        if (existing) {
            existing.requested = true;
            existing.reason = resolvedReason;
            for (const waiter of existing.waiters) {
                waiter(resolvedReason);
            }
            existing.waiters.clear();
            return resolvedReason;
        }

        this.entries.set(taskId, {
            requested: true,
            reason: resolvedReason,
            waiters: new Set(),
        });
        return resolvedReason;
    }

    clear(taskId: string): void {
        this.entries.delete(taskId);
    }

    isRequested(taskId: string): boolean {
        return this.entries.get(taskId)?.requested === true;
    }

    getReason(taskId: string): string | undefined {
        const entry = this.entries.get(taskId);
        return entry?.requested ? entry.reason : undefined;
    }

    onCancellation(taskId: string, waiter: (reason: string) => void): () => void {
        const existing = this.entries.get(taskId);
        if (existing?.requested && existing.reason) {
            waiter(existing.reason);
            return () => {};
        }

        const entry = existing ?? {
            requested: false,
            waiters: new Set(),
        };
        entry.waiters.add(waiter);
        this.entries.set(taskId, entry);

        return () => {
            const current = this.entries.get(taskId);
            current?.waiters.delete(waiter);
            if (current && !current.requested && current.waiters.size === 0) {
                this.entries.delete(taskId);
            }
        };
    }

    throwIfCancelled(taskId: string): void {
        const reason = this.getReason(taskId);
        if (reason) {
            throw new TaskCancelledError(taskId, reason);
        }
    }

    waitForCancellation(taskId: string): Promise<string> {
        return new Promise<string>((resolve) => {
            this.onCancellation(taskId, resolve);
        });
    }
}
