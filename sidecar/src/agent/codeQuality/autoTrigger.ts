/**
 * Auto-Trigger Code Quality Checks
 *
 * Automatically runs code quality checks when code files are written or modified
 */

import { getCodeQualityAnalyzer } from './analyzer';
import type { CodeQualityReport } from './types';
import * as path from 'path';

export interface AutoTriggerConfig {
    enabled: boolean;
    minScoreThreshold: number; // Warn if score below this
    autoFix: boolean; // Future: auto-apply fixes
    languages: string[]; // Languages to check
    excludePatterns: string[]; // Files to skip (e.g., "*.test.ts")
}

export const DEFAULT_AUTO_TRIGGER_CONFIG: AutoTriggerConfig = {
    enabled: true,
    minScoreThreshold: 70,
    autoFix: false,
    languages: ['typescript', 'javascript', 'python', 'rust', 'go', 'java'],
    excludePatterns: [
        '*.test.ts',
        '*.test.js',
        '*.spec.ts',
        '*.spec.js',
        'node_modules/**',
        'dist/**',
        'build/**',
        '.git/**',
    ],
};

export class CodeQualityAutoTrigger {
    private config: AutoTriggerConfig;
    private analyzer = getCodeQualityAnalyzer();

    constructor(config?: Partial<AutoTriggerConfig>) {
        this.config = { ...DEFAULT_AUTO_TRIGGER_CONFIG, ...config };
    }

    /**
     * Check if file should trigger quality check
     */
    shouldCheck(filePath: string): boolean {
        if (!this.config.enabled) {
            return false;
        }

        // Check extension
        const ext = path.extname(filePath).substring(1);
        const language = this.getLanguageFromExtension(ext);

        if (!language || !this.config.languages.includes(language)) {
            return false;
        }

        // Check exclude patterns
        for (const pattern of this.config.excludePatterns) {
            if (this.matchesPattern(filePath, pattern)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Run quality check on file write
     */
    async onFileWrite(
        filePath: string,
        content: string
    ): Promise<CodeQualityReport | null> {
        if (!this.shouldCheck(filePath)) {
            return null;
        }

        const language = this.getLanguageFromPath(filePath);
        if (!language) {
            return null;
        }

        try {
            const report = await this.analyzer.analyze(content, filePath, language);
            return report;
        } catch (error) {
            console.error(`[CodeQuality] Auto-check failed for ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Create warning message if quality is below threshold
     */
    formatWarning(report: CodeQualityReport): string | null {
        if (report.score >= this.config.minScoreThreshold) {
            return null;
        }

        const errors = report.issues.filter(i => i.severity === 'error');
        const warnings = report.issues.filter(i => i.severity === 'warning');

        const lines: string[] = [];
        lines.push(`⚠️ Code quality is below threshold for ${report.filePath}`);
        lines.push(`Score: ${report.score}/${this.config.minScoreThreshold} (target)`);
        lines.push('');

        if (errors.length > 0) {
            lines.push(`❌ ${errors.length} error(s) found:`);
            errors.slice(0, 3).forEach(err => {
                lines.push(`  - ${err.message}`);
            });
            if (errors.length > 3) {
                lines.push(`  ...and ${errors.length - 3} more errors`);
            }
            lines.push('');
        }

        if (warnings.length > 0) {
            lines.push(`⚠️ ${warnings.length} warning(s) found:`);
            warnings.slice(0, 2).forEach(warn => {
                lines.push(`  - ${warn.message}`);
            });
            if (warnings.length > 2) {
                lines.push(`  ...and ${warnings.length - 2} more warnings`);
            }
            lines.push('');
        }

        lines.push('💡 Run check_code_quality tool for full report and suggestions');

        return lines.join('\n');
    }

    /**
     * Get language from file extension
     */
    private getLanguageFromExtension(ext: string): string | null {
        const map: Record<string, string> = {
            ts: 'typescript',
            tsx: 'typescript',
            js: 'javascript',
            jsx: 'javascript',
            py: 'python',
            rs: 'rust',
            go: 'go',
            java: 'java',
        };

        return map[ext] || null;
    }

    /**
     * Get language from file path
     */
    private getLanguageFromPath(filePath: string): string | null {
        const ext = path.extname(filePath).substring(1);
        return this.getLanguageFromExtension(ext);
    }

    /**
     * Check if path matches pattern (simple glob matching)
     */
    private matchesPattern(filePath: string, pattern: string): boolean {
        // Convert glob pattern to regex
        const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*');

        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(filePath);
    }
}

// Singleton instance
let instance: CodeQualityAutoTrigger | null = null;

export function getCodeQualityAutoTrigger(
    config?: Partial<AutoTriggerConfig>
): CodeQualityAutoTrigger {
    if (!instance) {
        instance = new CodeQualityAutoTrigger(config);
    }
    return instance;
}

/**
 * Create event payload for quality check result
 */
export interface QualityCheckEvent {
    type: 'quality_check';
    filePath: string;
    score: number;
    passed: boolean; // true if score >= threshold
    issues: {
        errors: number;
        warnings: number;
        info: number;
    };
    warningMessage?: string;
}

export function createQualityCheckEvent(
    report: CodeQualityReport,
    threshold: number
): QualityCheckEvent {
    const errors = report.issues.filter(i => i.severity === 'error').length;
    const warnings = report.issues.filter(i => i.severity === 'warning').length;
    const info = report.issues.filter(i => i.severity === 'info').length;

    const passed = report.score >= threshold;

    const trigger = getCodeQualityAutoTrigger();
    const warningMessage = passed ? undefined : trigger.formatWarning(report);

    return {
        type: 'quality_check',
        filePath: report.filePath,
        score: report.score,
        passed,
        issues: { errors, warnings, info },
        warningMessage: warningMessage ?? undefined,
    };
}
