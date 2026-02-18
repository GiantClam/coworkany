/**
 * CoworkAny - Self-Learning Controller
 *
 * Orchestrates the complete self-learning cycle:
 * Gap Detection → Research → Learning → Experiment → Precipitation → Reuse
 */

import * as crypto from 'crypto';
import type {
    SelfLearningConfig,
    LearningSession,
    SessionStatus,
    CapabilityGap,
    ReuseDecision,
    SelfLearningEvent,
    SelfLearningEventType,
    SelfLearningEventHandler,
} from './types';
import { DEFAULT_CONFIG } from './types';
import type { GapDetector } from './gapDetector';
import type { ResearchEngine } from './researchEngine';
import type { LearningProcessor } from './learningProcessor';
import type { LabSandbox } from './labSandbox';
import type { Precipitator } from './precipitator';
import type { ReuseEngine } from './reuseEngine';
import type { ConfidenceTracker } from './confidenceTracker';
import type { FeedbackManager } from './feedbackManager';
import type { SkillVersionManager } from './versionManager';
import type { ProactiveLearner } from './proactiveLearner';

// ============================================================================
// Types
// ============================================================================

export interface SelfLearningControllerDependencies {
    gapDetector: GapDetector;
    researchEngine: ResearchEngine;
    learningProcessor: LearningProcessor;
    labSandbox: LabSandbox;
    precipitator: Precipitator;
    reuseEngine: ReuseEngine;
    confidenceTracker: ConfidenceTracker;
    // OpenClaw-style enhancements (optional)
    feedbackManager?: FeedbackManager;
    versionManager?: SkillVersionManager;
    proactiveLearner?: ProactiveLearner;
}

// ============================================================================
// SelfLearningController Class
// ============================================================================

export class SelfLearningController {
    private config: SelfLearningConfig;
    private deps: SelfLearningControllerDependencies;
    private activeSessions: Map<string, LearningSession>;
    private eventHandlers: SelfLearningEventHandler[];

    constructor(
        deps: SelfLearningControllerDependencies,
        config?: Partial<SelfLearningConfig>
    ) {
        this.deps = deps;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.activeSessions = new Map();
        this.eventHandlers = [];
    }

    // ========================================================================
    // Event System
    // ========================================================================

    /**
     * Subscribe to learning events
     */
    onEvent(handler: SelfLearningEventHandler): () => void {
        this.eventHandlers.push(handler);
        return () => {
            const index = this.eventHandlers.indexOf(handler);
            if (index >= 0) {
                this.eventHandlers.splice(index, 1);
            }
        };
    }

    /**
     * Emit an event
     */
    private emitEvent(
        type: SelfLearningEventType,
        sessionId: string,
        data: Record<string, unknown> = {}
    ): void {
        const event: SelfLearningEvent = {
            type,
            sessionId,
            timestamp: new Date().toISOString(),
            data,
        };

        for (const handler of this.eventHandlers) {
            try {
                handler(event);
            } catch (error) {
                console.error('[SelfLearningController] Event handler error:', error);
            }
        }
    }

    // ========================================================================
    // Pre-Learning Check
    // ========================================================================

    /**
     * Check if learning is needed for a query
     */
    async shouldLearn(query: string): Promise<{
        needsLearning: boolean;
        reusable?: ReuseDecision;
        gaps?: CapabilityGap[];
    }> {
        // First check if we can reuse existing capabilities
        const reusable = await this.deps.reuseEngine.findReusable(query);

        if (reusable.shouldUseExisting && reusable.confidence >= this.config.minConfidenceToAutoUse) {
            return {
                needsLearning: false,
                reusable,
            };
        }

        // Check for capability gaps
        const gapResult = await this.deps.gapDetector.detectGaps(query);

        if (gapResult.hasGap && gapResult.recommendedAction === 'learn') {
            return {
                needsLearning: true,
                gaps: gapResult.gaps,
                reusable,
            };
        }

        return {
            needsLearning: false,
            reusable,
        };
    }

    // ========================================================================
    // Main Learning Flow
    // ========================================================================

