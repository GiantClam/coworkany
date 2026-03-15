/**
 * Patch Reducer
 *
 * Handles PATCH_PROPOSED, PATCH_APPLIED, and PATCH_REJECTED events
 */

import type { TaskSession, TaskEvent } from '../../../types';

export function applyPatchEvent(session: TaskSession, event: TaskEvent): TaskSession {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'PATCH_PROPOSED': {
            const patch = payload.patch as Record<string, unknown>;
            return {
                ...session,
                patches: [
                    ...session.patches,
                    {
                        patchId: patch.id as string,
                        filePath: patch.filePath as string | undefined,
                        status: 'proposed',
                    },
                ],
            };
        }

        case 'PATCH_APPLIED':
            return {
                ...session,
                patches: session.patches.map((patch) =>
                    patch.patchId === payload.patchId
                        ? { ...patch, status: 'applied', filePath: payload.filePath as string }
                        : patch
                ),
            };

        case 'PATCH_REJECTED':
            return {
                ...session,
                patches: session.patches.map((patch) =>
                    patch.patchId === payload.patchId
                        ? { ...patch, status: 'rejected' }
                        : patch
                ),
            };

        default:
            return session;
    }
}
