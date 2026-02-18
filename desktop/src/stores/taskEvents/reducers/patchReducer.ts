/**
 * Patch Reducer
 *
 * Handles PATCH_PROPOSED, PATCH_APPLIED, and PATCH_REJECTED events
 */

import type { TaskSession, TaskEvent } from '../../../types';

function appendSystemMessage(session: TaskSession, event: TaskEvent, content: string): TaskSession {
    return {
        ...session,
        messages: [
            ...session.messages,
            {
                id: event.id,
                role: 'system',
                content,
                timestamp: event.timestamp,
            },
        ],
    };
}

export function applyPatchEvent(session: TaskSession, event: TaskEvent): TaskSession {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'PATCH_PROPOSED': {
            const patch = payload.patch as Record<string, unknown>;
            return appendSystemMessage(
                {
                    ...session,
                    patches: [
                        ...session.patches,
                        {
                            patchId: patch.id as string,
                            filePath: patch.filePath as string | undefined,
                            status: 'proposed',
                        },
                    ],
                },
                event,
                `Patch proposed: ${(patch.filePath as string) || 'unknown'}`
            );
        }

        case 'PATCH_APPLIED':
            return appendSystemMessage(
                {
                    ...session,
                    patches: session.patches.map((patch) =>
                        patch.patchId === payload.patchId
                            ? { ...patch, status: 'applied', filePath: payload.filePath as string }
                            : patch
                    ),
                },
                event,
                `Patch applied: ${(payload.filePath as string) || 'unknown'}`
            );

        case 'PATCH_REJECTED':
            return appendSystemMessage(
                {
                    ...session,
                    patches: session.patches.map((patch) =>
                        patch.patchId === payload.patchId
                            ? { ...patch, status: 'rejected' }
                            : patch
                    ),
                },
                event,
                `Patch rejected`
            );

        default:
            return session;
    }
}