    /**
     * Execute complete learning cycle
     */
    async learn(userQuery: string): Promise<LearningSession> {
        // Check concurrent session limit
        if (this.activeSessions.size >= this.config.maxConcurrentSessions) {
            throw new Error(`Maximum concurrent learning sessions (${this.config.maxConcurrentSessions}) reached`);
        }

        // Create session
        const session = this.createSession(userQuery);
        this.activeSessions.set(session.id, session);

        this.emitEvent('session_started', session.id, { query: userQuery });

        try {
            // Phase 1: Gap Detection
            await this.runGapDetection(session);

            if (session.gaps.length === 0) {
                session.status = 'completed';
                this.addLog(session, 'info', 'No capability gaps detected');
                return session;
            }

            // Phase 2-5: Process each gap
            for (const gap of session.gaps) {
                if (session.status === 'cancelled') break;

                try {
                    await this.processGap(session, gap);
                } catch (error) {
                    this.addLog(session, 'error', `Failed to process gap: ${gap.description}`);
                    session.errors.push(error instanceof Error ? error.message : String(error));
                }
            }

            // Finalize session
            session.status = session.errors.length === 0 ? 'completed' : 'failed';
            session.endTime = new Date().toISOString();
            session.progress = 100;

            this.emitEvent(
                session.status === 'completed' ? 'session_completed' : 'session_failed',
                session.id,
                { outcomes: session.outcomes, errors: session.errors }
            );

        } catch (error) {
            session.status = 'failed';
            session.endTime = new Date().toISOString();
            session.errors.push(error instanceof Error ? error.message : String(error));

            this.emitEvent('session_failed', session.id, { error: session.errors });
        } finally {
            this.activeSessions.delete(session.id);
        }

        return session;
    }

    /**
     * Run gap detection phase
     */
    private async runGapDetection(session: LearningSession): Promise<void> {
        session.status = 'detecting';
        session.currentPhase = 'Gap Detection';
        session.progress = 5;

        this.emitEvent('gap_detected', session.id, { phase: 'detecting' });

        const gapResult = await this.deps.gapDetector.detectGaps(session.triggerQuery);

        session.gaps = gapResult.gaps;
        session.progress = 10;

        this.addLog(session, 'info', `Detected ${session.gaps.length} capability gap(s)`);
    }

