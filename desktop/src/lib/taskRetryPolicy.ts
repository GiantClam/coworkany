import type { TaskSession } from '../types';

export function isSuspendedForApproval(
    session: Pick<TaskSession, 'status' | 'suspension'> | null | undefined,
): boolean {
    if (!session || session.status !== 'suspended') {
        return false;
    }
    const reason = (session.suspension?.reason ?? '').trim().toLowerCase();
    return reason.includes('approval_required');
}

type EventRef = Pick<NonNullable<TaskSession['events']>[number], 'type' | 'payload'>;

function getEventRequestId(event: EventRef): string | null {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === 'EFFECT_REQUESTED') {
        const request = payload.request as Record<string, unknown> | undefined;
        const requestId = typeof request?.id === 'string' ? request.id.trim() : '';
        return requestId || null;
    }
    if (event.type === 'EFFECT_APPROVED' || event.type === 'EFFECT_DENIED') {
        const response = payload.response as Record<string, unknown> | undefined;
        const requestId = typeof response?.requestId === 'string' ? response.requestId.trim() : '';
        return requestId || null;
    }
    return null;
}

export function hasPendingEffectApproval(
    session: Pick<TaskSession, 'effects' | 'events'> | null | undefined,
): boolean {
    return getLatestPendingEffectRequestId(session) !== null;
}

export function getLatestPendingEffectRequestId(
    session: Pick<TaskSession, 'effects' | 'events'> | null | undefined,
): string | null {
    if (!session) {
        return null;
    }

    const requestStates = new Map<string, { pending: boolean; order: number }>();
    for (const [index, event] of (session.events ?? []).entries()) {
        const requestId = getEventRequestId(event);
        if (!requestId) {
            continue;
        }
        if (event.type === 'EFFECT_REQUESTED') {
            requestStates.set(requestId, { pending: true, order: index });
            continue;
        }
        if (event.type === 'EFFECT_APPROVED' || event.type === 'EFFECT_DENIED') {
            requestStates.set(requestId, { pending: false, order: index });
        }
    }

    let latestPendingFromEvents: { requestId: string; order: number } | null = null;
    for (const [requestId, state] of requestStates.entries()) {
        if (!state.pending) {
            continue;
        }
        if (!latestPendingFromEvents || state.order > latestPendingFromEvents.order) {
            latestPendingFromEvents = { requestId, order: state.order };
        }
    }
    if (latestPendingFromEvents) {
        return latestPendingFromEvents.requestId;
    }

    const pendingEffects = (session.effects ?? [])
        .map((effect, index) => ({ effect, index }))
        .filter(({ effect }) => effect.approved === undefined && effect.requestId.trim().length > 0);
    if (pendingEffects.length === 0) {
        return null;
    }
    const latestPendingEffect = pendingEffects[pendingEffects.length - 1];
    return latestPendingEffect?.effect.requestId ?? null;
}
