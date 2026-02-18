/**
 * CoworkAny - Proactive Learner
 *
 * Predicts what skills the user might need based on usage patterns
 * and proactively learns them during idle time.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    LearningPrediction,
    ProactiveLearningConfig,
    LearningSession,
} from './types';
import type { SelfLearningController } from './controller';
import type { ConfidenceTracker } from './confidenceTracker';

// ============================================================================
// Constants
// ============================================================================

const PATTERN_FILE = 'usage-patterns.json';
const PREDICTIONS_FILE = 'predictions.json';

const DEFAULT_PROACTIVE_CONFIG: ProactiveLearningConfig = {
    enabled: false, // Disabled by default, user must opt-in
    maxBackgroundSessions: 1,
    learningSchedule: 'idle',
    minPredictionConfidence: 0.6,
    maxDailyLearnings: 3,
};

// Common topic relationships for prediction
const TOPIC_RELATIONSHIPS: Record<string, string[]> = {
    'video': ['ffmpeg', 'audio', 'streaming', 'encoding'],
    'image': ['pillow', 'opencv', 'imagemagick', 'resize', 'crop'],
    'data': ['pandas', 'numpy', 'csv', 'excel', 'json'],
    'web': ['scraping', 'requests', 'beautifulsoup', 'selenium'],
    'api': ['rest', 'graphql', 'authentication', 'rate-limiting'],
    'database': ['sql', 'postgresql', 'mongodb', 'redis'],
    'ml': ['tensorflow', 'pytorch', 'scikit-learn', 'training'],
    'automation': ['scheduling', 'cron', 'task-queue', 'workflow'],
    'pdf': ['pypdf', 'reportlab', 'ocr', 'extraction'],
    'email': ['smtp', 'imap', 'parsing', 'templates'],
};

// ============================================================================
// Types
// ============================================================================

interface UsagePattern {
    topic: string;
    count: number;
    lastUsed: string;
    relatedTopics: string[];
    successRate: number;
}

interface BackgroundSession {
    sessionId: string;
    prediction: LearningPrediction;
    startedAt: string;
    status: 'running' | 'completed' | 'failed';
}

// ============================================================================
// ProactiveLearner Class
// ============================================================================

export class ProactiveLearner {
    private storagePath: string;
    private config: ProactiveLearningConfig;
    private learningController?: SelfLearningController;
    private confidenceTracker: ConfidenceTracker;
    private patterns: Map<string, UsagePattern>;
    private predictions: LearningPrediction[];
    private activeSessions: Map<string, BackgroundSession>;
    private dailyLearningCount: number;
    private lastResetDate: string;
    private idleTimer?: NodeJS.Timeout;

    constructor(
        storagePath: string,
        confidenceTracker: ConfidenceTracker,
        config?: Partial<ProactiveLearningConfig>
    ) {
        this.storagePath = storagePath;
        this.confidenceTracker = confidenceTracker;
        this.config = { ...DEFAULT_PROACTIVE_CONFIG, ...config };
        this.patterns = new Map();
        this.predictions = [];
        this.activeSessions = new Map();
        this.dailyLearningCount = 0;
        this.lastResetDate = new Date().toISOString().split('T')[0];

        this.load();
    }

    /**
     * Set the learning controller (called after controller is created)
     */
    setLearningController(controller: SelfLearningController): void {
        this.learningController = controller;
    }

    // ========================================================================
    // Pattern Tracking
    // ========================================================================

    /**
     * Record a user query to update usage patterns
     */
    recordQuery(query: string, success: boolean): void {
        const topics = this.extractTopics(query);

        for (const topic of topics) {
            let pattern = this.patterns.get(topic);
            if (!pattern) {
                pattern = {
                    topic,
                    count: 0,
                    lastUsed: new Date().toISOString(),
                    relatedTopics: this.getRelatedTopics(topic),
                    successRate: 1.0,
                };
            }

            pattern.count++;
            pattern.lastUsed = new Date().toISOString();
            pattern.successRate = (pattern.successRate * (pattern.count - 1) + (success ? 1 : 0)) / pattern.count;
            this.patterns.set(topic, pattern);
        }

        this.save();

        // Update predictions after new data
        this.generatePredictions();
    }

    /**
     * Extract topics from query
     */
    private extractTopics(query: string): string[] {
        const topics: string[] = [];
        const lowerQuery = query.toLowerCase();

        // Check against known topics
        for (const topic of Object.keys(TOPIC_RELATIONSHIPS)) {
            if (lowerQuery.includes(topic)) {
                topics.push(topic);
            }
        }

        // Check against related terms
        for (const [topic, related] of Object.entries(TOPIC_RELATIONSHIPS)) {
            for (const term of related) {
                if (lowerQuery.includes(term)) {
                    topics.push(topic);
                    break;
                }
            }
        }

        return [...new Set(topics)];
    }

    /**
     * Get related topics
     */
    private getRelatedTopics(topic: string): string[] {
        return TOPIC_RELATIONSHIPS[topic] || [];
    }

    // ========================================================================
    // Prediction Generation
    // ========================================================================

    /**
     * Generate predictions based on usage patterns
     */
    generatePredictions(): LearningPrediction[] {
        this.predictions = [];

        // Get frequently used topics
        const sortedPatterns = [...this.patterns.values()]
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // Predict related topics that haven't been learned
        for (const pattern of sortedPatterns) {
            for (const relatedTopic of pattern.relatedTopics) {
                // Check if we already know this topic
                const existingPattern = this.patterns.get(relatedTopic);
                if (existingPattern && existingPattern.count > 2) {
                    continue; // Already used enough
                }

                // Check if already predicted
                if (this.predictions.find(p => p.topic === relatedTopic)) {
                    continue;
                }

                // Calculate prediction confidence
                const confidence = this.calculatePredictionConfidence(
                    pattern,
                    relatedTopic
                );

                if (confidence >= this.config.minPredictionConfidence) {
                    this.predictions.push({
                        topic: relatedTopic,
                        confidence,
                        reason: `Based on frequent use of ${pattern.topic}`,
                        basedOnPatterns: [pattern.topic],
                        estimatedUsefulness: confidence * pattern.successRate,
                        priority: confidence > 0.8 ? 'high' : confidence > 0.6 ? 'medium' : 'low',
                    });
                }
            }
        }

        // Sort by usefulness
        this.predictions.sort((a, b) => b.estimatedUsefulness - a.estimatedUsefulness);

        this.savePredictions();

        return this.predictions;
    }

    /**
     * Calculate prediction confidence
     */
    private calculatePredictionConfidence(
        sourcePattern: UsagePattern,
        targetTopic: string
    ): number {
        let confidence = 0.5;

        // Higher usage of source → higher confidence
        if (sourcePattern.count >= 10) confidence += 0.2;
        else if (sourcePattern.count >= 5) confidence += 0.1;

        // Recent usage → higher confidence
        const daysSinceUse = this.daysSince(sourcePattern.lastUsed);
        if (daysSinceUse < 7) confidence += 0.15;
        else if (daysSinceUse < 30) confidence += 0.05;

        // High success rate → higher confidence
        if (sourcePattern.successRate >= 0.8) confidence += 0.1;

        // Topic is directly related → higher confidence
        if (TOPIC_RELATIONSHIPS[sourcePattern.topic]?.includes(targetTopic)) {
            confidence += 0.1;
        }

        return Math.min(confidence, 1.0);
    }

    /**
     * Calculate days since a date
     */
    private daysSince(dateStr: string): number {
        const date = new Date(dateStr);
        const now = new Date();
        return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    }

    // ========================================================================
    // Proactive Learning
    // ========================================================================

    /**
     * Start proactive learning (called when system is idle)
     */
    async startProactiveLearning(): Promise<{
        started: boolean;
        prediction?: LearningPrediction;
        reason?: string;
    }> {
        if (!this.config.enabled) {
            return { started: false, reason: 'Proactive learning is disabled' };
        }

        if (!this.learningController) {
            return { started: false, reason: 'Learning controller not set' };
        }

        // Reset daily count if new day
        this.checkDailyReset();

        if (this.dailyLearningCount >= this.config.maxDailyLearnings) {
            return { started: false, reason: 'Daily learning limit reached' };
        }

        if (this.activeSessions.size >= this.config.maxBackgroundSessions) {
            return { started: false, reason: 'Max concurrent sessions reached' };
        }

        // Get top prediction
        const prediction = this.predictions.find(p =>
            !this.activeSessions.has(p.topic)
        );

        if (!prediction) {
            return { started: false, reason: 'No suitable predictions' };
        }

        // Start learning session
        try {
            const session = await this.learningController.learn(
                `Learn about ${prediction.topic} for future use`
            );

            const backgroundSession: BackgroundSession = {
                sessionId: session.id,
                prediction,
                startedAt: new Date().toISOString(),
                status: 'running',
            };

            this.activeSessions.set(prediction.topic, backgroundSession);
            this.dailyLearningCount++;

            // Monitor session completion
            this.monitorSession(prediction.topic, session);

            return {
                started: true,
                prediction,
            };
        } catch (error) {
            console.error('[ProactiveLearner] Failed to start learning:', error);
            return {
                started: false,
                reason: `Failed to start: ${error}`,
            };
        }
    }

    /**
     * Monitor a learning session
     */
    private monitorSession(topic: string, session: LearningSession): void {
        const checkInterval = setInterval(() => {
            const bgSession = this.activeSessions.get(topic);
            if (!bgSession) {
                clearInterval(checkInterval);
                return;
            }

            if (session.status === 'completed' || session.status === 'failed') {
                bgSession.status = session.status;
                this.activeSessions.delete(topic);
                clearInterval(checkInterval);

                // Remove from predictions if successful
                if (session.status === 'completed') {
                    this.predictions = this.predictions.filter(p => p.topic !== topic);
                    this.savePredictions();
                }
            }
        }, 5000);
    }

    /**
     * Check and reset daily learning count
     */
    private checkDailyReset(): void {
        const today = new Date().toISOString().split('T')[0];
        if (this.lastResetDate !== today) {
            this.dailyLearningCount = 0;
            this.lastResetDate = today;
        }
    }

    // ========================================================================
    // Idle Detection
    // ========================================================================

    /**
     * Start idle monitoring
     */
    startIdleMonitoring(idleThresholdMs: number = 5 * 60 * 1000): void {
        if (this.config.learningSchedule === 'scheduled') {
            return; // Only use scheduled learning
        }

        // This would integrate with the main application's activity tracker
        console.log('[ProactiveLearner] Idle monitoring started');
    }

    /**
     * Report user activity (resets idle timer)
     */
    reportActivity(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }

        // Set new idle timer (5 minutes)
        this.idleTimer = setTimeout(() => {
            this.onIdle();
        }, 5 * 60 * 1000);
    }

    /**
     * Called when system becomes idle
     */
    private async onIdle(): Promise<void> {
        if (this.config.learningSchedule !== 'scheduled') {
            await this.startProactiveLearning();
        }
    }

    /**
     * Stop idle monitoring
     */
    stopIdleMonitoring(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = undefined;
        }
    }

    // ========================================================================
    // Queries
    // ========================================================================

    /**
     * Get current predictions
     */
    getPredictions(): LearningPrediction[] {
        return [...this.predictions];
    }

    /**
     * Get usage patterns
     */
    getPatterns(): UsagePattern[] {
        return [...this.patterns.values()];
    }

    /**
     * Get active background sessions
     */
    getActiveSessions(): BackgroundSession[] {
        return [...this.activeSessions.values()];
    }

    /**
     * Get statistics
     */
    getStatistics(): {
        totalPatterns: number;
        totalPredictions: number;
        activeSessions: number;
        dailyLearningsRemaining: number;
        topTopics: Array<{ topic: string; count: number }>;
    } {
        const topTopics = [...this.patterns.values()]
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map(p => ({ topic: p.topic, count: p.count }));

        return {
            totalPatterns: this.patterns.size,
            totalPredictions: this.predictions.length,
            activeSessions: this.activeSessions.size,
            dailyLearningsRemaining: Math.max(0, this.config.maxDailyLearnings - this.dailyLearningCount),
            topTopics,
        };
    }

    // ========================================================================
    // Configuration
    // ========================================================================

    /**
     * Enable proactive learning
     */
    enable(): void {
        this.config.enabled = true;
        this.save();
    }

    /**
     * Disable proactive learning
     */
    disable(): void {
        this.config.enabled = false;
        this.stopIdleMonitoring();
        this.save();
    }

    /**
     * Update configuration
     */
    updateConfig(updates: Partial<ProactiveLearningConfig>): void {
        this.config = { ...this.config, ...updates };
        this.save();
    }

    /**
     * Get current configuration
     */
    getConfig(): ProactiveLearningConfig {
        return { ...this.config };
    }

    // ========================================================================
    // Persistence
    // ========================================================================

    private getPatternsFilePath(): string {
        return path.join(this.storagePath, PATTERN_FILE);
    }

    private getPredictionsFilePath(): string {
        return path.join(this.storagePath, PREDICTIONS_FILE);
    }

    private load(): void {
        try {
            // Load patterns
            const patternsPath = this.getPatternsFilePath();
            if (fs.existsSync(patternsPath)) {
                const data = JSON.parse(fs.readFileSync(patternsPath, 'utf-8'));
                this.patterns = new Map(Object.entries(data.patterns || {}));
                this.dailyLearningCount = data.dailyLearningCount || 0;
                this.lastResetDate = data.lastResetDate || new Date().toISOString().split('T')[0];
                if (data.config) {
                    this.config = { ...this.config, ...data.config };
                }
            }

            // Load predictions
            const predictionsPath = this.getPredictionsFilePath();
            if (fs.existsSync(predictionsPath)) {
                this.predictions = JSON.parse(fs.readFileSync(predictionsPath, 'utf-8'));
            }
        } catch (error) {
            console.warn('[ProactiveLearner] Failed to load data:', error);
        }
    }

    private save(): void {
        try {
            const dir = this.storagePath;
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const data = {
                patterns: Object.fromEntries(this.patterns),
                dailyLearningCount: this.dailyLearningCount,
                lastResetDate: this.lastResetDate,
                config: this.config,
            };

            fs.writeFileSync(
                this.getPatternsFilePath(),
                JSON.stringify(data, null, 2)
            );
        } catch (error) {
            console.error('[ProactiveLearner] Failed to save:', error);
        }
    }

    private savePredictions(): void {
        try {
            const dir = this.storagePath;
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(
                this.getPredictionsFilePath(),
                JSON.stringify(this.predictions, null, 2)
            );
        } catch (error) {
            console.error('[ProactiveLearner] Failed to save predictions:', error);
        }
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createProactiveLearner(
    storagePath: string,
    confidenceTracker: ConfidenceTracker,
    config?: Partial<ProactiveLearningConfig>
): ProactiveLearner {
    return new ProactiveLearner(storagePath, confidenceTracker, config);
}