    /**
     * Process a single capability gap
     */
    private async processGap(session: LearningSession, gap: CapabilityGap): Promise<void> {
        gap.userQuery = session.triggerQuery;

        // Phase 2: Research
        session.status = 'researching';
        session.currentPhase = `Researching: ${gap.keywords[0]}`;
        session.progress = 20;

        this.emitEvent('research_started', session.id, { gap: gap.id });
        this.addLog(session, 'info', `Researching: ${gap.description}`);

        const researchResult = await this.deps.researchEngine.research(gap);

        this.emitEvent('research_completed', session.id, {
            gap: gap.id,
            sourcesCount: researchResult.sources.length,
            confidence: researchResult.confidence,
        });

        if (researchResult.sources.length === 0) {
            this.addLog(session, 'warn', `No research sources found for: ${gap.keywords[0]}`);
            return;
        }

        session.progress = 35;

        // Phase 3: Learning
        session.status = 'learning';
        session.currentPhase = `Processing: ${gap.keywords[0]}`;

        this.emitEvent('learning_started', session.id, { gap: gap.id });

        const learningOutcome = await this.deps.learningProcessor.process(researchResult);

        this.emitEvent('learning_completed', session.id, {
            gap: gap.id,
            knowledgeCount: learningOutcome.knowledge.length,
            canGenerateSkill: learningOutcome.canGenerateSkill,
        });

        if (learningOutcome.knowledge.length === 0) {
            this.addLog(session, 'warn', `Could not extract knowledge for: ${gap.keywords[0]}`);
            return;
        }

        session.progress = 50;

        // Phase 4: Experiment
        session.status = 'experimenting';
        session.currentPhase = `Validating: ${gap.keywords[0]}`;

        this.emitEvent('experiment_started', session.id, { gap: gap.id });

        // Process each piece of knowledge
        for (const knowledge of learningOutcome.knowledge) {
            const testCases = learningOutcome.estimatedTestCases.length > 0
                ? learningOutcome.estimatedTestCases
                : this.deps.labSandbox.generateBasicTestCases(knowledge);

            const experimentConfig = this.deps.labSandbox.createExperimentConfig(
                knowledge,
                testCases
            );

            const experimentResult = await this.deps.labSandbox.runExperiment(experimentConfig);

            this.emitEvent('experiment_completed', session.id, {
                gap: gap.id,
                knowledgeId: knowledge.id,
                success: experimentResult.success,
                passedTests: experimentResult.testResults.filter(r => r.passed).length,
            });

            this.addLog(session, 'info',
                `Experiment for "${knowledge.title}": ` +
                `${experimentResult.testResults.filter(r => r.passed).length}/${experimentResult.testResults.length} tests passed`
            );

            session.progress = 70;

            // Phase 5: Precipitation
            if (experimentResult.success || knowledge.confidence >= this.config.minConfidenceToSave) {
                session.status = 'precipitating';
                session.currentPhase = `Saving: ${knowledge.title}`;

                this.emitEvent('precipitation_started', session.id, {
                    gap: gap.id,
                    knowledgeId: knowledge.id,
                });

                const precipitationResult = await this.deps.precipitator.precipitate(
                    knowledge,
                    experimentResult
                );

                this.emitEvent('precipitation_completed', session.id, {
                    gap: gap.id,
                    knowledgeId: knowledge.id,
                    success: precipitationResult.success,
                    type: precipitationResult.type,
                    path: precipitationResult.path,
                });

                if (precipitationResult.success) {
                    session.outcomes.push({
                        type: precipitationResult.type.includes('skill') ? 'skill' : 'knowledge',
                        id: precipitationResult.entityId,
                        path: precipitationResult.path,
                    });

                    // Initialize confidence tracking
                    this.deps.confidenceTracker.initRecord(
                        precipitationResult.entityId,
                        precipitationResult.type.includes('skill') ? 'skill' : 'knowledge',
                        knowledge.confidence
                    );

                    this.addLog(session, 'info',
                        `Saved ${precipitationResult.type}: ${precipitationResult.path}`
                    );
                } else {
                    this.addLog(session, 'error',
                        `Failed to save: ${precipitationResult.error}`
                    );
                }
            }

            session.progress = 90;
        }
    }

    // ========================================================================
    // Session Management
    // ========================================================================

    /**
     * Create a new learning session
     */
    private createSession(query: string): LearningSession {
        return {
            id: crypto.randomUUID(),
            triggerQuery: query,
            gaps: [],
            status: 'detecting',
            startTime: new Date().toISOString(),
            currentPhase: 'Initializing',
            progress: 0,
            outcomes: [],
            errors: [],
            logs: [],
        };
    }

    /**
     * Add log entry to session
     */
    private addLog(
        session: LearningSession,
        level: 'info' | 'warn' | 'error',
        message: string
    ): void {
        session.logs.push({
            timestamp: new Date().toISOString(),
            level,
            message,
        });
    }

    /**
     * Get active learning sessions
     */
    getActiveSessions(): LearningSession[] {
        return [...this.activeSessions.values()];
    }

    /**
     * Get session by ID
     */
    getSession(sessionId: string): LearningSession | undefined {
        return this.activeSessions.get(sessionId);
    }

    /**
     * Cancel a learning session
     */
    async cancelSession(sessionId: string): Promise<boolean> {
        const session = this.activeSessions.get(sessionId);
        if (!session) return false;

        session.status = 'cancelled';
        session.endTime = new Date().toISOString();
        this.addLog(session, 'info', 'Session cancelled by user');

        return true;
    }

    // ========================================================================
    // Quick Learning (Simplified Flow)
    // ========================================================================

