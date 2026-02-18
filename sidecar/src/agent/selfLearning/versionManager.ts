/**
 * CoworkAny - Skill Version Manager
 *
 * Manages skill versions, enabling rollback to previous versions
 * when a skill starts failing or user requests.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { SkillVersion, SkillVersionHistory } from './types';

// ============================================================================
// Constants
// ============================================================================

const VERSION_DIR = 'versions';
const HISTORY_FILE = 'version-history.json';
const DEFAULT_MAX_VERSIONS = 10;

// ============================================================================
// SkillVersionManager Class
// ============================================================================

export class SkillVersionManager {
    private storagePath: string;
    private historyMap: Map<string, SkillVersionHistory>;

    constructor(storagePath: string) {
        this.storagePath = storagePath;
        this.historyMap = new Map();
        this.load();
    }

    // ========================================================================
    // Version Creation
    // ========================================================================

    /**
     * Create a new version of a skill
     */
    async createVersion(
        skillId: string,
        skillContent: string,
        options: {
            changelog: string;
            author?: 'auto' | 'user';
            confidence?: number;
            testResults?: {
                passed: number;
                failed: number;
                skipped: number;
            };
        }
    ): Promise<SkillVersion> {
        // Get or create history
        let history = this.historyMap.get(skillId);
        if (!history) {
            history = {
                skillId,
                currentVersion: '0.0.0',
                versions: [],
                autoRollbackEnabled: true,
                maxVersionsToKeep: DEFAULT_MAX_VERSIONS,
            };
        }

        // Calculate new version
        const newVersion = this.incrementVersion(history.currentVersion);

        // Create version entry
        const version: SkillVersion = {
            version: newVersion,
            createdAt: new Date().toISOString(),
            changelog: options.changelog,
            author: options.author || 'auto',
            confidence: options.confidence || 0.5,
            testResults: options.testResults,
        };

        // Save skill content to version directory
        await this.saveVersionContent(skillId, newVersion, skillContent);

        // Update history
        history.versions.push(version);
        history.currentVersion = newVersion;

        // Cleanup old versions
        await this.cleanupOldVersions(history);

        // Save
        this.historyMap.set(skillId, history);
        this.save();

        return version;
    }

    /**
     * Increment version string (semver-like)
     */
    private incrementVersion(current: string): string {
        const parts = current.split('.').map(Number);
        if (parts.length !== 3) return '1.0.0';

        // Increment patch version
        parts[2]++;

        // Rollover if needed
        if (parts[2] >= 100) {
            parts[2] = 0;
            parts[1]++;
        }
        if (parts[1] >= 100) {
            parts[1] = 0;
            parts[0]++;
        }

        return parts.join('.');
    }

    /**
     * Save version content to storage
     */
    private async saveVersionContent(
        skillId: string,
        version: string,
        content: string
    ): Promise<void> {
        const versionDir = path.join(this.storagePath, VERSION_DIR, skillId);
        if (!fs.existsSync(versionDir)) {
            fs.mkdirSync(versionDir, { recursive: true });
        }

        const filePath = path.join(versionDir, `v${version}.md`);
        fs.writeFileSync(filePath, content);
    }

    /**
     * Cleanup old versions beyond maxVersionsToKeep
     */
    private async cleanupOldVersions(history: SkillVersionHistory): Promise<void> {
        while (history.versions.length > history.maxVersionsToKeep) {
            const oldestVersion = history.versions.shift();
            if (oldestVersion) {
                const filePath = path.join(
                    this.storagePath,
                    VERSION_DIR,
                    history.skillId,
                    `v${oldestVersion.version}.md`
                );
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
        }
    }

    // ========================================================================
    // Version Retrieval
    // ========================================================================

    /**
     * Get version history for a skill
     */
    getHistory(skillId: string): SkillVersionHistory | null {
        return this.historyMap.get(skillId) || null;
    }

    /**
     * Get specific version content
     */
    async getVersionContent(skillId: string, version: string): Promise<string | null> {
        const filePath = path.join(
            this.storagePath,
            VERSION_DIR,
            skillId,
            `v${version}.md`
        );

        if (!fs.existsSync(filePath)) {
            return null;
        }

        return fs.readFileSync(filePath, 'utf-8');
    }

    /**
     * Get current version content
     */
    async getCurrentContent(skillId: string): Promise<string | null> {
        const history = this.historyMap.get(skillId);
        if (!history) return null;

        return this.getVersionContent(skillId, history.currentVersion);
    }

    /**
     * List all versions for a skill
     */
    listVersions(skillId: string): SkillVersion[] {
        const history = this.historyMap.get(skillId);
        return history?.versions || [];
    }

    // ========================================================================
    // Rollback
    // ========================================================================

    /**
     * Rollback to a previous version
     */
    async rollback(
        skillId: string,
        targetVersion?: string,
        reason?: string
    ): Promise<{
        success: boolean;
        previousVersion: string;
        newVersion: string;
        error?: string;
    }> {
        const history = this.historyMap.get(skillId);
        if (!history || history.versions.length < 2) {
            return {
                success: false,
                previousVersion: history?.currentVersion || '0.0.0',
                newVersion: history?.currentVersion || '0.0.0',
                error: 'No previous version to rollback to',
            };
        }

        const currentVersion = history.currentVersion;

        // Determine target version
        let target: SkillVersion | undefined;
        if (targetVersion) {
            target = history.versions.find(v => v.version === targetVersion);
        } else {
            // Rollback to previous version
            const currentIndex = history.versions.findIndex(
                v => v.version === currentVersion
            );
            if (currentIndex > 0) {
                target = history.versions[currentIndex - 1];
            }
        }

        if (!target) {
            return {
                success: false,
                previousVersion: currentVersion,
                newVersion: currentVersion,
                error: `Target version ${targetVersion || 'previous'} not found`,
            };
        }

        // Get target content
        const targetContent = await this.getVersionContent(skillId, target.version);
        if (!targetContent) {
            return {
                success: false,
                previousVersion: currentVersion,
                newVersion: currentVersion,
                error: 'Target version content not found',
            };
        }

        // Update current version
        history.currentVersion = target.version;

        // Mark current version with rollback reason
        const currentVersionEntry = history.versions.find(
            v => v.version === currentVersion
        );
        if (currentVersionEntry) {
            currentVersionEntry.rollbackReason = reason || 'Manual rollback';
        }

        this.historyMap.set(skillId, history);
        this.save();

        return {
            success: true,
            previousVersion: currentVersion,
            newVersion: target.version,
        };
    }

    /**
     * Auto-rollback if confidence drops significantly
     */
    async checkAutoRollback(
        skillId: string,
        currentConfidence: number
    ): Promise<boolean> {
        const history = this.historyMap.get(skillId);
        if (!history || !history.autoRollbackEnabled || history.versions.length < 2) {
            return false;
        }

        // Find previous version with higher confidence
        const currentIndex = history.versions.findIndex(
            v => v.version === history.currentVersion
        );

        for (let i = currentIndex - 1; i >= 0; i--) {
            const olderVersion = history.versions[i];
            if (olderVersion.confidence >= currentConfidence + 0.2) {
                // Rollback to this version
                await this.rollback(
                    skillId,
                    olderVersion.version,
                    `Auto-rollback: confidence dropped to ${currentConfidence.toFixed(2)}`
                );
                return true;
            }
        }

        return false;
    }

    // ========================================================================
    // Version Comparison
    // ========================================================================

    /**
     * Compare two versions
     */
    async compareVersions(
        skillId: string,
        versionA: string,
        versionB: string
    ): Promise<{
        contentA: string | null;
        contentB: string | null;
        metaA: SkillVersion | undefined;
        metaB: SkillVersion | undefined;
    }> {
        const history = this.historyMap.get(skillId);

        return {
            contentA: await this.getVersionContent(skillId, versionA),
            contentB: await this.getVersionContent(skillId, versionB),
            metaA: history?.versions.find(v => v.version === versionA),
            metaB: history?.versions.find(v => v.version === versionB),
        };
    }

    // ========================================================================
    // Configuration
    // ========================================================================

    /**
     * Enable/disable auto-rollback for a skill
     */
    setAutoRollback(skillId: string, enabled: boolean): void {
        const history = this.historyMap.get(skillId);
        if (history) {
            history.autoRollbackEnabled = enabled;
            this.save();
        }
    }

    /**
     * Set max versions to keep for a skill
     */
    setMaxVersions(skillId: string, max: number): void {
        const history = this.historyMap.get(skillId);
        if (history) {
            history.maxVersionsToKeep = Math.max(1, max);
            this.save();
        }
    }

    // ========================================================================
    // Statistics
    // ========================================================================

    /**
     * Get version statistics
     */
    getStatistics(): {
        totalSkillsVersioned: number;
        totalVersions: number;
        averageVersionsPerSkill: number;
        rollbackCount: number;
    } {
        let totalVersions = 0;
        let rollbackCount = 0;

        for (const history of this.historyMap.values()) {
            totalVersions += history.versions.length;
            rollbackCount += history.versions.filter(v => v.rollbackReason).length;
        }

        return {
            totalSkillsVersioned: this.historyMap.size,
            totalVersions,
            averageVersionsPerSkill: this.historyMap.size > 0
                ? totalVersions / this.historyMap.size
                : 0,
            rollbackCount,
        };
    }

    // ========================================================================
    // Persistence
    // ========================================================================

    private getHistoryFilePath(): string {
        return path.join(this.storagePath, HISTORY_FILE);
    }

    private load(): void {
        try {
            const filePath = this.getHistoryFilePath();
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                this.historyMap = new Map(Object.entries(data));
            }
        } catch (error) {
            console.warn('[SkillVersionManager] Failed to load history:', error);
        }
    }

    private save(): void {
        try {
            const dir = this.storagePath;
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const data = Object.fromEntries(this.historyMap);
            fs.writeFileSync(
                this.getHistoryFilePath(),
                JSON.stringify(data, null, 2)
            );
        } catch (error) {
            console.error('[SkillVersionManager] Failed to save history:', error);
        }
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createVersionManager(storagePath: string): SkillVersionManager {
    return new SkillVersionManager(storagePath);
}
