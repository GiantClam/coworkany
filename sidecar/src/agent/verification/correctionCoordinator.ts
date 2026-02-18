/**
 * Correction Coordinator
 *
 * Coordinates automatic verification and self-correction
 * Integrates Phase 2 (Code Quality) and Phase 3 (Verification)
 */

import { getVerificationEngine } from './engine';
import { getSelfCorrectionEngine } from '../selfCorrection';
import { getCodeQualityAnalyzer } from '../codeQuality';
import type { VerificationResult, VerificationContext } from './types';
import type { CorrectionResult } from '../selfCorrection';

export interface CorrectionAttempt {
    attemptNumber: number;
    toolName: string;
    args: Record<string, unknown>;
    result: string;
    verification: VerificationResult;
    correction?: CorrectionResult;
    timestamp: string;
}

export interface CorrectionSession {
    sessionId: string;
    originalTool: string;
    originalArgs: Record<string, unknown>;
    attempts: CorrectionAttempt[];
    finalStatus: 'success' | 'failed' | 'abandoned';
    totalAttempts: number;
    maxAttempts: number;
}

export class CorrectionCoordinator {
    private verificationEngine = getVerificationEngine();
    private selfCorrectionEngine = getSelfCorrectionEngine();
    private qualityAnalyzer = getCodeQualityAnalyzer();
    private maxAttempts: number;
    private quickLearnHook?: (errorMessage: string, originalQuery: string, attemptCount: number) => Promise<{
        learned: boolean;
        suggestion?: string;
    }>;

    constructor(maxAttempts: number = 3) {
        this.maxAttempts = maxAttempts;
    }

    /**
     * Optional bridge to self-learning for persistent verification failures.
     */
    setQuickLearnHook(
        hook: (errorMessage: string, originalQuery: string, attemptCount: number) => Promise<{
            learned: boolean;
            suggestion?: string;
        }>
    ): void {
        this.quickLearnHook = hook;
    }

    /**
     * Execute tool with automatic verification and correction
     */
    async executeWithVerification(
        toolName: string,
        args: Record<string, unknown>,
        context: VerificationContext,
        executor: (name: string, args: Record<string, unknown>) => Promise<string>
    ): Promise<CorrectionSession> {
        const sessionId = `correction-${Date.now()}`;
        const session: CorrectionSession = {
            sessionId,
            originalTool: toolName,
            originalArgs: args,
            attempts: [],
            finalStatus: 'failed',
            totalAttempts: 0,
            maxAttempts: this.maxAttempts,
        };

        let currentArgs = { ...args };
        let currentToolName = toolName;

        for (let i = 0; i < this.maxAttempts; i++) {
            session.totalAttempts++;

            try {
                // Execute the tool
                const result = await executor(currentToolName, currentArgs);

                // Verify the result
                const verification = await this.verificationEngine.verify(
                    currentToolName,
                    currentArgs,
                    result,
                    context
                );

                const attempt: CorrectionAttempt = {
                    attemptNumber: i + 1,
                    toolName: currentToolName,
                    args: currentArgs,
                    result,
                    verification,
                    timestamp: new Date().toISOString(),
                };

                session.attempts.push(attempt);

                // Check if verification passed
                if (verification.status === 'passed') {
                    session.finalStatus = 'success';
                    return session;
                }

                // If verification failed, log it and optionally retry
                if (verification.status === 'failed') {
                    // Analyze the error
                    const errorAnalysis = this.selfCorrectionEngine.analyzeError(
                        result,
                        currentArgs,
                        currentToolName
                    );

                    // Build a simple correction from error analysis
                    const correction: CorrectionResult = {
                        analysis: errorAnalysis,
                        retryPlan: {
                            shouldRetry: i < this.maxAttempts - 1,
                            maxRetries: this.maxAttempts,
                            currentRetry: i,
                            strategy: 'manual',
                            modifications: {},
                            reason: errorAnalysis.suggestedFix || 'Verification failed',
                        },
                        formattedHint: `Error: ${errorAnalysis.errorType}. ${errorAnalysis.suggestedFix}`,
                    };

                    attempt.correction = correction;

                    if (this.quickLearnHook) {
                        try {
                            const learnResult = await this.quickLearnHook(
                                result,
                                `${currentToolName} verification failed for task ${context.taskId}`,
                                i + 1
                            );
                            if (learnResult.learned && learnResult.suggestion) {
                                attempt.correction.formattedHint += `\n\n[Self-Learning Recovery]\n${learnResult.suggestion}`;
                            }
                        } catch (learnErr) {
                            console.error('[CorrectionCoordinator] quickLearnHook failed:', learnErr);
                        }
                    }

                    // For now, don't retry automatically (would need more sophisticated logic)
                    console.log(`[CorrectionCoordinator] Verification failed (${i + 1}/${this.maxAttempts}): ${verification.message}`);
                    session.finalStatus = 'failed';
                    return session;
                }
            } catch (error) {
                console.error(`[CorrectionCoordinator] Error in attempt ${i + 1}:`, error);
                session.finalStatus = 'failed';
                return session;
            }
        }

        session.finalStatus = 'abandoned';
        return session;
    }