    /**
     * Quick learn from error (simplified flow for error recovery)
     */
    async quickLearnFromError(
        errorMessage: string,
        originalQuery: string,
        attemptCount: number
    ): Promise<{
        learned: boolean;
        suggestion?: string;
        skillId?: string;
    }> {
        // Analyze error for capability gaps
        const gaps = await this.deps.gapDetector.analyzeFailure(
            originalQuery,
            errorMessage,
            attemptCount
        );

        if (gaps.length === 0) {
            return { learned: false };
        }

        // Quick research on first gap
        const gap = gaps[0];
        const researchResult = await this.deps.researchEngine.research(gap);

        if (researchResult.sources.length === 0) {
            return { learned: false };
        }

        // Quick learning
        const learningOutcome = await this.deps.learningProcessor.process(researchResult);

        if (learningOutcome.knowledge.length === 0) {
            return { learned: false };
        }

        const knowledge = learningOutcome.knowledge[0];

        // Generate suggestion without full validation
        const suggestion = this.generateQuickSuggestion(knowledge, researchResult);

        return {
            learned: true,
            suggestion,
        };
    }

    /**
     * Generate quick suggestion from knowledge
     */
    private generateQuickSuggestion(
        knowledge: { title: string; summary: string; codeTemplate?: string; steps?: string[] },
        research: { dependencies: string[] }
    ): string {
        const lines: string[] = [];

        lines.push(`Based on research about "${knowledge.title}":`);
        lines.push('');
        lines.push(knowledge.summary);
        lines.push('');

        if (research.dependencies.length > 0) {
            lines.push('Required packages:');
            lines.push(`  pip install ${research.dependencies.join(' ')}`);
            lines.push('');
        }

        if (knowledge.steps && knowledge.steps.length > 0) {
            lines.push('Steps:');
            for (let i = 0; i < Math.min(knowledge.steps.length, 5); i++) {
                lines.push(`  ${i + 1}. ${knowledge.steps[i]}`);
            }
            lines.push('');
        }

        if (knowledge.codeTemplate) {
            lines.push('Example code:');
            lines.push('```');
            lines.push(knowledge.codeTemplate.slice(0, 500));
            if (knowledge.codeTemplate.length > 500) {
                lines.push('... (truncated)');
            }
            lines.push('```');
        }

        return lines.join('\n');
    }

    // ========================================================================
    // Statistics & Monitoring
    // ========================================================================

    /**
     * Get learning statistics
     */
    getStatistics(): {
        activeSessions: number;
        config: SelfLearningConfig;
        reuseStats: ReturnType<ReuseEngine['getStatistics']>;
    } {
        return {
            activeSessions: this.activeSessions.size,
            config: this.config,
            reuseStats: this.deps.reuseEngine.getStatistics(),
        };
    }

    /**
     * Update configuration
     */
    updateConfig(updates: Partial<SelfLearningConfig>): void {
        this.config = { ...this.config, ...updates };
    }

    /**
     * Get current configuration
     */
    getConfig(): SelfLearningConfig {
        return { ...this.config };
    }

    // ========================================================================
    // OpenClaw-style Enhancement Methods
    // ========================================================================

