/**
 * Autonomous Agent Controller (OpenClaw-inspired)
 *
 * Provides autonomous task execution capabilities:
 * - Task decomposition into subtasks
 * - Background execution with notifications
 * - Auto-memory extraction and vault saving
 * - Continuous task queue processing
 */

import { getVaultManager, getMemoryContext, searchMemory } from '../memory';

// ============================================================================
// Types
// ============================================================================

export interface SubTask {
    id: string;
    description: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    result?: string;
    error?: string;
    startedAt?: string;
    completedAt?: string;
}

export interface AutonomousTask {
    id: string;
    originalQuery: string;
    decomposedTasks: SubTask[];
    status: 'analyzing' | 'executing' | 'verifying' | 'completed' | 'failed' | 'paused';
    autoSaveMemory: boolean;
    notifyOnComplete: boolean;
    createdAt: string;
    completedAt?: string;
    summary?: string;
    memoryExtracted?: string[];
    /** Verification result - did we actually solve the user's problem? */
    verificationResult?: {
        goalMet: boolean;
        evidence: string;
        confidence: number;
    };
}

export interface TaskDecomposition {
    subtasks: Array<{
        description: string;
        requiresTools: string[];
        estimatedComplexity: 'simple' | 'medium' | 'complex';
    }>;
    overallStrategy: string;
    canRunAutonomously: boolean;
    requiresUserInput: string[];
}

export interface MemoryExtraction {
    facts: Array<{
        content: string;
        category: 'learning' | 'preference' | 'project';
        confidence: number;
    }>;
    shouldSave: boolean;
}

export type AutonomousEventType =
    | 'task_started'
    | 'task_decomposed'
    | 'subtask_started'
    | 'subtask_completed'
    | 'subtask_failed'
    | 'verification_started'
    | 'verification_completed'
    | 'verification_failed'
    | 'memory_extracted'
    | 'memory_saved'
    | 'task_completed'
    | 'task_failed'
    | 'user_input_required';

export interface AutonomousEvent {
    type: AutonomousEventType;
    taskId: string;
    timestamp: string;
    data: Record<string, unknown>;
}

export type AutonomousEventCallback = (event: AutonomousEvent) => void;

// ============================================================================
// LLM Interface for Autonomous Operations
// ============================================================================

export interface GoalVerificationResult {
    goalMet: boolean;
    evidence: string;
    confidence: number;
    missingSteps?: string[];
    suggestedNextActions?: string[];
}

export interface AutonomousLlmInterface {
    /**
     * Decompose a complex task into subtasks
     */
    decomposeTask(query: string, context: string): Promise<TaskDecomposition>;

    /**
     * Execute a single subtask and return result
     *
     * Previous subtask results:
     * ${previousContext || 'None'}
     *
     * CRITICAL INSTRUCTION:
     * 1. Execute the subtask fully.
     * 2. VERIFY the result. Do not just blindly trust tool output.
     * 3. If the tool output implies failure or is incomplete, retry with a different strategy.
     * 4. Only return a result when you are confident it solves the distinct subtask.
     *
     * Complete this subtask and provide a clear result.
     */
    executeSubtask(
        subtask: SubTask,
        previousResults: SubTask[],
        tools: unknown[]
    ): Promise<{ result: string; toolsUsed: string[] }>;

    /**
     * CRITICAL: Verify that the original user goal has been achieved.
     * This step prevents premature termination.
     */
    verifyGoalCompletion(
        originalQuery: string,
        subtasks: SubTask[],
        summary: string
    ): Promise<GoalVerificationResult>;

    /**
     * Extract memories/learnings from a completed task
     */
    extractMemories(
        originalQuery: string,
        subtasks: SubTask[],
        finalResult: string
    ): Promise<MemoryExtraction>;

    /**
     * Generate a summary of completed task
     */
    summarizeTask(
        originalQuery: string,
        subtasks: SubTask[]
    ): Promise<string>;

    /**
     * Review a completed subtask for spec compliance and quality.
     * (Superpowers-inspired Two-Stage Review)
     *
     * Stage 1: Does the result match the subtask spec?
     * Stage 2: Is the implementation quality acceptable?
     *
     * Returns issues found and whether the subtask should be re-done.
     */
    reviewSubtask?(
        subtask: SubTask,
        specDescription: string,
        result: string,
        reviewType: 'spec-compliance' | 'quality'
    ): Promise<SubtaskReviewResult>;
}

/**
 * Result of a subtask review (Superpowers Two-Stage Review pattern)
 */
