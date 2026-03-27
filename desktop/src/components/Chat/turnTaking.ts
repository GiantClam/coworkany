import type { TaskSession } from '../../types';

export function isConversationTurnLocked(session: TaskSession | null | undefined): boolean {
    if (!session || session.isDraft) {
        return false;
    }

    return session.status === 'running';
}