    /**
     * Apply correction suggestions to tool arguments
     */
    private applyCorrection(
        originalArgs: Record<string, unknown>,
        correction: CorrectionResult
    ): Record<string, unknown> {
        const newArgs = { ...originalArgs };
        const plan = correction.retryPlan;

        // Apply modifications based on strategy
        switch (plan.strategy) {
            case 'modify_code':
                if (plan.modifications.code) {
                    newArgs.code = plan.modifications.code;
                }
                break;

            case 'install_deps':
                if (plan.modifications.dependencies) {
                    newArgs.additional_deps = plan.modifications.dependencies;
                }
                break;

            case 'change_params':
                if (plan.modifications.params) {
                    Object.assign(newArgs, plan.modifications.params);
                }
                break;

            case 'try_alternative_command':
                if (plan.alternativeCommands && plan.alternativeCommands.length > 0) {
                    const command = originalArgs.command as string;
                    const alternative = plan.alternativeCommands[0];
                    newArgs.command = command.replace(/^\w+/, alternative);
                }
                break;
        }

        return newArgs;
    }

    /**
     * Format correction session for display
     */
    formatSession(session: CorrectionSession): string {
        const lines: string[] = [];

        lines.push(`🔧 Correction Session: ${session.sessionId}`);
        lines.push(`Tool: ${session.originalTool}`);
        lines.push(`Status: ${this.getStatusIcon(session.finalStatus)} ${session.finalStatus.toUpperCase()}`);
        lines.push(`Attempts: ${session.totalAttempts}/${session.maxAttempts}`);
        lines.push('');

        // Show each attempt
        session.attempts.forEach((attempt, index) => {
            lines.push(`\n--- Attempt ${attempt.attemptNumber} ---`);
            lines.push(this.verificationEngine.formatResult(attempt.verification));

            if (attempt.correction && attempt.attemptNumber < session.totalAttempts) {
                lines.push('');
                lines.push('🔨 Applied Correction:');
                lines.push(`Strategy: ${attempt.correction.retryPlan.strategy}`);
                lines.push(`Reason: ${attempt.correction.retryPlan.reason}`);
            }
        });

        return lines.join('\n');
    }

    /**
     * Get status icon
     */
    private getStatusIcon(status: string): string {
        const icons: Record<string, string> = {
            success: '✅',
            failed: '❌',
            abandoned: '⏸️',
        };
        return icons[status] || '❓';
    }

    /**
     * Perform post-execution validation
     * This includes code quality checks for code modifications
     */
    async postExecutionValidation(
        toolName: string,
        args: Record<string, unknown>,
        result: string,
        context: VerificationContext
    ): Promise<{
        verification: VerificationResult;
        qualityReport?: any;
        overallPassed: boolean;
    }> {
        // Basic verification
        const verification = await this.verificationEngine.verify(
            toolName,
            args,
            result,
            context
        );

        let qualityReport;
        let qualityPassed = true;

        // For code modifications, also check quality
        if (toolName === 'write_file' || toolName === 'edit_file') {
            const filePath = args.file_path as string;
            const codeExtensions = ['.ts', '.js', '.py', '.rs', '.go', '.java'];
            const isCodeFile = codeExtensions.some(ext => filePath.endsWith(ext));

            if (isCodeFile) {
                try {
                    const ext = filePath.split('.').pop() || '';
                    const langMap: Record<string, string> = {
                        ts: 'typescript',
                        js: 'javascript',
                        py: 'python',
                        rs: 'rust',
                        go: 'go',
                        java: 'java',
                    };
                    const language = langMap[ext];

                    if (language) {
                        const content = args.content as string;
                        qualityReport = await this.qualityAnalyzer.analyze(
                            content,
                            filePath,
                            language
                        );

                        // Quality passes if score >= 60 (acceptable)
                        qualityPassed = qualityReport.score >= 60;
                    }
                } catch (error) {
                    console.warn('[CorrectionCoordinator] Quality check failed:', error);
                }
            }
        }

        const overallPassed = verification.status === 'passed' && qualityPassed;

        return {
            verification,
            qualityReport,
            overallPassed,
        };
    }

    /**
     * Check if task should be marked complete
     * Returns true if all verifications pass
     */
    async shouldAllowCompletion(
        recentToolCalls: Array<{
            toolName: string;
            args: Record<string, unknown>;
            result: string;
        }>,
        context: VerificationContext
    ): Promise<{
        allowed: boolean;
        reasons: string[];
        failedChecks: number;
    }> {
        const reasons: string[] = [];
        let failedChecks = 0;

        // Verify last few tool calls
        for (const call of recentToolCalls.slice(-5)) {
            const validation = await this.postExecutionValidation(
                call.toolName,
                call.args,
                call.result,
                context
            );

            if (!validation.overallPassed) {
                failedChecks++;

                if (validation.verification.status === 'failed') {
                    reasons.push(`${call.toolName}: ${validation.verification.message}`);
                }

                if (validation.qualityReport && validation.qualityReport.score < 60) {
                    reasons.push(
                        `Code quality too low (${validation.qualityReport.score}/100) in ${call.args.file_path}`
                    );
                }
            }
        }

        const allowed = failedChecks === 0;

        return {
            allowed,
            reasons,
            failedChecks,
        };
    }
}

// Singleton instance
let instance: CorrectionCoordinator | null = null;

export function getCorrectionCoordinator(maxAttempts?: number): CorrectionCoordinator {
    if (!instance) {
        instance = new CorrectionCoordinator(maxAttempts);
    }
    return instance;
}
