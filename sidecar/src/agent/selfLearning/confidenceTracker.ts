/**
 * CoworkAny - Confidence Tracker
 *
 * Tracks the reliability of learned knowledge and skills.
 * Uses Bayesian updating with time decay to maintain accurate confidence scores.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    ConfidenceRecord,
    UsageRecord,
    SelfLearningConfig,
} from './types';
import { DEFAULT_CONFIG } from './types';

// ============================================================================
// Constants
// ============================================================================

const CONFIDENCE_FILE = 'confidence.json';
const MAX_HISTORY_SIZE = 100;
const TIME_DECAY_DAYS = 30;  // Confidence decays over this period

// ============================================================================
// Types
// ============================================================================

interface ConfidenceStore {
    records: Record<string, ConfidenceRecord>;
    lastUpdated: string;
    version: number;
}

// ============================================================================
// ConfidenceTracker Class
// ============================================================================

export class ConfidenceTracker {
    private store: ConfidenceStore;
    private storePath: string;
    private config: SelfLearningConfig;
    private dirty: boolean = false;

    constructor(
        dataDir: string,
        config?: Partial<SelfLearningConfig>
    ) {
        this.storePath = path.join(dataDir, 'self-learning', CONFIDENCE_FILE);
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.store = this.load();
    }

    // ========================================================================
    // Persistence
    // ========================================================================

    private load(): ConfidenceStore {
        try {
            if (fs.existsSync(this.storePath)) {
                const data = fs.readFileSync(this.storePath, 'utf-8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('[ConfidenceTracker] Failed to load store:', error);
        }

        return {
            records: {},
            lastUpdated: new Date().toISOString(),
            version: 1,
        };
    }

    private save(): void {
        if (!this.dirty) return;

        try {
            const dir = path.dirname(this.storePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            this.store.lastUpdated = new Date().toISOString();
            fs.writeFileSync(
                this.storePath,
                JSON.stringify(this.store, null, 2),
                'utf-8'
            );
            this.dirty = false;
        } catch (error) {
            console.error('[ConfidenceTracker] Failed to save store:', error);
        }
    }

    // ========================================================================
    // Core Methods
    // ========================================================================

    /**
     * Initialize a new confidence record for a learned entity
     */
    initRecord(
        entityId: string,
        entityType: 'knowledge' | 'skill',
        initialConfidence: number
    ): ConfidenceRecord {
        const record: ConfidenceRecord = {
            entityId,
            entityType,
            initialConfidence,
            currentConfidence: initialConfidence,
            usageHistory: [],
            successRate: 1.0,
            lastUpdated: new Date().toISOString(),
            needsRelearning: false,
        };

        this.store.records[entityId] = record;
        this.dirty = true;
        this.save();

        return record;
    }

    /**
     * Get confidence record for an entity
     */
    getRecord(entityId: string): ConfidenceRecord | undefined {
        const record = this.store.records[entityId];
        if (record) {
            // Apply time decay when reading
            return this.applyTimeDecay(record);
        }
        return undefined;
    }

    /**
     * Record a usage result and update confidence
     * Uses Bayesian updating: P(H|E) = P(E|H) * P(H) / P(E)
     */
    recordUsage(
        entityId: string,
        success: boolean,
        taskId: string,
        details?: string
    ): number {
        let record = this.store.records[entityId];

        if (!record) {
            // Create a new record with default confidence
            record = this.initRecord(entityId, 'knowledge', 0.5);
        }

        // Add usage to history
        const usage: UsageRecord = {
            timestamp: new Date().toISOString(),
            taskId,
            success,
            details,
        };

        record.usageHistory.push(usage);

        // Trim history if too long
        if (record.usageHistory.length > MAX_HISTORY_SIZE) {
            record.usageHistory = record.usageHistory.slice(-MAX_HISTORY_SIZE);
        }

        // Calculate new confidence using Bayesian update
        record.currentConfidence = this.bayesianUpdate(
            record.currentConfidence,
            success
        );

        // Update success rate
        record.successRate = this.calculateSuccessRate(record.usageHistory);

        // Check if relearning is needed
        if (record.currentConfidence < this.config.relearningThreshold) {
            record.needsRelearning = true;
            record.relearningReason = `Confidence dropped below threshold (${record.currentConfidence.toFixed(2)} < ${this.config.relearningThreshold})`;
        }

        record.lastUpdated = new Date().toISOString();
        this.store.records[entityId] = record;
        this.dirty = true;
        this.save();

        return record.currentConfidence;
    }

    /**
     * Bayesian confidence update
     *
     * Prior: current confidence
     * Likelihood: P(success|knowledge_correct) = 0.9, P(success|knowledge_wrong) = 0.1
     */
    private bayesianUpdate(priorConfidence: number, success: boolean): number {
        const pSuccessGivenCorrect = 0.9;
        const pSuccessGivenWrong = 0.1;

        if (success) {
            // P(correct|success) = P(success|correct) * P(correct) / P(success)
            const pSuccess = pSuccessGivenCorrect * priorConfidence +
                pSuccessGivenWrong * (1 - priorConfidence);
            return (pSuccessGivenCorrect * priorConfidence) / pSuccess;
        } else {
            // P(correct|failure) = P(failure|correct) * P(correct) / P(failure)
            const pFailure = (1 - pSuccessGivenCorrect) * priorConfidence +
                (1 - pSuccessGivenWrong) * (1 - priorConfidence);
            return ((1 - pSuccessGivenCorrect) * priorConfidence) / pFailure;
        }
    }

    /**
     * Apply time decay to confidence
     * Confidence decays towards 0.5 (uncertainty) over time
     */
    private applyTimeDecay(record: ConfidenceRecord): ConfidenceRecord {
        const lastUpdate = new Date(record.lastUpdated);
        const now = new Date();
        const daysSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceUpdate < 1) {
            return record;
        }

        // Exponential decay towards 0.5
        const decayFactor = Math.exp(-daysSinceUpdate / TIME_DECAY_DAYS);
        const decayedConfidence = 0.5 + (record.currentConfidence - 0.5) * decayFactor;

        return {
            ...record,
            currentConfidence: decayedConfidence,
        };
    }

    /**
     * Calculate success rate from usage history
     */
    private calculateSuccessRate(history: UsageRecord[]): number {
        if (history.length === 0) return 1.0;

        const successes = history.filter(u => u.success).length;
        return successes / history.length;
    }

    // ========================================================================
    // Query Methods
    // ========================================================================

    /**
     * Get all records sorted by confidence
     */
    getByConfidence(
        minConfidence: number = 0,
        entityType?: 'knowledge' | 'skill'
    ): ConfidenceRecord[] {
        return Object.values(this.store.records)
            .map(r => this.applyTimeDecay(r))
            .filter(r => r.currentConfidence >= minConfidence)
            .filter(r => !entityType || r.entityType === entityType)
            .sort((a, b) => b.currentConfidence - a.currentConfidence);
    }

    /**
     * Get records that need relearning
     */
    getNeedsRelearning(): ConfidenceRecord[] {
        return Object.values(this.store.records)
            .map(r => this.applyTimeDecay(r))
            .filter(r => r.needsRelearning || r.currentConfidence < this.config.relearningThreshold);
    }

    /**
     * Check if an entity is trustworthy enough for auto-use
     */
    isTrustworthy(entityId: string): boolean {
        const record = this.getRecord(entityId);
        if (!record) return false;
        return record.currentConfidence >= this.config.minConfidenceToAutoUse;
    }

    /**
     * Get usage statistics for an entity
     */
    getStats(entityId: string): {
        totalUsages: number;
        successCount: number;
        failureCount: number;
        successRate: number;
        currentConfidence: number;
        trend: 'improving' | 'declining' | 'stable';
    } | undefined {
        const record = this.getRecord(entityId);
        if (!record) return undefined;

        const totalUsages = record.usageHistory.length;
        const successCount = record.usageHistory.filter(u => u.success).length;
        const failureCount = totalUsages - successCount;

        // Calculate trend from recent history
        const recentHistory = record.usageHistory.slice(-10);
        const oldHistory = record.usageHistory.slice(-20, -10);

        let trend: 'improving' | 'declining' | 'stable' = 'stable';
        if (recentHistory.length >= 5 && oldHistory.length >= 5) {
            const recentRate = recentHistory.filter(u => u.success).length / recentHistory.length;
            const oldRate = oldHistory.filter(u => u.success).length / oldHistory.length;

            if (recentRate > oldRate + 0.1) trend = 'improving';
            else if (recentRate < oldRate - 0.1) trend = 'declining';
        }

        return {
            totalUsages,
            successCount,
            failureCount,
            successRate: record.successRate,
            currentConfidence: record.currentConfidence,
            trend,
        };
    }

    // ========================================================================
    // Management Methods
    // ========================================================================

    /**
     * Mark an entity for relearning
     */
    markForRelearning(entityId: string, reason: string): void {
        const record = this.store.records[entityId];
        if (record) {
            record.needsRelearning = true;
            record.relearningReason = reason;
            record.lastUpdated = new Date().toISOString();
            this.dirty = true;
            this.save();
        }
    }

    /**
     * Clear relearning flag (after successful relearning)
     */
    clearRelearningFlag(entityId: string): void {
        const record = this.store.records[entityId];
        if (record) {
            record.needsRelearning = false;
            record.relearningReason = undefined;
            record.lastUpdated = new Date().toISOString();
            this.dirty = true;
            this.save();
        }
    }

    /**
     * Reset confidence to initial value
     */
    resetConfidence(entityId: string): void {
        const record = this.store.records[entityId];
        if (record) {
            record.currentConfidence = record.initialConfidence;
            record.usageHistory = [];
            record.successRate = 1.0;
            record.needsRelearning = false;
            record.relearningReason = undefined;
            record.lastUpdated = new Date().toISOString();
            this.dirty = true;
            this.save();
        }
    }

    /**
     * Delete a confidence record
     */
    deleteRecord(entityId: string): boolean {
        if (this.store.records[entityId]) {
            delete this.store.records[entityId];
            this.dirty = true;
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Get all entity IDs
     */
    getAllEntityIds(): string[] {
        return Object.keys(this.store.records);
    }

    /**
     * Bulk update (for migrations or imports)
     */
    bulkUpdate(records: ConfidenceRecord[]): void {
        for (const record of records) {
            this.store.records[record.entityId] = record;
        }
        this.dirty = true;
        this.save();
    }

    /**
     * Export all data (for backup)
     */
    export(): ConfidenceStore {
        return { ...this.store };
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalTracker: ConfidenceTracker | null = null;

export function getConfidenceTracker(dataDir?: string): ConfidenceTracker {
    if (!globalTracker && dataDir) {
        globalTracker = new ConfidenceTracker(dataDir);
    }
    if (!globalTracker) {
        throw new Error('ConfidenceTracker not initialized. Call with dataDir first.');
    }
    return globalTracker;
}

export function initConfidenceTracker(
    dataDir: string,
    config?: Partial<SelfLearningConfig>
): ConfidenceTracker {
    globalTracker = new ConfidenceTracker(dataDir, config);
    return globalTracker;
}
