import type { TaskSession } from '../../types';

export const TURN_LOCK_IDLE_GRACE_MS = 1200;

type PendingTurnStatus =
    | {
        phase: 'waiting_for_model' | 'running_tool' | 'retrying';
    }
    | null
    | undefined;

export function isConversationTurnLocked(
    session: TaskSession | null | undefined,
    pendingStatus?: PendingTurnStatus,
    nowMs: number = Date.now(),
): boolean {
    if (!session || session.isDraft) {
        return false;
    }

    if (session.status !== 'running') {
        return false;
    }

    if (pendingStatus) {
        return true;
    }

    const updatedAtMs = Date.parse(session.updatedAt);
    if (Number.isNaN(updatedAtMs)) {
        return true;
    }

    return nowMs - updatedAtMs < TURN_LOCK_IDLE_GRACE_MS;
}
