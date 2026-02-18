/**
 * Adaptive Executor
 *
 * Implements the DETECT → PLAN → EXECUTE → FEEDBACK loop
 * for handling errors and retrying with alternative strategies.
 */

export interface ExecutionStep {
    id: string;
    description: string;
    toolName: string;
    args: any;
    alternatives?: Array<{
        description: string;
        args: any;
    }>;
}

export interface ExecutionResult {
    success: boolean;
    output?: any;
    error?: string;
    shouldRetry: boolean;
    suggestedAlternative?: any;
}

export interface AdaptiveExecutionConfig {
    maxRetries: number;
    retryDelay: number; // ms
    enableAlternativeStrategies: boolean;
}

const DEFAULT_CONFIG: AdaptiveExecutionConfig = {
    maxRetries: 3,
    retryDelay: 1000,
    enableAlternativeStrategies: true,
};

export class AdaptiveExecutor {
    private config: AdaptiveExecutionConfig;

    constructor(config?: Partial<AdaptiveExecutionConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Execute a step with adaptive retry logic
     */
    async executeWithRetry(
        step: ExecutionStep,
        toolHandler: (toolName: string, args: any) => Promise<any>
    ): Promise<ExecutionResult> {
        let lastError: string | undefined;
        let attempt = 0;

        while (attempt < this.config.maxRetries) {
            attempt++;
            console.log(`[AdaptiveExecutor] Attempt ${attempt}/${this.config.maxRetries} for step: ${step.description}`);

            try {
                // Execute the tool
                const result = await toolHandler(step.toolName, step.args);

                // Analyze result
                const analysis = this.analyzeResult(result, step);

                if (analysis.success) {
                    console.log(`[AdaptiveExecutor] ✅ Step succeeded: ${step.description}`);
                    return {
                        success: true,
                        output: result,
                        shouldRetry: false,
                    };
                }

                // Failed but might be retryable
                lastError = analysis.error;
                console.log(`[AdaptiveExecutor] ❌ Step failed: ${analysis.error}`);

                if (!analysis.shouldRetry) {
                    console.log(`[AdaptiveExecutor] Not retryable, stopping`);
                    break;
                }

                // DETECT: Analyze the error
                const errorType = this.detectErrorType(analysis.error || '');
                console.log(`[AdaptiveExecutor] Error type detected: ${errorType}`);

                // PLAN: Generate alternative strategy
                const alternative = this.planAlternative(step, errorType, attempt);

                if (!alternative && attempt < this.config.maxRetries) {
                    // No alternative, but try again with same args (transient error)
                    console.log(`[AdaptiveExecutor] No alternative found, retrying with same args...`);
                    await this.delay(this.config.retryDelay);
                    continue;
                }

                if (alternative) {
                    console.log(`[AdaptiveExecutor] Trying alternative: ${alternative.description}`);
                    step.args = alternative.args;
                    await this.delay(this.config.retryDelay);
                    continue;
                }

                break;
            } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
                console.error(`[AdaptiveExecutor] Exception on attempt ${attempt}:`, lastError);

                if (attempt < this.config.maxRetries) {
                    await this.delay(this.config.retryDelay);
                    continue;
                }

                break;
            }
        }

        // All attempts failed
        return {
            success: false,
            error: lastError || 'Unknown error',
            shouldRetry: false,
        };
    }

    /**
     * Analyze tool result to determine success/failure
     */
    private analyzeResult(result: any, step: ExecutionStep): ExecutionResult {
        // Handle explicit success/error indicators
        if (typeof result === 'object' && result !== null) {
            if (result.success === false || result.error) {
                return {
                    success: false,
                    error: result.error || result.message || 'Tool returned error',
                    shouldRetry: this.isRetryableError(result.error || ''),
                };
            }

            if (result.success === true) {
                return {
                    success: true,
                    output: result,
                    shouldRetry: false,
                };
            }
        }

        // For browser tools, check common patterns
        if (step.toolName.startsWith('browser_')) {
            if (result && typeof result === 'object') {
                // browser_click might return { clicked: false }
                if ('clicked' in result && !result.clicked) {
                    return {
                        success: false,
                        error: 'Element not found or not clickable',
                        shouldRetry: true,
                    };
                }

                // browser_fill might return { filled: false }
                if ('filled' in result && !result.filled) {
                    return {
                        success: false,
                        error: 'Element not found or not fillable',
                        shouldRetry: true,
                    };
                }
            }
        }

        // Default: assume success if no explicit error
        return {
            success: true,
            output: result,
            shouldRetry: false,
        };
    }

    /**
     * Detect error type from error message
     */
    private detectErrorType(error: string): string {
        const errorLower = error.toLowerCase();

        // SPA/JavaScript not rendered
        if (errorLower.includes('javascript is not available') ||
            errorLower.includes('enable javascript') ||
            errorLower.includes('noscript') ||
            (errorLower.includes('spa') && errorLower.includes('not rendered'))) {
            return 'spa_not_rendered';
        }

        // Smart mode unavailable
        if (errorLower.includes('smart') && (errorLower.includes('not available') || errorLower.includes('unavailable')) ||
            errorLower.includes('browser-use-service') && errorLower.includes('not running')) {
            return 'smart_mode_unavailable';
        }

        if (errorLower.includes('not found') || errorLower.includes('no such element')) {
            return 'element_not_found';
        }

        if (errorLower.includes('timeout') || errorLower.includes('timed out')) {
            return 'timeout';
        }

        if (errorLower.includes('login') || errorLower.includes('not logged in') || errorLower.includes('unauthorized')) {
            return 'authentication_required';
        }

        if (errorLower.includes('network') || errorLower.includes('connection')) {
            return 'network_error';
        }

        if (errorLower.includes('selector') || errorLower.includes('invalid selector')) {
            return 'invalid_selector';
        }

        return 'unknown';
    }

