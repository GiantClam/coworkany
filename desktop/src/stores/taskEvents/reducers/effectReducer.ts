/**
 * Effect Reducer
 *
 * Handles EFFECT_REQUESTED, EFFECT_APPROVED, and EFFECT_DENIED events
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

export function applyEffectEvent(session: TaskSession, event: TaskEvent): TaskSession {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'EFFECT_REQUESTED': {
            const request = payload.request as Record<string, unknown>;
            return appendSystemMessage(
                {
                    ...session,
                    effects: [
                        ...session.effects,
                        {
                            requestId: request.id as string,
                            effectType: request.effectType as string,
                            riskLevel: payload.riskLevel as number,
                        },
                    ],
                },
                event,
                `Effect requested: ${(request.effectType as string) || 'unknown'} (risk ${(payload.riskLevel as number) || 0}/10)`
            );
        }

        case 'EFFECT_APPROVED':
        case 'EFFECT_DENIED': {
            const response = payload.response as Record<string, unknown>;
            const approved = event.type === 'EFFECT_APPROVED';
            return appendSystemMessage(
                {
                    ...session,
                    effects: session.effects.map((effect) =>
                        effect.requestId === response.requestId
                            ? { ...effect, approved }
                            : effect
                    ),
                },
                event,
                `Effect ${approved ? 'approved' : 'denied'}`
            );
        }

        default:
            return session;
    }
}
