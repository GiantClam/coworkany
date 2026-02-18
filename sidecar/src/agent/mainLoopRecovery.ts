export interface QuickLearnResult {
    learned: boolean;
    suggestion?: string;
}

export interface MainLoopRecoveryInput {
    errorResult: unknown;
    toolName: string;
    toolArgs: Record<string, unknown>;
    lastUserQuery: string;
    consecutiveToolErrors: number;
    toolErrorTracker: Map<string, number>;
    selfLearningThreshold: number;
    formatErrorForAI: (stderr: string, toolName: string, toolArgs: Record<string, unknown>, retryCount?: number) => string;
    quickLearnFromError: (errorMessage: string, originalQuery: string, attemptCount: number) => Promise<QuickLearnResult>;
    logger?: Pick<Console, 'log' | 'error'>;
}

export interface MainLoopRecoveryOutput {
    result: string;
    consecutiveToolErrors: number;
}

export async function recoverMainLoopToolFailure(input: MainLoopRecoveryInput): Promise<MainLoopRecoveryOutput> {
    const logger = input.logger ?? console;
    const errorStr = typeof input.errorResult === 'string'
        ? input.errorResult
        : JSON.stringify(input.errorResult);

    const prevCount = input.toolErrorTracker.get(input.toolName) || 0;
    input.toolErrorTracker.set(input.toolName, prevCount + 1);
    const nextConsecutiveErrors = input.consecutiveToolErrors + 1;

    logger.log(
        `[ErrorRecovery] Tool ${input.toolName} failed (consecutive: ${nextConsecutiveErrors}, tool-specific: ${prevCount + 1})`
    );

    let enhancedResult = errorStr;
    try {
        enhancedResult = input.formatErrorForAI(errorStr, input.toolName, input.toolArgs, prevCount);
        logger.log(`[ErrorRecovery] Enhanced error for ${input.toolName} with self-correction hints`);
    } catch (fmtErr) {
        logger.error('[ErrorRecovery] formatErrorForAI failed:', fmtErr);
    }

    if (nextConsecutiveErrors < input.selfLearningThreshold) {
        return {
            result: enhancedResult,
            consecutiveToolErrors: nextConsecutiveErrors,
        };
    }

    logger.log(
        `[ErrorRecovery] ${nextConsecutiveErrors} consecutive failures - triggering self-learning for: ${input.toolName}`
    );
    try {
        const learnResult = await input.quickLearnFromError(
            errorStr,
            input.lastUserQuery || `Failed to execute ${input.toolName}`,
            nextConsecutiveErrors
        );

        if (!learnResult.learned || !learnResult.suggestion) {
            logger.log('[ErrorRecovery] Self-learning did not produce actionable suggestions');
            return {
                result: enhancedResult,
                consecutiveToolErrors: nextConsecutiveErrors,
            };
        }

        logger.log(`[ErrorRecovery] Self-learning produced suggestion (${learnResult.suggestion.length} chars)`);
        const learningHint = `[Self-Learning Recovery] After ${nextConsecutiveErrors} consecutive failures, ` +
            `the system researched solutions online and found:\n\n${learnResult.suggestion}\n\n` +
            `Please use this knowledge to try a different approach.`;

        return {
            result: `${enhancedResult}\n\n${learningHint}`,
            consecutiveToolErrors: nextConsecutiveErrors,
        };
    } catch (learnErr) {
        logger.error('[ErrorRecovery] quickLearnFromError failed:', learnErr);
        return {
            result: enhancedResult,
            consecutiveToolErrors: nextConsecutiveErrors,
        };
    }
}
