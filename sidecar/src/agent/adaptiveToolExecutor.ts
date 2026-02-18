/**
 * Adaptive Tool Executor
 *
 * Wraps ToolExecutor with adaptive retry logic.
 * Integrates AdaptiveExecutor into the ReAct loop at the tool execution layer.
 */

import { ToolExecutor } from './reactLoop';
import { AdaptiveExecutor, ExecutionStep } from './adaptiveExecutor';

/**
 * List of tools that benefit from adaptive retry
 */
const ADAPTIVE_RETRY_TOOLS = [
    // Browser automation
    'browser_click',
    'browser_fill',
    'browser_wait',
    'browser_navigate',

    // Command execution (may need retries for transient errors)
    'execute_command',
    'bash',

    // File operations (may need retries for locks)
    'read_file',
    'write_file',

    // Network operations
    'fetch_url',
    'api_call',

    // Can be extended
];

/**
 * Enhanced ToolExecutor with adaptive retry capabilities
 */
export class AdaptiveToolExecutor implements ToolExecutor {
    constructor(
        private baseExecutor: ToolExecutor,
        private adaptiveExecutor: AdaptiveExecutor
    ) {}

    async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
        const needsAdaptive = ADAPTIVE_RETRY_TOOLS.includes(toolName);

        if (needsAdaptive) {
            console.log(`[AdaptiveToolExecutor] Using adaptive retry for tool: ${toolName}`);

            // Use adaptive execution with retry
            const step: ExecutionStep = {
                id: `${toolName}-${Date.now()}`,
                description: `Execute ${toolName}`,
                toolName,
                args,
            };

            const result = await this.adaptiveExecutor.executeWithRetry(
                step,
                async (tool, retryArgs) => {
                    // Call base executor
                    const output = await this.baseExecutor.execute(tool, retryArgs);
                    return output;
                }
            );

            if (result.success) {
                // Return the output as string
                return typeof result.output === 'string'
                    ? result.output
                    : JSON.stringify(result.output);
            } else {
                // Throw error to trigger ReAct error handling
                throw new Error(result.error || 'Tool execution failed');
            }
        } else {
            // Direct execution without retry
            return await this.baseExecutor.execute(toolName, args);
        }
    }

    /**
     * Check if a tool supports adaptive retry
     */
    static supportsAdaptiveRetry(toolName: string): boolean {
        return ADAPTIVE_RETRY_TOOLS.includes(toolName);
    }

    /**
     * Add a tool to the adaptive retry list
     */
    static addAdaptiveTool(toolName: string): void {
        if (!ADAPTIVE_RETRY_TOOLS.includes(toolName)) {
            ADAPTIVE_RETRY_TOOLS.push(toolName);
        }
    }
}