    /**
     * Check if error is retryable
     */
    private isRetryableError(error: string): boolean {
        const errorType = this.detectErrorType(error);
        // smart_mode_unavailable is NOT retryable - it will never succeed
        return ['element_not_found', 'timeout', 'network_error', 'invalid_selector', 'spa_not_rendered'].includes(errorType);
    }

    /**
     * Plan alternative strategy based on error type
     */
    private planAlternative(
        step: ExecutionStep,
        errorType: string,
        attempt: number
    ): { description: string; args: any } | null {
        if (!this.config.enableAlternativeStrategies) {
            return null;
        }

        // Use predefined alternatives if available
        if (step.alternatives && step.alternatives.length > 0) {
            const altIndex = Math.min(attempt - 1, step.alternatives.length - 1);
            return step.alternatives[altIndex];
        }

        // Generate alternatives based on error type
        switch (errorType) {
            case 'element_not_found':
                return this.generateElementAlternatives(step, attempt);

            case 'timeout':
                return this.generateTimeoutAlternatives(step, attempt);

            case 'invalid_selector':
                return this.generateSelectorAlternatives(step, attempt);

            case 'spa_not_rendered':
                return this.generateSpaAlternatives(step, attempt);

            case 'smart_mode_unavailable':
                // NEVER retry browser_set_mode("smart") - it won't become available
                return null;

            default:
                return null;
        }
    }

    /**
     * Generate alternatives for element not found errors
     */
    private generateElementAlternatives(
        step: ExecutionStep,
        attempt: number
    ): { description: string; args: any } | null {
        if (step.toolName === 'browser_click' && step.args.text) {
            // Try alternative button texts
            const alternatives = this.getAlternativeButtonTexts(step.args.text);
            if (alternatives.length > 0 && attempt - 1 < alternatives.length) {
                return {
                    description: `Try alternative button text: ${alternatives[attempt - 1]}`,
                    args: { ...step.args, text: alternatives[attempt - 1] },
                };
            }
        }

        if (step.toolName === 'browser_fill' && step.args.selector) {
            // Try more generic selectors
            const alternatives = this.getAlternativeSelectors(step.args.selector);
            if (alternatives.length > 0 && attempt - 1 < alternatives.length) {
                return {
                    description: `Try alternative selector: ${alternatives[attempt - 1]}`,
                    args: { ...step.args, selector: alternatives[attempt - 1] },
                };
            }
        }

        return null;
    }

    /**
     * Generate alternatives for timeout errors
     */
    private generateTimeoutAlternatives(
        step: ExecutionStep,
        attempt: number
    ): { description: string; args: any } | null {
        if (step.args.timeout) {
            // Increase timeout
            const newTimeout = step.args.timeout * (1 + attempt * 0.5);
            return {
                description: `Increase timeout to ${newTimeout}ms`,
                args: { ...step.args, timeout: newTimeout },
            };
        }

        return null;
    }

    /**
     * Generate alternatives for selector errors
     */
    private generateSelectorAlternatives(
        step: ExecutionStep,
        attempt: number
    ): { description: string; args: any } | null {
        // Similar to element_not_found
        return this.generateElementAlternatives(step, attempt);
    }

    /**
     * Generate alternatives for SPA not rendered errors
     */
    private generateSpaAlternatives(
        step: ExecutionStep,
        attempt: number
    ): { description: string; args: any } | null {
        if (step.toolName === 'browser_navigate') {
            // Try with progressively stronger wait strategies
            const strategies = [
                { wait_until: 'networkidle', timeout_ms: 30000 },
                { wait_until: 'load', timeout_ms: 45000 },
                { wait_until: 'networkidle', timeout_ms: 60000 },
            ];

            if (attempt - 1 < strategies.length) {
                const strategy = strategies[attempt - 1];
                return {
                    description: `SPA not rendered. Retry with wait_until="${strategy.wait_until}" and timeout=${strategy.timeout_ms}ms`,
                    args: { ...step.args, ...strategy },
                };
            }
        }

        // For any browser tool when SPA hasn't rendered, suggest waiting
        return {
            description: `SPA not rendered. Wait for page hydration before interacting.`,
            args: step.args,
        };
    }

    /**
     * Get alternative button texts (e.g., for Xiaohongshu)
     */
    private getAlternativeButtonTexts(originalText: string): string[] {
        const alternatives: Record<string, string[]> = {
            '发布笔记': ['创作灵感', '发布', 'Create', '写笔记'],
            '发布': ['提交', 'Submit', 'Post', '确定'],
            'login': ['登录', 'Sign in', 'Log in', '登陆'],
        };

        return alternatives[originalText] || [];
    }

    /**
     * Get alternative selectors
     */
    private getAlternativeSelectors(originalSelector: string): string[] {
        // If original is specific, try more generic
        if (originalSelector.includes('.editor')) {
            return ['textarea', 'input[type="text"]', '[contenteditable]'];
        }

        if (originalSelector === 'textarea') {
            return ['textarea.editor', 'textarea[placeholder]', '[contenteditable]'];
        }

        return [];
    }

    /**
     * Delay helper
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Factory function
 */
export function createAdaptiveExecutor(config?: Partial<AdaptiveExecutionConfig>): AdaptiveExecutor {
    return new AdaptiveExecutor(config);
}
