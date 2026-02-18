/**
 * Tool Chains Types
 *
 * Defines types for automated tool execution sequences
 */

/**
 * Tool execution step in a chain
 */
export interface ToolChainStep {
    /** Unique identifier for this step */
    id: string;

    /** Display name for the step */
    name: string;

    /** Tool to execute */
    tool: string;

    /** Arguments for the tool (can use variables from previous steps) */
    args: Record<string, unknown> | ((context: ChainContext) => Record<string, unknown>);

    /** Optional condition to check before executing this step */
    condition?: (context: ChainContext) => boolean;

    /** How to handle errors */
    onError?: 'stop' | 'continue' | 'retry';

    /** Maximum retry attempts if onError is 'retry' */
    maxRetries?: number;

    /** Whether to save the result to context for use in later steps */
    saveResult?: string; // Variable name to save result as
}

/**
 * Tool chain definition
 */
export interface ToolChain {
    /** Unique identifier */
    id: string;

    /** Display name */
    name: string;

    /** Description of what this chain does */
    description: string;

    /** Tags for categorization */
    tags: string[];

    /** Steps to execute in sequence */
    steps: ToolChainStep[];

    /** Variables that can be provided when starting the chain */
    variables?: {
        name: string;
        description: string;
        required: boolean;
        default?: unknown;
    }[];
}

/**
 * Execution context shared across steps
 */
export interface ChainContext {
    /** Chain ID */
    chainId: string;

    /** Task ID */
    taskId: string;

    /** Workspace path */
    workspacePath: string;

    /** Input variables */
    variables: Record<string, unknown>;

    /** Results from previous steps */
    results: Record<string, unknown>;

    /** Metadata about the execution */
    metadata: {
        startTime: number;
        currentStep: number;
        totalSteps: number;
    };
}

/**
 * Status of a chain execution
 */
export type ChainExecutionStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled';

/**
 * Step execution result
 */
export interface StepExecutionResult {
    stepId: string;
    status: 'success' | 'failed' | 'skipped';
    result?: unknown;
    error?: string;
    duration: number;
}

/**
 * Chain execution result
 */
export interface ChainExecutionResult {
    chainId: string;
    taskId: string;
    status: ChainExecutionStatus;
    steps: StepExecutionResult[];
    startTime: number;
    endTime?: number;
    totalDuration?: number;
    error?: string;
}

/**
 * Event emitted during chain execution
 */
export interface ChainEvent {
    type: 'chain_started' | 'step_started' | 'step_completed' | 'step_failed' | 'chain_completed' | 'chain_failed';
    chainId: string;
    taskId: string;
    stepId?: string;
    data?: unknown;
    timestamp: number;
}

/**
 * Chain registry entry
 */
export interface ChainRegistryEntry {
    chain: ToolChain;
    category: 'builtin' | 'user' | 'auto';
    usage: number; // How many times this chain has been used
    lastUsed?: number;
}