export interface SubtaskReviewResult {
    approved: boolean;
    issues: Array<{
        severity: 'critical' | 'important' | 'minor';
        description: string;
    }>;
    suggestions?: string[];
}

// ============================================================================
// Autonomous Agent Controller
// ============================================================================

export class AutonomousAgentController {
    private llm: AutonomousLlmInterface;
    private eventCallback?: AutonomousEventCallback;
    private activeTasks: Map<string, AutonomousTask> = new Map();
    private taskQueue: string[] = [];
    private isProcessing: boolean = false;
    private maxConcurrentTasks: number = 1;
    private autoSaveMemory: boolean = true;

    private getAvailableTools?: () => Promise<any[]>;

    constructor(options: {
        llm: AutonomousLlmInterface;
        getAvailableTools?: () => Promise<any[]>;
        maxConcurrentTasks?: number;
        autoSaveMemory?: boolean;
        onEvent?: AutonomousEventCallback;
    }) {
        this.llm = options.llm;
        this.getAvailableTools = options.getAvailableTools;
        this.maxConcurrentTasks = options.maxConcurrentTasks ?? 1;
        this.autoSaveMemory = options.autoSaveMemory ?? true;
        this.eventCallback = options.onEvent;
    }

    /**
     * Emit an event
     */
    private emit(event: AutonomousEvent): void {
        if (this.eventCallback) {
            this.eventCallback(event);
        }
    }

