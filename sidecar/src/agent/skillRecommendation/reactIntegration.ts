/**
 * ReAct Integration for Skill Recommendation
 *
 * Integrates skill recommendation into the ReAct controller
 */

import { getIntentAnalyzer } from './intentAnalyzer';
import { getSkillRecommender } from './skillRecommender';
import type { IntentContext, SkillRecommendation } from './types';

/**
 * Analyze message and recommend skills for ReAct controller
 */
export async function analyzeAndRecommendSkills(
    userMessage: string,
    recentMessages: string[],
    recentErrors: string[],
    activeSkills: string[],
    workspacePath?: string
): Promise<{
    recommendations: SkillRecommendation[];
    shouldAutoLoad: SkillRecommendation | null;
}> {
    // Build context
    const context: IntentContext = {
        currentMessage: userMessage,
        recentMessages,
        recentErrors,
        activeSkills,
        workspaceType: detectWorkspaceType(workspacePath)
    };

    // Analyze intent
    const analyzer = getIntentAnalyzer();
    const intent = analyzer.analyze(context);

    console.log(`[SkillRecommendation] Detected intent: ${intent.type} (confidence: ${intent.confidence.toFixed(2)})`);

    // Skip recommendation if confidence is too low
    if (intent.confidence < 0.3) {
        console.log('[SkillRecommendation] Intent confidence too low, skipping recommendation');
        return { recommendations: [], shouldAutoLoad: null };
    }

    // Recommend skills
    const recommender = getSkillRecommender();
    const recommendations = recommender.recommend(intent, context);

    console.log(`[SkillRecommendation] Found ${recommendations.length} recommendations`);

    // Find top auto-load candidate
    const autoLoad = recommendations.find(r => r.autoLoad) || null;

    if (autoLoad) {
        console.log(`[SkillRecommendation] Auto-load candidate: ${autoLoad.skillName} (confidence: ${autoLoad.confidence.toFixed(2)})`);
    }

    return { recommendations, shouldAutoLoad: autoLoad };
}

/**
 * Detect workspace type from path
 */
function detectWorkspaceType(workspacePath?: string): string | undefined {
    if (!workspacePath) return undefined;

    const pathLower = workspacePath.toLowerCase();

    // Check for common project files/directories
    if (pathLower.includes('cargo.toml')) return 'rust';
    if (pathLower.includes('package.json')) {
        // Further distinguish
        if (pathLower.includes('react')) return 'react';
        if (pathLower.includes('vue')) return 'vue';
        if (pathLower.includes('next')) return 'nextjs';
        return 'node';
    }
    if (pathLower.includes('requirements.txt') || pathLower.includes('setup.py')) return 'python';
    if (pathLower.includes('go.mod')) return 'go';
    if (pathLower.includes('pom.xml') || pathLower.includes('build.gradle')) return 'java';

    return undefined;
}

/**
 * Format recommendations for display
 */
export function formatRecommendationsForUser(recommendations: SkillRecommendation[]): string {
    if (recommendations.length === 0) {
        return '';
    }

    const lines = ['📚 Recommended skills for this task:'];

    recommendations.forEach((rec, idx) => {
        const emoji = rec.autoLoad ? '✨' : '💡';
        const autoLoadText = rec.autoLoad ? ' (will auto-load)' : '';
        lines.push(`  ${emoji} ${idx + 1}. ${rec.skillName}${autoLoadText}`);
        lines.push(`     Reason: ${rec.reason}`);
        lines.push(`     Confidence: ${(rec.confidence * 100).toFixed(0)}%`);
    });

    return lines.join('\n');
}

/**
 * Create skill recommendation event for IPC
 */
export function createSkillRecommendationEvent(
    taskId: string,
    recommendations: SkillRecommendation[],
    autoLoaded: SkillRecommendation | null
): Record<string, unknown> {
    return {
        type: 'skill_recommendation',
        taskId,
        recommendations: recommendations.map(r => ({
            skillName: r.skillName,
            confidence: r.confidence,
            reason: r.reason,
            autoLoad: r.autoLoad,
            priority: r.priority
        })),
        autoLoaded: autoLoaded ? {
            skillName: autoLoaded.skillName,
            confidence: autoLoaded.confidence,
            reason: autoLoaded.reason
        } : null,
        timestamp: new Date().toISOString()
    };
}