    /**
     * Submit user feedback for a skill or knowledge
     */
    async submitFeedback(
        entityId: string,
        entityType: 'knowledge' | 'skill',
        feedbackType: 'helpful' | 'not_helpful' | 'partially_helpful' | 'needs_improvement',
        options?: {
            rating?: number;
            comment?: string;
            suggestedImprovement?: string;
            taskContext?: string;
        }
    ): Promise<{ success: boolean; feedbackId?: string; error?: string }> {
        if (!this.deps.feedbackManager) {
            return { success: false, error: 'Feedback manager not configured' };
        }

        try {
            const feedback = await this.deps.feedbackManager.recordFeedback(
                entityId,
                entityType,
                feedbackType,
                options
            );
            return { success: true, feedbackId: feedback.id };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }

    /**
     * Get feedback statistics for an entity
     */
    getFeedbackStats(entityId: string): ReturnType<FeedbackManager['getStats']> | null {
        return this.deps.feedbackManager?.getStats(entityId) ?? null;
    }

    /**
     * Get entities needing attention based on feedback
     */
    getEntitiesNeedingAttention(): ReturnType<FeedbackManager['getEntitiesNeedingAttention']> {
        return this.deps.feedbackManager?.getEntitiesNeedingAttention() ?? [];
    }

    /**
     * Rollback a skill to a previous version
     */
    async rollbackSkill(
        skillId: string,
        targetVersion?: string,
        reason?: string
    ): Promise<{
        success: boolean;
        previousVersion?: string;
        newVersion?: string;
        error?: string;
    }> {
        if (!this.deps.versionManager) {
            return { success: false, error: 'Version manager not configured' };
        }

        const result = await this.deps.versionManager.rollback(skillId, targetVersion, reason);
        return result;
    }

    /**
     * Get skill version history
     */
    getSkillHistory(skillId: string): ReturnType<SkillVersionManager['getHistory']> {
        return this.deps.versionManager?.getHistory(skillId) ?? null;
    }

    /**
     * Compare two skill versions
     */
    async compareSkillVersions(
        skillId: string,
        versionA: string,
        versionB: string
    ): Promise<ReturnType<SkillVersionManager['compareVersions']> | null> {
        if (!this.deps.versionManager) return null;
        return this.deps.versionManager.compareVersions(skillId, versionA, versionB);
    }

    /**
     * Get learning predictions
     */
    getLearningPredictions(options?: {
        limit?: number;
        minConfidence?: number;
    }): Array<{
        topic: string;
        confidence: number;
        reason: string;
        priority: string;
    }> {
        if (!this.deps.proactiveLearner) return [];

        let predictions = this.deps.proactiveLearner.getPredictions();

        if (options?.minConfidence !== undefined) {
            const minConf = options.minConfidence;
            predictions = predictions.filter(p => p.confidence >= minConf);
        }

        if (options?.limit) {
            predictions = predictions.slice(0, options.limit);
        }

        return predictions.map(p => ({
            topic: p.topic,
            confidence: p.confidence,
            reason: p.reason,
            priority: p.priority,
        }));
    }

    /**
     * Configure proactive learning
     */
    configureProactiveLearning(config: {
        enabled: boolean;
        maxDailyLearnings?: number;
        schedule?: 'idle' | 'scheduled' | 'both';
    }): { success: boolean; config: unknown } {
        if (!this.deps.proactiveLearner) {
            return { success: false, config: null };
        }

        if (config.enabled) {
            this.deps.proactiveLearner.enable();
        } else {
            this.deps.proactiveLearner.disable();
        }

        if (config.maxDailyLearnings || config.schedule) {
            this.deps.proactiveLearner.updateConfig({
                maxDailyLearnings: config.maxDailyLearnings,
                learningSchedule: config.schedule,
            });
        }

        return {
            success: true,
            config: this.deps.proactiveLearner.getConfig(),
        };
    }

    /**
     * Record user query for pattern tracking (proactive learning)
     */
    recordQueryPattern(query: string, success: boolean): void {
        this.deps.proactiveLearner?.recordQuery(query, success);
    }

    /**
     * Start proactive learning (if enabled and idle)
     */
    async tryProactiveLearning(): Promise<{
        started: boolean;
        topic?: string;
        reason?: string;
    }> {
        if (!this.deps.proactiveLearner) {
            return { started: false, reason: 'Proactive learner not configured' };
        }

        const result = await this.deps.proactiveLearner.startProactiveLearning();
        return {
            started: result.started,
            topic: result.prediction?.topic,
            reason: result.reason,
        };
    }

    /**
     * Get proactive learning statistics
     */
    getProactiveLearningStats(): ReturnType<ProactiveLearner['getStatistics']> | null {
        return this.deps.proactiveLearner?.getStatistics() ?? null;
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createSelfLearningController(
    deps: SelfLearningControllerDependencies,
    config?: Partial<SelfLearningConfig>
): SelfLearningController {
    return new SelfLearningController(deps, config);
}
