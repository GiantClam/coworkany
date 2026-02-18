/**
 * Tool Chain Executor
 *
 * Executes tool chains step by step with error handling and context management
 */

import type {
    ToolChain,
    ToolChainStep,
    ChainContext,
    ChainExecutionResult,
    StepExecutionResult,
    ChainEvent,
    ChainExecutionStatus
} from './types';

export class ChainExecutor {
    private eventCallbacks: Array<(event: ChainEvent) => void> = [];

    /**
     * Register an event callback
     */
    onEvent(callback: (event: ChainEvent) => void): void {
        this.eventCallbacks.push(callback);
    }

    /**
     * Emit a chain event
     */
    private emit(event: ChainEvent): void {
        this.eventCallbacks.forEach(cb => {
            try {
                cb(event);
            } catch (error) {
                console.error('[ChainExecutor] Event callback error:', error);
            }
        });
    }

    /**
     * Execute a tool chain
     */
    async execute(
        chain: ToolChain,
        taskId: string,
        workspacePath: string,
        inputVariables: Record<string, unknown>,
        toolExecutor: (tool: string, args: Record<string, unknown>) => Promise<unknown>
    ): Promise<ChainExecutionResult> {
        const startTime = Date.now();
        const context: ChainContext = {
            chainId: chain.id,
            taskId,
            workspacePath,
            variables: this.initializeVariables(chain, inputVariables),
            results: {},
            metadata: {
                startTime,
                currentStep: 0,
                totalSteps: chain.steps.length
            }
        };

        const stepResults: StepExecutionResult[] = [];
        let status: ChainExecutionStatus = 'running';
        let error: string | undefined;

        // Emit chain started event
        this.emit({
            type: 'chain_started',
            chainId: chain.id,
            taskId,
            timestamp: Date.now(),
            data: { chain, variables: context.variables }
        });

        try {
            // Execute each step in sequence
            for (let i = 0; i < chain.steps.length; i++) {
                const step = chain.steps[i];
                context.metadata.currentStep = i + 1;

                const stepResult = await this.executeStep(
                    step,
                    context,
                    toolExecutor
                );

                stepResults.push(stepResult);

                // Handle step failure
                if (stepResult.status === 'failed') {
                    const onError = step.onError || 'stop';

                    if (onError === 'stop') {
                        status = 'failed';
                        error = stepResult.error;
                        break;
                    } else if (onError === 'continue') {
                        console.log(`[ChainExecutor] Step ${step.id} failed, continuing...`);
                        continue;
                    }
                    // If 'retry', the executeStep already handled retries
                }

                // Save result if specified
                if (stepResult.status === 'success' && step.saveResult) {
                    context.results[step.saveResult] = stepResult.result;
                }
            }

            // If we completed all steps without stopping, mark as completed
            if (status === 'running') {
                status = 'completed';
            }

        } catch (err) {
            status = 'failed';
            error = err instanceof Error ? err.message : String(err);
            console.error('[ChainExecutor] Chain execution error:', err);
        }

        const endTime = Date.now();
        const result: ChainExecutionResult = {
            chainId: chain.id,
            taskId,
            status,
            steps: stepResults,
            startTime,
            endTime,
            totalDuration: endTime - startTime,
            error
        };

        // Emit completion event
        this.emit({
            type: status === 'completed' ? 'chain_completed' : 'chain_failed',
            chainId: chain.id,
            taskId,
            timestamp: Date.now(),
            data: result
        });

        return result;
    }

    /**
     * Execute a single step
     */
    private async executeStep(
        step: ToolChainStep,
        context: ChainContext,
        toolExecutor: (tool: string, args: Record<string, unknown>) => Promise<unknown>
    ): Promise<StepExecutionResult> {
        const stepStartTime = Date.now();

        // Emit step started event
        this.emit({
            type: 'step_started',
            chainId: context.chainId,
            taskId: context.taskId,
            stepId: step.id,
            timestamp: Date.now(),
            data: { step }
        });

        try {
            // Check condition if present
            if (step.condition && !step.condition(context)) {
                console.log(`[ChainExecutor] Step ${step.id} skipped (condition not met)`);

                const result: StepExecutionResult = {
                    stepId: step.id,
                    status: 'skipped',
                    duration: Date.now() - stepStartTime
                };

                this.emit({
                    type: 'step_completed',
                    chainId: context.chainId,
                    taskId: context.taskId,
                    stepId: step.id,
                    timestamp: Date.now(),
                    data: result
                });

                return result;
            }

            // Resolve args (may be a function)
            const args = typeof step.args === 'function'
                ? step.args(context)
                : step.args;

            // Execute the tool
            const maxRetries = step.onError === 'retry' ? (step.maxRetries || 3) : 1;
            let lastError: Error | undefined;
            let result: unknown;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    console.log(`[ChainExecutor] Executing step ${step.id} (attempt ${attempt + 1}/${maxRetries})`);
                    result = await toolExecutor(step.tool, args);
                    lastError = undefined;
                    break; // Success, exit retry loop
                } catch (err) {
                    lastError = err instanceof Error ? err : new Error(String(err));
                    console.error(`[ChainExecutor] Step ${step.id} attempt ${attempt + 1} failed:`, lastError.message);

                    if (attempt < maxRetries - 1) {
                        // Wait before retrying (exponential backoff)
                        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                    }
                }
            }

            if (lastError) {
                // All retries failed
                const failResult: StepExecutionResult = {
                    stepId: step.id,
                    status: 'failed',
                    error: lastError.message,
                    duration: Date.now() - stepStartTime
                };

                this.emit({
                    type: 'step_failed',
                    chainId: context.chainId,
                    taskId: context.taskId,
                    stepId: step.id,
                    timestamp: Date.now(),
                    data: failResult
                });

                return failResult;
            }

            // Success
            const successResult: StepExecutionResult = {
                stepId: step.id,
                status: 'success',
                result,
                duration: Date.now() - stepStartTime
            };

            this.emit({
                type: 'step_completed',
                chainId: context.chainId,
                taskId: context.taskId,
                stepId: step.id,
                timestamp: Date.now(),
                data: successResult
            });

            return successResult;

        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            const failResult: StepExecutionResult = {
                stepId: step.id,
                status: 'failed',
                error,
                duration: Date.now() - stepStartTime
            };

            this.emit({
                type: 'step_failed',
                chainId: context.chainId,
                taskId: context.taskId,
                stepId: step.id,
                timestamp: Date.now(),
                data: failResult
            });

            return failResult;
        }
    }

    /**
     * Initialize variables with defaults
     */
    private initializeVariables(
        chain: ToolChain,
        inputVariables: Record<string, unknown>
    ): Record<string, unknown> {
        const variables: Record<string, unknown> = { ...inputVariables };

        // Apply defaults for missing variables
        if (chain.variables) {
            for (const varDef of chain.variables) {
                if (!(varDef.name in variables)) {
                    if (varDef.required) {
                        throw new Error(`Required variable '${varDef.name}' not provided`);
                    }
                    if (varDef.default !== undefined) {
                        variables[varDef.name] = varDef.default;
                    }
                }
            }
        }

        return variables;
    }
}

/**
 * Singleton instance
 */
let executor: ChainExecutor | null = null;

export function getChainExecutor(): ChainExecutor {
    if (!executor) {
        executor = new ChainExecutor();
    }
    return executor;
}
