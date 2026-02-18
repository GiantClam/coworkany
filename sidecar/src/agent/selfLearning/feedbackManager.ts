/**
 * CoworkAny - User Feedback Manager
 *
 * Handles explicit user feedback on learned skills and knowledge.
 * Feedback has higher weight than implicit success/failure signals
 * for confidence updates.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
    UserFeedback,
    FeedbackType,
    FeedbackStats,
} from './types';
import type { ConfidenceTracker } from './confidenceTracker';

// ============================================================================
// Constants
// ============================================================================

const FEEDBACK_FILE = 'feedback.json';
const FEEDBACK_CONFIDENCE_WEIGHT = 2.5; // User feedback has 2.5x weight vs implicit

// ============================================================================
// FeedbackManager Class
// ============================================================================

export class FeedbackManager {
    private storagePath: string;
    private feedbackMap: Map<string, UserFeedback[]>;
    private confidenceTracker: ConfidenceTracker;

    constructor(storagePath: string, confidenceTracker: ConfidenceTracker) {
        this.storagePath = storagePath;
        this.confidenceTracker = confidenceTracker;
        this.feedbackMap = new Map();
        this.load();
    }

    // ========================================================================
    // Feedback Recording
    // ========================================================================

    /**
     * Record user feedback for a skill or knowledge
     */
    async recordFeedback(
        entityId: string,
        entityType: 'knowledge' | 'skill',
        feedbackType: FeedbackType,
        options?: {
            rating?: number;
            comment?: string;
            suggestedImprovement?: string;
            taskContext?: string;
        }
    ): Promise<UserFeedback> {
        const feedback: UserFeedback = {
            id: crypto.randomUUID(),
            entityId,
            entityType,
            feedbackType,
            rating: options?.rating,
            comment: options?.comment,
            suggestedImprovement: options?.suggestedImprovement,
            taskContext: options?.taskContext,
            timestamp: new Date().toISOString(),
        };

        // Store feedback
        const existing = this.feedbackMap.get(entityId) || [];
        existing.push(feedback);
        this.feedbackMap.set(entityId, existing);

        // Update confidence based on feedback
        await this.updateConfidenceFromFeedback(entityId, feedbackType, options?.rating);

        // Persist
        this.save();

        return feedback;
    }

    /**
     * Update confidence based on user feedback
     */
    private async updateConfidenceFromFeedback(
        entityId: string,
        feedbackType: FeedbackType,
        rating?: number
    ): Promise<void> {
        // Map feedback to success/failure with weight
        let successSignals = 0;
        let failureSignals = 0;

        switch (feedbackType) {
            case 'helpful':
                successSignals = FEEDBACK_CONFIDENCE_WEIGHT;
                break;
            case 'not_helpful':
                failureSignals = FEEDBACK_CONFIDENCE_WEIGHT;
                break;
            case 'partially_helpful':
                successSignals = FEEDBACK_CONFIDENCE_WEIGHT * 0.5;
                failureSignals = FEEDBACK_CONFIDENCE_WEIGHT * 0.5;
                break;
            case 'needs_improvement':
                failureSignals = FEEDBACK_CONFIDENCE_WEIGHT * 0.7;
                break;
        }

        // Apply rating modifier if provided
        if (rating !== undefined) {
            const ratingMultiplier = (rating - 3) / 2; // -1 to +1
            if (ratingMultiplier > 0) {
                successSignals += ratingMultiplier * FEEDBACK_CONFIDENCE_WEIGHT;
            } else {
                failureSignals += Math.abs(ratingMultiplier) * FEEDBACK_CONFIDENCE_WEIGHT;
            }
        }

        // Record weighted signals
        for (let i = 0; i < Math.floor(successSignals); i++) {
            this.confidenceTracker.recordUsage(
                entityId,
                true,
                `feedback-${crypto.randomUUID()}`,
                'User feedback: positive'
            );
        }

        for (let i = 0; i < Math.floor(failureSignals); i++) {
            this.confidenceTracker.recordUsage(
                entityId,
                false,
                `feedback-${crypto.randomUUID()}`,
                'User feedback: negative'
            );
        }
    }

    // ========================================================================
    // Feedback Querying
    // ========================================================================

    /**
     * Get all feedback for an entity
     */
    getFeedback(entityId: string): UserFeedback[] {
        return this.feedbackMap.get(entityId) || [];
    }

    /**
     * Get feedback statistics for an entity
     */
    getStats(entityId: string): FeedbackStats | null {
        const feedbacks = this.feedbackMap.get(entityId);
        if (!feedbacks || feedbacks.length === 0) {
            return null;
        }

        const helpfulCount = feedbacks.filter(f => f.feedbackType === 'helpful').length;
        const notHelpfulCount = feedbacks.filter(f => f.feedbackType === 'not_helpful').length;

        const ratingsWithValue = feedbacks.filter(f => f.rating !== undefined);
        const averageRating = ratingsWithValue.length > 0
            ? ratingsWithValue.reduce((sum, f) => sum + (f.rating || 0), 0) / ratingsWithValue.length
            : 0;

        // Extract common issues from comments
        const issueKeywords = new Map<string, number>();
        for (const feedback of feedbacks) {
            if (feedback.comment) {
                const words = feedback.comment.toLowerCase().split(/\s+/);
                for (const word of words) {
                    if (word.length > 4) {
                        issueKeywords.set(word, (issueKeywords.get(word) || 0) + 1);
                    }
                }
            }
        }

        const commonIssues = [...issueKeywords.entries()]
            .filter(([_, count]) => count >= 2)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([word]) => word);

        return {
            entityId,
            totalFeedback: feedbacks.length,
            helpfulCount,
            notHelpfulCount,
            averageRating,
            commonIssues,
            lastFeedback: feedbacks[feedbacks.length - 1].timestamp,
        };
    }

    /**
     * Get entities that need attention based on feedback
     */
    getEntitiesNeedingAttention(): Array<{
        entityId: string;
        reason: string;
        stats: FeedbackStats;
    }> {
        const needsAttention: Array<{
            entityId: string;
            reason: string;
            stats: FeedbackStats;
        }> = [];

        for (const [entityId] of this.feedbackMap) {
            const stats = this.getStats(entityId);
            if (!stats) continue;

            // Check for concerning patterns
            if (stats.totalFeedback >= 3) {
                const helpfulRatio = stats.helpfulCount / stats.totalFeedback;

                if (helpfulRatio < 0.3) {
                    needsAttention.push({
                        entityId,
                        reason: 'Low helpful ratio - consider relearning',
                        stats,
                    });
                } else if (stats.averageRating > 0 && stats.averageRating < 2.5) {
                    needsAttention.push({
                        entityId,
                        reason: 'Low average rating',
                        stats,
                    });
                }
            }

            // Check for improvement suggestions
            const feedbacks = this.feedbackMap.get(entityId) || [];
            const improvementSuggestions = feedbacks.filter(f => f.suggestedImprovement);
            if (improvementSuggestions.length >= 2) {
                needsAttention.push({
                    entityId,
                    reason: `${improvementSuggestions.length} improvement suggestions pending`,
                    stats,
                });
            }
        }

        return needsAttention;
    }

    /**
     * Get improvement suggestions for an entity
     */
    getImprovementSuggestions(entityId: string): string[] {
        const feedbacks = this.feedbackMap.get(entityId) || [];
        return feedbacks
            .filter(f => f.suggestedImprovement)
            .map(f => f.suggestedImprovement as string);
    }

    // ========================================================================
    // Persistence
    // ========================================================================

    private getFilePath(): string {
        return path.join(this.storagePath, FEEDBACK_FILE);
    }

    private load(): void {
        try {
            const filePath = this.getFilePath();
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                this.feedbackMap = new Map(Object.entries(data));
            }
        } catch (error) {
            console.warn('[FeedbackManager] Failed to load feedback:', error);
        }
    }

    private save(): void {
        try {
            const dir = this.storagePath;
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const data = Object.fromEntries(this.feedbackMap);
            fs.writeFileSync(
                this.getFilePath(),
                JSON.stringify(data, null, 2)
            );
        } catch (error) {
            console.error('[FeedbackManager] Failed to save feedback:', error);
        }
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createFeedbackManager(
    storagePath: string,
    confidenceTracker: ConfidenceTracker
): FeedbackManager {
    return new FeedbackManager(storagePath, confidenceTracker);
}
