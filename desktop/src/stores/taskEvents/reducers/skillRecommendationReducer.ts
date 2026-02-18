/**
 * Skill Recommendation Reducer
 *
 * Handles SKILL_RECOMMENDATION events from the sidecar
 */

import type { TaskSession, TaskEvent } from '../../../types';

export interface SkillRecommendation {
    skillName: string;
    confidence: number;
    reason: string;
    autoLoad: boolean;
    priority: number;
}

export interface SkillRecommendationData {
    taskId: string;
    recommendations: SkillRecommendation[];
    autoLoaded: SkillRecommendation | null;
    timestamp: string;
}

export function applySkillRecommendationEvent(
    session: TaskSession,
    event: TaskEvent
): TaskSession {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'SKILL_RECOMMENDATION': {
            const recommendations = payload.recommendations as SkillRecommendation[];
            const autoLoaded = payload.autoLoaded as SkillRecommendation | null;

            // Add a system message to inform the user about skill recommendations
            const recommendationMessage = formatRecommendationMessage(
                recommendations,
                autoLoaded
            );

            return {
                ...session,
                skillRecommendations: recommendations,
                messages: [
                    ...session.messages,
                    {
                        id: event.id,
                        role: 'system',
                        content: recommendationMessage,
                        timestamp: event.timestamp,
                    },
                ],
            };
        }

        default:
            return session;
    }
}

/**
 * Format skill recommendations as a user-friendly message
 */
function formatRecommendationMessage(
    recommendations: SkillRecommendation[],
    autoLoaded: SkillRecommendation | null
): string {
    const lines: string[] = [];

    if (autoLoaded) {
        lines.push(`✅ Auto-loaded skill: **${autoLoaded.skillName}** (${(autoLoaded.confidence * 100).toFixed(0)}% confidence)`);
        lines.push(`   ${autoLoaded.reason}`);
        lines.push('');
    }

    if (recommendations.length > 0 && !autoLoaded) {
        lines.push('📚 **Recommended Skills:**');
        lines.push('');

        recommendations.slice(0, 3).forEach((rec, index) => {
            const confidencePercent = (rec.confidence * 100).toFixed(0);
            lines.push(`${index + 1}. **${rec.skillName}** (${confidencePercent}% match)`);
            lines.push(`   ${rec.reason}`);
            lines.push('');
        });

        if (recommendations.length > 3) {
            lines.push(`   _...and ${recommendations.length - 3} more suggestions_`);
        }
    }

    return lines.join('\n').trim();
}