    /**
     * Generate a unique task ID
     */
    private generateTaskId(): string {
        return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    /**
     * Start an autonomous task
     */
    async startTask(
        query: string,
        options?: {
            autoSaveMemory?: boolean;
            notifyOnComplete?: boolean;
            runInBackground?: boolean;
        }
    ): Promise<AutonomousTask> {
        const taskId = this.generateTaskId();

        const task: AutonomousTask = {
            id: taskId,
            originalQuery: query,
            decomposedTasks: [],
            status: 'analyzing',
            autoSaveMemory: options?.autoSaveMemory ?? this.autoSaveMemory,
            notifyOnComplete: options?.notifyOnComplete ?? true,
            createdAt: new Date().toISOString(),
        };

        this.activeTasks.set(taskId, task);

        this.emit({
            type: 'task_started',
            taskId,
            timestamp: new Date().toISOString(),
            data: { query },
        });

        // If background mode, add to queue and return immediately
        if (options?.runInBackground) {
            this.taskQueue.push(taskId);
            this.processQueue();
            return task;
        }

        // Otherwise execute synchronously
        await this.executeTask(taskId);
        return this.activeTasks.get(taskId)!;
    }

    /**
     * Process the task queue
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.taskQueue.length > 0) {
            const taskId = this.taskQueue.shift()!;
            await this.executeTask(taskId);
        }

        this.isProcessing = false;
    }

    /**
     * Execute a task (decompose, execute subtasks, extract memories)
     */
    private async executeTask(taskId: string): Promise<void> {
        const task = this.activeTasks.get(taskId);
        if (!task) return;

        try {
            // 1. Get relevant memory context
            const memoryContext = await getMemoryContext(task.originalQuery, {
                topK: 5,
                maxChars: 3000,
            });

            // 2. Decompose task into subtasks
            const decomposition = await this.llm.decomposeTask(
                task.originalQuery,
                memoryContext
            );

            task.decomposedTasks = decomposition.subtasks.map((st, index) => ({
                id: `${taskId}_sub_${index}`,
                description: st.description,
                status: 'pending' as const,
            }));

            this.emit({
                type: 'task_decomposed',
                taskId,
                timestamp: new Date().toISOString(),
                data: {
                    subtaskCount: task.decomposedTasks.length,
                    strategy: decomposition.overallStrategy,
                    canRunAutonomously: decomposition.canRunAutonomously,
                },
            });

            // 3. Check if user input is required
            if (decomposition.requiresUserInput.length > 0) {
                task.status = 'paused';
                this.emit({
                    type: 'user_input_required',
                    taskId,
                    timestamp: new Date().toISOString(),
                    data: { questions: decomposition.requiresUserInput },
                });
                return;
            }

            // 4. Execute subtasks sequentially with Two-Stage Review
            // (Superpowers pattern: Fresh context per task + spec compliance → quality review)
            task.status = 'executing';
            const completedSubtasks: SubTask[] = [];
            const MAX_REVIEW_RETRIES = 2; // Max times to re-do a subtask after failed review

            for (const subtask of task.decomposedTasks) {
                subtask.status = 'running';
                subtask.startedAt = new Date().toISOString();

                this.emit({
                    type: 'subtask_started',
                    taskId,
                    timestamp: new Date().toISOString(),
                    data: { subtaskId: subtask.id, description: subtask.description },
                });

                let reviewRetries = 0;
                let subtaskApproved = false;

                while (!subtaskApproved && reviewRetries <= MAX_REVIEW_RETRIES) {
                    try {
                        const tools = this.getAvailableTools ? await this.getAvailableTools() : [];

                        // ── Execute: Fresh context per subtask ──────────
                        // Controller provides completed results as context, not the full
                        // conversation history. This prevents context pollution.
                        const result = await this.llm.executeSubtask(
                            subtask,
                            completedSubtasks, // Only completed subtask summaries, not full context
                            tools
                        );

                        subtask.result = result.result;

                        // ── Two-Stage Review (if reviewer is available) ─────
                        if (this.llm.reviewSubtask) {
                            // Stage 1: Spec Compliance — does result match the spec?
                            const specReview = await this.llm.reviewSubtask(
                                subtask,
                                subtask.description,
                                result.result,
                                'spec-compliance'
                            );

                            if (!specReview.approved) {
                                const criticalIssues = specReview.issues.filter(i => i.severity === 'critical');
                                if (criticalIssues.length > 0 && reviewRetries < MAX_REVIEW_RETRIES) {
                                    reviewRetries++;
                                    console.log(`[Review] Subtask ${subtask.id} spec review failed (attempt ${reviewRetries}): ${criticalIssues.map(i => i.description).join('; ')}`);
                                    this.emit({
                                        type: 'subtask_failed',
                                        taskId,
                                        timestamp: new Date().toISOString(),
                                        data: {
                                            subtaskId: subtask.id,
                                            error: `Spec review failed: ${criticalIssues.map(i => i.description).join('; ')}`,
                                            reviewType: 'spec-compliance',
                                            retrying: true,
                                        },
                                    });
                                    continue; // Retry the subtask
                                }
                            }

                            // Stage 2: Quality Review — only after spec compliance passes
                            const qualityReview = await this.llm.reviewSubtask(
                                subtask,
                                subtask.description,
                                result.result,
                                'quality'
                            );

                            if (!qualityReview.approved) {
                                const criticalIssues = qualityReview.issues.filter(i => i.severity === 'critical');
                                if (criticalIssues.length > 0 && reviewRetries < MAX_REVIEW_RETRIES) {
                                    reviewRetries++;
                                    console.log(`[Review] Subtask ${subtask.id} quality review failed (attempt ${reviewRetries}): ${criticalIssues.map(i => i.description).join('; ')}`);
                                    this.emit({
                                        type: 'subtask_failed',
                                        taskId,
                                        timestamp: new Date().toISOString(),
                                        data: {
                                            subtaskId: subtask.id,
                                            error: `Quality review failed: ${criticalIssues.map(i => i.description).join('; ')}`,
                                            reviewType: 'quality',
                                            retrying: true,
                                        },
                                    });
                                    continue; // Retry the subtask
                                }
                            }
                        }

                        // Subtask passed review (or no reviewer available)
                        subtaskApproved = true;
                        subtask.status = 'completed';
                        subtask.completedAt = new Date().toISOString();
                        completedSubtasks.push(subtask);

                        this.emit({
                            type: 'subtask_completed',
                            taskId,
                            timestamp: new Date().toISOString(),
                            data: {
                                subtaskId: subtask.id,
                                result: result.result.slice(0, 200),
                                reviewRetries,
                            },
                        });
                    } catch (error) {
                        subtask.status = 'failed';
                        subtask.error = error instanceof Error ? error.message : String(error);
                        subtask.completedAt = new Date().toISOString();

                        this.emit({
                            type: 'subtask_failed',
                            taskId,
                            timestamp: new Date().toISOString(),
                            data: { subtaskId: subtask.id, error: subtask.error },
                        });
                        break; // Don't retry on execution errors
                    }
                }
            }

            // 5. Generate summary
            task.summary = await this.llm.summarizeTask(
                task.originalQuery,
                task.decomposedTasks
            );

            // 6. CRITICAL: Verify goal completion before declaring success
            task.status = 'verifying';
            this.emit({
                type: 'verification_started',
                taskId,
                timestamp: new Date().toISOString(),
                data: { summary: task.summary },
            });

            const verificationResult = await this.llm.verifyGoalCompletion(
                task.originalQuery,
                task.decomposedTasks,
                task.summary || ''
            );

            task.verificationResult = verificationResult;

            // If goal not met and we have suggested next actions, retry
            if (!verificationResult.goalMet && verificationResult.suggestedNextActions?.length) {
                this.emit({
                    type: 'verification_failed',
                    taskId,
                    timestamp: new Date().toISOString(),
                    data: {
                        reason: verificationResult.evidence,
                        missingSteps: verificationResult.missingSteps,
                        suggestedActions: verificationResult.suggestedNextActions,
                    },
                });

                // Add missing steps as new subtasks and retry
                const newSubtasks: SubTask[] = verificationResult.suggestedNextActions.map((action, index) => ({
                    id: `${taskId}_recovery_${index}`,
                    description: action,
                    status: 'pending' as const,
                }));

                task.decomposedTasks.push(...newSubtasks);

                // Execute recovery subtasks
                for (const subtask of newSubtasks) {
                    subtask.status = 'running';
                    subtask.startedAt = new Date().toISOString();

                    this.emit({
                        type: 'subtask_started',
                        taskId,
                        timestamp: new Date().toISOString(),
                        data: { subtaskId: subtask.id, description: subtask.description, isRecovery: true },
                    });

                    try {
                        const tools = this.getAvailableTools ? await this.getAvailableTools() : [];
                        const result = await this.llm.executeSubtask(
                            subtask,
                            completedSubtasks,
                            tools
                        );

                        subtask.status = 'completed';
                        subtask.result = result.result;
                        subtask.completedAt = new Date().toISOString();
                        completedSubtasks.push(subtask);

                        this.emit({
                            type: 'subtask_completed',
                            taskId,
                            timestamp: new Date().toISOString(),
                            data: { subtaskId: subtask.id, result: result.result.slice(0, 200) },
                        });
                    } catch (error) {
                        subtask.status = 'failed';
                        subtask.error = error instanceof Error ? error.message : String(error);
                        subtask.completedAt = new Date().toISOString();
                    }
                }

                // Re-generate summary after recovery
                task.summary = await this.llm.summarizeTask(
                    task.originalQuery,
                    task.decomposedTasks
                );
            }

            this.emit({
                type: 'verification_completed',
                taskId,
                timestamp: new Date().toISOString(),
                data: {
                    goalMet: verificationResult.goalMet,
                    confidence: verificationResult.confidence,
                    evidence: verificationResult.evidence,
                },
            });

            // 7. Extract and save memories
            if (task.autoSaveMemory) {
                await this.extractAndSaveMemories(task);
            }

            // 8. Mark task as completed
            task.status = 'completed';
            task.completedAt = new Date().toISOString();

            this.emit({
                type: 'task_completed',
                taskId,
                timestamp: new Date().toISOString(),
                data: {
                    summary: task.summary,
                    goalMet: task.verificationResult?.goalMet ?? false,
                    confidence: task.verificationResult?.confidence ?? 0,
                    subtasksCompleted: task.decomposedTasks.filter(
                        (st) => st.status === 'completed'
                    ).length,
                    memoriesExtracted: task.memoryExtracted?.length ?? 0,
                },
            });
        } catch (error) {
            task.status = 'failed';
            task.completedAt = new Date().toISOString();

            this.emit({
                type: 'task_failed',
                taskId,
                timestamp: new Date().toISOString(),
                data: {
                    error: error instanceof Error ? error.message : String(error),
                },
            });
        }
    }

    /**
     * Extract memories from completed task and save to vault
     */
    private async extractAndSaveMemories(task: AutonomousTask): Promise<void> {
        try {
            const extraction = await this.llm.extractMemories(
                task.originalQuery,
                task.decomposedTasks,
                task.summary || ''
            );

            if (!extraction.shouldSave || extraction.facts.length === 0) {
                return;
            }

            this.emit({
                type: 'memory_extracted',
                taskId: task.id,
                timestamp: new Date().toISOString(),
                data: { factCount: extraction.facts.length },
            });

            const vault = getVaultManager();
            const savedPaths: string[] = [];

            for (const fact of extraction.facts) {
                if (fact.confidence >= 0.7) {
                    const category = fact.category === 'learning'
                        ? 'learnings'
                        : fact.category === 'preference'
                            ? 'preferences'
                            : 'projects';

                    const title = fact.content.slice(0, 50).replace(/[^a-zA-Z0-9\s]/g, '');
                    const path = await vault.saveMemory(title, fact.content, {
                        category,
                        tags: ['auto-extracted', `task-${task.id}`],
                    });

                    savedPaths.push(path);
                }
            }

            task.memoryExtracted = savedPaths;

            if (savedPaths.length > 0) {
                this.emit({
                    type: 'memory_saved',
                    taskId: task.id,
                    timestamp: new Date().toISOString(),
                    data: { paths: savedPaths },
                });
            }
        } catch (error) {
            console.error('[AutonomousAgent] Failed to extract/save memories:', error);
        }
    }

    /**
     * Get task status
     */
    getTask(taskId: string): AutonomousTask | undefined {
        return this.activeTasks.get(taskId);
    }

    /**
     * Get all active tasks
     */
    getAllTasks(): AutonomousTask[] {
        return Array.from(this.activeTasks.values());
    }

    /**
     * Pause a running task
     */
    pauseTask(taskId: string): boolean {
        const task = this.activeTasks.get(taskId);
        if (task && task.status === 'executing') {
            task.status = 'paused';
            return true;
        }
        return false;
    }

    /**
     * Resume a paused task
     */
    async resumeTask(taskId: string, userInput?: Record<string, string>): Promise<void> {
        const task = this.activeTasks.get(taskId);
        if (task && task.status === 'paused') {
            // TODO: Inject user input into task context
            await this.executeTask(taskId);
        }
    }

    /**
     * Cancel a task
     */
    cancelTask(taskId: string): boolean {
        const task = this.activeTasks.get(taskId);
        if (task && (task.status === 'executing' || task.status === 'paused')) {
            task.status = 'failed';
            task.completedAt = new Date().toISOString();
            return true;
        }
        return false;
    }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an autonomous agent controller
 */
export function createAutonomousAgent(options: {
    llm: AutonomousLlmInterface;
    getAvailableTools?: () => Promise<any[]>;
    maxConcurrentTasks?: number;
    autoSaveMemory?: boolean;
    onEvent?: AutonomousEventCallback;
}): AutonomousAgentController {
    return new AutonomousAgentController(options);
}

// ============================================================================
// Helper: Default LLM Implementation Prompts
// ============================================================================

export const TASK_DECOMPOSITION_PROMPT = `You are a task decomposition assistant. Given a user's request, break it down into clear, actionable subtasks.

User Request: {query}

Relevant Context from Memory:
{context}

  "subtasks": [
    {
      "description": "Clear description of what needs to be done",
      "requiresTools": ["tool1", "tool2"],
      "estimatedComplexity": "simple|medium|complex"
    }
  ],
  "overallStrategy": "Brief description of the approach",
  "canRunAutonomously": true/false,
  "requiresUserInput": ["Question 1", "Question 2"] // Empty if can run autonomously
}

Guidelines:
1. If the request involves unknown concepts, create a subtask to 'Research <topic>' first.
2. If the request involves code changes, create a subtask to 'Verify/Test' after implementation.
3. Be granular but efficient.
`;

export const MEMORY_EXTRACTION_PROMPT = `You are a memory extraction assistant. Given a completed task, identify important facts, learnings, or preferences that should be saved for future reference.

Original Request: {query}

Completed Subtasks:
{subtasks}

Final Summary: {summary}

Respond with a JSON object:
{
  "facts": [
    {
      "content": "The fact or learning to remember",
      "category": "learning|preference|project",
      "confidence": 0.0-1.0
    }
  ],
  "shouldSave": true/false
}

Only extract facts that are:
1. Genuinely useful for future tasks
2. Not obvious or trivial
3. Specific to the user or project`;

// ============================================================================
// Goal Verification Prompt (OpenClaw-style Anti-Premature-Termination)
// ============================================================================

export const GOAL_VERIFICATION_PROMPT = `You are a strict goal verification assistant. Your job is to determine if the user's ORIGINAL goal has been ACTUALLY achieved.

## The Iron Law
\`\`\`
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
\`\`\`

## Original User Request
{query}

## Completed Subtasks
{subtasks}

## Current Summary
{summary}

## Your Task
Analyze whether the original goal was truly met. Be SKEPTICAL. Common failures include:
1. Agent searched but didn't find the actual answer
2. Agent found information but didn't apply it to solve the problem
3. Agent declared success after ONE tool call without verification
4. Agent provided generic information instead of solving the specific problem

## Response Format (JSON)
{
  "goalMet": true/false,
  "evidence": "Specific evidence proving goal was/wasn't met",
  "confidence": 0.0-1.0,
  "missingSteps": ["Step 1 that's missing", "Step 2 that's missing"],
  "suggestedNextActions": ["Concrete action 1", "Concrete action 2"]
}

## Examples of FAILED verification:
- User asked "fix the bug" → Agent searched for error → Did NOT actually fix code → goalMet: false
- User asked "find the best library" → Agent returned first search result → Did NOT compare options → goalMet: false
- User asked "install and configure X" → Agent only installed → Did NOT configure → goalMet: false

Be rigorous. If in doubt, goalMet should be false.`;
