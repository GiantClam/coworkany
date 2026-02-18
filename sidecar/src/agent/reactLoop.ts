/**
 * ReAct Agent Loop Controller
 *
 * Implements the Reason-Act-Observe pattern for structured agent execution.
 * Integrates with RAG for memory-enhanced reasoning.
 */

import { getMemoryContext, SearchResult } from '../memory';
import { getSelfCorrectionEngine, formatErrorForAI } from './selfCorrection';
import {
    analyzeAndRecommendSkills,
    formatRecommendationsForUser,
    createSkillRecommendationEvent
} from './skillRecommendation/reactIntegration';
import { getVerificationEngine, getCorrectionCoordinator } from './verification';
import type { VerificationContext } from './verification/types';
import type { CodeIssue } from './codeQuality/types';

// ============================================================================
// Types
// ============================================================================

export interface AgentContext {
    taskId: string;
    workspacePath: string;
    availableTools: ToolInfo[];
    systemPrompt?: string;
    maxSteps?: number;
}

export interface ToolInfo {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

export interface ReActStep {
    stepNumber: number;
    timestamp: string;

    /** The reasoning/thinking process */
    thought: string;

    /** The action decided upon (null if final answer) */
    action: {
        tool: string;
        args: Record<string, unknown>;
    } | null;

    /** The result of executing the action */
    observation: string | null;

    /** Memory search results that informed this step */
    memoryHits?: SearchResult[];

    /** Whether this is the final step */
    isFinal: boolean;
}

export interface ReActResult {
    taskId: string;
    steps: ReActStep[];
    finalAnswer: string;
    totalSteps: number;
    memoryUsed: boolean;
    duration: number;
}

export type ReActEventType =
    | 'step_start'
    | 'thought'
    | 'memory_search'
    | 'action_start'
    | 'action_complete'
    | 'observation'
    | 'final_answer'
    | 'skill_recommendation'
    | 'error';

export interface ReActEvent {
    type: ReActEventType;
    taskId: string;
    stepNumber: number;
    data: Record<string, unknown>;
}

export type ReActEventCallback = (event: ReActEvent) => void;

// ============================================================================
// Tool Execution Interface
// ============================================================================

export interface ToolExecutor {
    execute(toolName: string, args: Record<string, unknown>): Promise<string>;
}

// ============================================================================
// LLM Interface for ReAct
// ============================================================================

export interface ReActLlmInterface {
    /**
     * Generate thought/reasoning given the current state
     */
    generateThought(
        query: string,
        history: ReActStep[],
        memoryContext: string,
        tools: ToolInfo[]
    ): Promise<string>;

    /**
     * Decide on an action based on the thought
     */
    decideAction(
        thought: string,
        tools: ToolInfo[]
    ): Promise<{ tool: string; args: Record<string, unknown> } | null>;

    /**
     * Generate final answer
     */
    generateFinalAnswer(
        query: string,
        history: ReActStep[],
        memoryContext: string
    ): Promise<string>;
}

// ============================================================================
// ReAct Loop Controller
// ============================================================================

export class ReActController {
    private llm: ReActLlmInterface;
    private toolExecutor: ToolExecutor;
    private eventCallback?: ReActEventCallback;
    private maxSteps: number;
    private enableMemory: boolean;
    private enableSelfCorrection: boolean;
    private enableVerification: boolean;
    private selfCorrectionEngine = getSelfCorrectionEngine();
    private verificationEngine = getVerificationEngine();
    private correctionCoordinator = getCorrectionCoordinator();
    private suspendCoordinator?: any; // SuspendCoordinator (avoid circular dependency)

    // Plan refinement tracking
    private consecutiveErrors: number = 0;
    private sameToolAttempts: Map<string, number> = new Map();
    private readonly PLAN_REFINEMENT_THRESHOLD = 2;

    constructor(options: {
        llm: ReActLlmInterface;
        toolExecutor: ToolExecutor;
        maxSteps?: number;
        enableMemory?: boolean;
        enableSelfCorrection?: boolean;
        enableVerification?: boolean;
        onEvent?: ReActEventCallback;
        adaptiveExecutor?: any; // AdaptiveExecutor (optional)
        suspendCoordinator?: any; // SuspendCoordinator (optional)
    }) {
        this.llm = options.llm;

        // If adaptiveExecutor provided, wrap toolExecutor
        if (options.adaptiveExecutor) {
            // Import AdaptiveToolExecutor dynamically to avoid circular dependency
            const { AdaptiveToolExecutor } = require('./adaptiveToolExecutor');
            this.toolExecutor = new AdaptiveToolExecutor(
                options.toolExecutor,
                options.adaptiveExecutor
            );
            console.log('[ReActController] AdaptiveExecutor integrated');
        } else {
            this.toolExecutor = options.toolExecutor;
        }

        this.suspendCoordinator = options.suspendCoordinator;
        this.maxSteps = options.maxSteps ?? 10;
        this.enableMemory = options.enableMemory ?? true;
        this.enableSelfCorrection = options.enableSelfCorrection ?? true;
        this.enableVerification = options.enableVerification ?? true;
        this.eventCallback = options.onEvent;
    }

    /**
     * Detect if the agent is stuck and needs plan refinement
     */
    private needsPlanRefinement(action: { tool: string; args: Record<string, unknown> } | null, observation: string): boolean {
        if (!action) return false;

        // Track consecutive errors
        if (this.looksLikeError(observation)) {
            this.consecutiveErrors++;
        } else {
            this.consecutiveErrors = 0;
        }

        // Track same tool attempts
        const toolKey = `${action.tool}:${JSON.stringify(action.args).slice(0, 100)}`;
        const attempts = (this.sameToolAttempts.get(toolKey) || 0) + 1;
        this.sameToolAttempts.set(toolKey, attempts);

        // Trigger plan refinement if:
        // 1. Multiple consecutive errors
        // 2. Same tool called multiple times with similar args (stuck in loop)
        return this.consecutiveErrors >= this.PLAN_REFINEMENT_THRESHOLD ||
               attempts >= this.PLAN_REFINEMENT_THRESHOLD;
    }

    /**
     * Generate a plan refinement hint for the LLM
     */
    private generatePlanRefinementHint(steps: ReActStep[]): string {
        const recentSteps = steps.slice(-3);
        const toolsUsed = recentSteps
            .filter(s => s.action)
            .map(s => s.action!.tool);

        const recentArgs = recentSteps
            .filter(s => s.action)
            .map(s => JSON.stringify(s.action!.args || {}).substring(0, 120));

        // Detect browser-specific stuck patterns
        const isBrowserStuck = toolsUsed.some(t =>
            t.startsWith('browser_') || t === 'browser_set_mode' || t === 'browser_navigate'
        );
        const isSmartModeLoop = toolsUsed.includes('browser_set_mode') &&
            recentArgs.some(a => a.includes('smart'));
        const isPageLoadIssue = recentSteps.some(s =>
            s.observation && (
                s.observation.includes('JavaScript') ||
                s.observation.includes('not available') ||
                s.observation.includes('noscript') ||
                s.observation.includes('errorContainer')
            )
        );

        let hint = `
[PLAN REFINEMENT REQUIRED]
The current approach is not making progress. Analysis:
- Consecutive errors: ${this.consecutiveErrors}
- Recent tools used: ${toolsUsed.join(', ') || 'None'}
- Observations indicate failure or lack of progress
`;

        if (isSmartModeLoop) {
            hint += `
## CRITICAL: browser_set_mode("smart") DOES NOT WORK
Smart mode (browser-use AI vision) is NOT available. STOP calling browser_set_mode.

MANDATORY RECOVERY STEPS:
1. Use search_web to search: "[site name] playwright automation best practices 2025"
2. Use browser_execute_script to interact with the page via JavaScript
3. Use browser_navigate with wait_until="networkidle" if the SPA didn't render
4. For X/Twitter: navigate directly to https://x.com/compose/post
5. Use browser_click with CSS selectors to interact with specific elements
`;
        } else if (isBrowserStuck && isPageLoadIssue) {
            hint += `
## CRITICAL: Page did not render correctly (SPA/JavaScript issue)
The page requires JavaScript but it hasn't loaded. This is a common SPA issue.

MANDATORY RECOVERY STEPS:
1. Use search_web to search: "playwright [site name] SPA page load wait strategy"
2. Use browser_navigate with wait_until="networkidle" to re-navigate (wait for full render)
3. Use browser_execute_script to check document.readyState and React root
4. If the site has a direct URL for the action (e.g., compose page), navigate there instead
5. Wait 5-10 seconds after navigation for SPA frameworks to hydrate
`;
        } else if (isBrowserStuck) {
            hint += `
## Browser automation is stuck
MANDATORY RECOVERY STEPS:
1. Use search_web to find community best practices for automating this specific website
2. Try browser_execute_script to interact via JavaScript (dispatchEvent, click(), etc.)
3. Try different CSS selectors or XPath with browser_click
4. Use browser_get_content to inspect the current page structure
5. If a button/link isn't clickable, try scrolling to it first or using JavaScript click
`;
        } else {
            hint += `
REQUIRED: Step back and reconsider your strategy. Options:
1. Use search_web to search for community solutions to the specific problem you're encountering
2. Try a completely different tool or approach
3. Break down the problem into smaller steps
4. If the task involves web interaction, consider using browser automation
5. If search results are unhelpful, try different search terms
`;
        }

        hint += `
DO NOT repeat the same approach. Make a deliberate change in strategy.
When encountering an unknown problem, ALWAYS search_web for solutions first.
`;
        return hint;
    }

    /**
     * Reset plan refinement tracking (call when making progress)
     */
    private resetRefinementTracking(): void {
        this.consecutiveErrors = 0;
        this.sameToolAttempts.clear();
    }

    /**
     * Emit a ReAct event
     */
    private emit(event: ReActEvent): void {
        if (this.eventCallback) {
            this.eventCallback(event);
        }
    }

    /**
     * Check if a tool output looks like an error
     */
    private looksLikeError(output: string): boolean {
        const errorIndicators = [
            'error:',
            'failed:',
            'exception:',
            'traceback',
            'syntaxerror',
            'typeerror',
            'valueerror',
            'modulenotfounderror',
            'filenotfounderror',
            'permissionerror',
            'exit_code": -1',
            'exit_code":-1',
            '"success": false',
            '"success":false',
        ];
        const lowerOutput = output.toLowerCase();
        return errorIndicators.some(indicator => lowerOutput.includes(indicator));
    }

    /**
     * Execute the ReAct loop for a given query
     */
    async *execute(query: string, context: AgentContext): AsyncGenerator<ReActStep, ReActResult, unknown> {
        const startTime = Date.now();
        const steps: ReActStep[] = [];
        let stepNumber = 0;
        let memoryUsed = false;

        // === Skill Recommendation ===
        try {
            const recentMessages = steps.map(s => s.thought).slice(-5);
            const recentErrors = steps
                .filter(s => s.observation && this.looksLikeError(s.observation))
                .map(s => s.observation!)
                .slice(-3);

            // TODO: Get active skills from context or skill registry
            const activeSkills: string[] = [];

            const { recommendations, shouldAutoLoad } = await analyzeAndRecommendSkills(
                query,
                recentMessages,
                recentErrors,
                activeSkills,
                context.workspacePath
            );

            // Send recommendation event to frontend
            if (recommendations.length > 0) {
                const event = createSkillRecommendationEvent(
                    context.taskId,
                    recommendations,
                    shouldAutoLoad
                );

                this.emit({
                    type: 'skill_recommendation' as ReActEventType,
                    taskId: context.taskId,
                    stepNumber: 0,
                    data: event
                });

                // Log recommendations for debugging
                console.log(`[ReAct] Skill recommendations:`, recommendations.map(r => r.skillName));

                // If there's a high-confidence recommendation, auto-load it
                if (shouldAutoLoad) {
                    console.log(`[ReAct] High-confidence skill suggested: ${shouldAutoLoad.skillName} (${shouldAutoLoad.confidence.toFixed(2)})`);
                    // TODO: Integrate with skill loading logic when available
                    // await this.loadSkill(shouldAutoLoad.skillName);
                }
            }
        } catch (error) {
            console.error('[ReAct] Skill recommendation failed:', error);
            // Continue execution - skill recommendation failure should not block the main flow
        }
        // === End Skill Recommendation ===

        while (stepNumber < this.maxSteps) {
            stepNumber++;

            this.emit({
                type: 'step_start',
                taskId: context.taskId,
                stepNumber,
                data: {},
            });

            // 1. Memory Enhancement - Search for relevant context
            let memoryContext = '';
            let memoryHits: SearchResult[] = [];

            if (this.enableMemory) {
                try {
                    this.emit({
                        type: 'memory_search',
                        taskId: context.taskId,
                        stepNumber,
                        data: { query },
                    });

                    memoryContext = await getMemoryContext(query, {
                        topK: 3,
                        maxChars: 2000,
                    });

                    if (memoryContext) {
                        memoryUsed = true;
                    }
                } catch (error) {
                    console.error('[ReAct] Memory search failed:', error);
                }
            }

            // 2. Reason - Generate thought based on current state
            this.emit({
                type: 'thought',
                taskId: context.taskId,
                stepNumber,
                data: { phase: 'generating' },
            });

            const thought = await this.llm.generateThought(
                query,
                steps,
                memoryContext,
                context.availableTools
            );

            this.emit({
                type: 'thought',
                taskId: context.taskId,
                stepNumber,
                data: { thought },
            });

            // 3. Act - Decide on action or provide final answer
            const action = await this.llm.decideAction(thought, context.availableTools);

            // Check if this is the final answer (no action needed)
            if (!action) {
                // Generate final answer
                this.emit({
                    type: 'final_answer',
                    taskId: context.taskId,
                    stepNumber,
                    data: { phase: 'generating' },
                });

                const finalAnswer = await this.llm.generateFinalAnswer(
                    query,
                    steps,
                    memoryContext
                );

                const finalStep: ReActStep = {
                    stepNumber,
                    timestamp: new Date().toISOString(),
                    thought,
                    action: null,
                    observation: null,
                    memoryHits: memoryHits.length > 0 ? memoryHits : undefined,
                    isFinal: true,
                };

                steps.push(finalStep);
                yield finalStep;

                return {
                    taskId: context.taskId,
                    steps,
                    finalAnswer,
                    totalSteps: stepNumber,
                    memoryUsed,
                    duration: Date.now() - startTime,
                };
            }

            // 3.5. Pre-execution suspend check (NEW)
            if (this.suspendCoordinator) {
                try {
                    const preDecision = await this.suspendCoordinator.checkPreExecutionSuspend(
                        context.taskId,
                        thought,
                        action
                    );

                    if (preDecision.shouldSuspend) {
                        console.log(`[ReActController] Pre-execution suspend: ${preDecision.reason}`);

                        await this.suspendCoordinator.suspend(context.taskId, preDecision);

                        const suspendedStep: ReActStep = {
                            stepNumber,
                            timestamp: new Date().toISOString(),
                            thought,
                            action,
                            observation: `⏸ Task suspended: ${preDecision.userMessage}`,
                            memoryHits: memoryHits.length > 0 ? memoryHits : undefined,
                            isFinal: false,
                        };

                        steps.push(suspendedStep);
                        yield suspendedStep;

                        // Pause execution - task is suspended
                        // In a real implementation, we would need a way to resume from here
                        break;
                    }
                } catch (error) {
                    console.error('[ReActController] Error in pre-execution suspend check:', error);
                }
            }

            // 4. Execute action
            this.emit({
                type: 'action_start',
                taskId: context.taskId,
                stepNumber,
                data: { tool: action.tool, args: action.args },
            });

            let observation: string;
            try {
                observation = await this.toolExecutor.execute(action.tool, action.args);

                this.emit({
                    type: 'action_complete',
                    taskId: context.taskId,
                    stepNumber,
                    data: { tool: action.tool, success: true },
                });

                // Check if the result contains an error (some tools return error in result)
                if (this.enableSelfCorrection && this.looksLikeError(observation)) {
                    const errorHint = formatErrorForAI(
                        observation,
                        action.tool,
                        action.args as Record<string, unknown>,
                        0
                    );
                    observation = `${observation}\n\n${errorHint}`;
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                observation = `Error: ${errorMessage}`;

                // Add self-correction hint for caught errors
                if (this.enableSelfCorrection) {
                    const errorHint = formatErrorForAI(
                        errorMessage,
                        action.tool,
                        action.args as Record<string, unknown>,
                        0
                    );
                    observation = `${observation}\n\n${errorHint}`;
                }

                this.emit({
                    type: 'action_complete',
                    taskId: context.taskId,
                    stepNumber,
                    data: { tool: action.tool, success: false, error: observation },
                });
            }

            // 4.5. Automatic Verification + Quality Check (Phase 3 + Phase 2)
            if (this.enableVerification) {
                try {
                    const verificationContext: VerificationContext = {
                        taskId: context.taskId,
                        workspacePath: context.workspacePath,
                        previousSteps: steps.map(s => s.thought),
                    };

                    // Use postExecutionValidation which includes quality checks
                    const validation = await this.correctionCoordinator.postExecutionValidation(
                        action.tool,
                        action.args as Record<string, unknown>,
                        observation,
                        verificationContext
                    );

                    // If verification failed, add hint to observation
                    if (validation.verification.status === 'failed') {
                        const formattedResult = this.verificationEngine.formatResult(validation.verification);
                        observation = `${observation}\n\n${formattedResult}`;
                        console.log(`[ReActController] Verification failed for ${action.tool}:`, validation.verification.message);
                    } else if (validation.verification.status === 'passed') {
                        console.log(`[ReActController] Verification passed for ${action.tool}: ${validation.verification.message}`);
                    }

                    // If quality check was performed, add quality report to observation
                    if (validation.qualityReport) {
                        const qualityScore = validation.qualityReport.score;
                        const qualityLevel = qualityScore >= 85 ? '✨ Excellent' :
                                           qualityScore >= 70 ? '✅ Good' :
                                           qualityScore >= 60 ? '⚠️ Acceptable' :
                                           '❌ Needs Work';

                        const qualityMessage = `\n\n📊 Code Quality: ${qualityLevel} (${qualityScore}/100)`;

                        if (validation.qualityReport.issues.length > 0) {
                            const criticalIssues = validation.qualityReport.issues.filter((i: CodeIssue) => i.severity === 'error');
                            const warnings = validation.qualityReport.issues.filter((i: CodeIssue) => i.severity === 'warning');

                            const issuesMsg = [
                                criticalIssues.length > 0 ? `${criticalIssues.length} critical issue(s)` : null,
                                warnings.length > 0 ? `${warnings.length} warning(s)` : null
                            ].filter(Boolean).join(', ');

                            observation = `${observation}${qualityMessage}\nIssues: ${issuesMsg}`;

                            // Log the top 3 issues for debugging
                            const topIssues = validation.qualityReport.issues.slice(0, 3);
                            console.log(`[ReActController] Quality issues in ${action.args.file_path}:`,
                                topIssues.map((i: CodeIssue) => `${i.severity}: ${i.message}`).join('; '));
                        } else {
                            observation = `${observation}${qualityMessage}\n✅ No issues found`;
                        }
                    }

                    // If overall validation failed (verification OR quality), mark it
                    if (!validation.overallPassed) {
                        console.log(`[ReActController] Overall validation failed for ${action.tool}`);
                    }
                } catch (error) {
                    console.error('[ReActController] Verification error:', error);
                    // Don't block execution if verification fails
                }
            }

            // 5. Observe - Record the result
            this.emit({
                type: 'observation',
                taskId: context.taskId,
                stepNumber,
                data: { observation: observation.slice(0, 500) },
            });

            // 5.5. Post-execution suspend check (NEW)
            if (this.suspendCoordinator) {
                try {
                    const postDecision = await this.suspendCoordinator.checkPostExecutionSuspend(
                        context.taskId,
                        action,
                        observation
                    );

                    if (postDecision.shouldSuspend) {
                        console.log(`[ReActController] Post-execution suspend: ${postDecision.reason}`);

                        await this.suspendCoordinator.suspend(context.taskId, postDecision);

                        const suspendedStep: ReActStep = {
                            stepNumber,
                            timestamp: new Date().toISOString(),
                            thought,
                            action,
                            observation: `${observation}\n\n⏸ Task suspended: ${postDecision.userMessage}`,
                            memoryHits: memoryHits.length > 0 ? memoryHits : undefined,
                            isFinal: false,
                        };

                        steps.push(suspendedStep);
                        yield suspendedStep;

                        // Pause execution - task is suspended
                        break;
                    }
                } catch (error) {
                    console.error('[ReActController] Error in post-execution suspend check:', error);
                }
            }

            // 6. Plan Refinement Check - Detect if agent is stuck
            if (this.needsPlanRefinement(action, observation)) {
                const refinementHint = this.generatePlanRefinementHint(steps);
                observation = `${observation}\n\n${refinementHint}`;

                this.emit({
                    type: 'observation',
                    taskId: context.taskId,
                    stepNumber,
                    data: {
                        observation: 'Plan refinement triggered',
                        refinementHint: refinementHint.slice(0, 200),
                    },
                });
            } else if (!this.looksLikeError(observation)) {
                // Reset tracking when making progress
                this.resetRefinementTracking();
            }

            const step: ReActStep = {
                stepNumber,
                timestamp: new Date().toISOString(),
                thought,
                action,
                observation,
                memoryHits: memoryHits.length > 0 ? memoryHits : undefined,
                isFinal: false,
            };

            steps.push(step);
            yield step;
        }

        // Max steps reached without final answer
        const timeoutAnswer = 'I was unable to complete the task within the maximum number of steps.';

        return {
            taskId: context.taskId,
            steps,
            finalAnswer: timeoutAnswer,
            totalSteps: stepNumber,
            memoryUsed,
            duration: Date.now() - startTime,
        };
    }

    /**
     * Execute a single ReAct step (for more granular control)
     */
    async executeStep(
        query: string,
        previousSteps: ReActStep[],
        context: AgentContext
    ): Promise<ReActStep> {
        const stepNumber = previousSteps.length + 1;

        // Memory search
        let memoryContext = '';
        if (this.enableMemory) {
            try {
                memoryContext = await getMemoryContext(query, { topK: 3, maxChars: 2000 });
            } catch {
                // Ignore memory errors
            }
        }

        // Generate thought
        const thought = await this.llm.generateThought(
            query,
            previousSteps,
            memoryContext,
            context.availableTools
        );

        // Decide action
        const action = await this.llm.decideAction(thought, context.availableTools);

        if (!action) {
            return {
                stepNumber,
                timestamp: new Date().toISOString(),
                thought,
                action: null,
                observation: null,
                isFinal: true,
            };
        }

        // Execute action
        let observation: string;
        try {
            observation = await this.toolExecutor.execute(action.tool, action.args);
        } catch (error) {
            observation = `Error: ${error instanceof Error ? error.message : String(error)}`;
        }

        return {
            stepNumber,
            timestamp: new Date().toISOString(),
            thought,
            action,
            observation,
            isFinal: false,
        };
    }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a ReAct controller with the given configuration
 */
export function createReActController(options: {
    llm: ReActLlmInterface;
    toolExecutor: ToolExecutor;
    maxSteps?: number;
    enableMemory?: boolean;
    onEvent?: ReActEventCallback;
}): ReActController {
    return new ReActController(options);
}

// ============================================================================
// Helper: Format ReAct history for LLM prompt
// ============================================================================

/**
 * Format ReAct steps as a string for inclusion in LLM prompts
 */
export function formatReActHistory(steps: ReActStep[]): string {
    if (steps.length === 0) return '';

    const formatted = steps.map((step) => {
        let entry = `Step ${step.stepNumber}:\n`;
        entry += `Thought: ${step.thought}\n`;

        if (step.action) {
            entry += `Action: ${step.action.tool}(${JSON.stringify(step.action.args)})\n`;
            entry += `Observation: ${step.observation || 'N/A'}\n`;
        }

        return entry;
    });

    return formatted.join('\n');
}

/**
 * Build a ReAct system prompt
 */
export function buildReActSystemPrompt(tools: ToolInfo[]): string {
    const toolDescriptions = tools
        .map((t) => `- ${t.name}: ${t.description}`)
        .join('\n');

    const now = new Date();
    const currentDate = now.toLocaleDateString('zh-CN', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        weekday: 'long' 
    });
    const currentTime = now.toLocaleTimeString('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Asia/Shanghai'
    });

    return `You are a helpful AI assistant that follows the ReAct (Reason + Act) pattern.

## Current Date & Time
- Date: ${currentDate}
- Time: ${currentTime} (Asia/Shanghai timezone)

For each step, you should:
1. THINK: Analyze the current situation and what needs to be done
2. ACT: Choose a tool to use, or provide a final answer if the task is complete
3. OBSERVE: Review the result of your action

Available tools:
${toolDescriptions}

## CRITICAL: Iron Laws (Non-Negotiable)

### Iron Law 1: No Premature Completion
\`\`\`
NO FINAL ANSWER UNTIL THE USER'S ACTUAL GOAL IS ACHIEVED
\`\`\`

### Iron Law 2: Verification Before Completion
\`\`\`
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
\`\`\`
Claiming work is complete without running verification commands is forbidden.
Run the command → Read the output → THEN claim the result. No shortcuts.

### Iron Law 3: Root Cause Before Fix (for debugging)
\`\`\`
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
\`\`\`
If you haven't traced the root cause, you cannot propose a fix. Symptom fixes create new bugs.

### FORBIDDEN Behaviors (Will Result in Task Failure):
1. ❌ Declaring "FINAL ANSWER" after a single search without applying results
2. ❌ Saying "I found information about X" without actually solving X
3. ❌ Returning generic information when user asked for specific action
4. ❌ Giving up after one failed attempt
5. ❌ Claiming success without running verification
6. ❌ Using "should work", "probably fixed", "looks correct" — these are NOT evidence
7. ❌ Trying random fixes without understanding root cause

### REQUIRED Behaviors:
1. ✅ If user asks to "fix X" → Investigate root cause → Apply fix → Verify fix works
2. ✅ If user asks to "find Y" → Search → Evaluate results → Return best option with reasoning
3. ✅ If user asks to "install Z" → Install → Configure → Verify working
4. ✅ If first approach fails → Try alternative approach → Escalate only after 3+ attempts
5. ✅ Before claiming "done" → Run verification command → Show evidence in response

### Verification Gate (MUST pass before FINAL ANSWER):
Ask yourself: "Did I actually DO what the user asked, or did I just SEARCH for information?"
- If you only searched: NOT DONE. Apply the information.
- If you applied but didn't verify: NOT DONE. Verify it works.
- If you verified and it works: NOW you can give FINAL ANSWER.

### Rationalization Prevention
If you catch yourself thinking any of these, STOP:
| Thought | Reality |
|---------|---------|
| "Should work now" | Run the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "It's too simple to test" | Simple things break. Test takes 30 seconds. |
| "I'll verify later" | Later never comes. Verify now. |
| "The code looks correct" | Looking ≠ running |

## MANDATORY: Pre-Execution Planning Protocol

For ANY task involving system commands, file operations, or multi-step workflows,
you MUST follow this planning sequence BEFORE executing any action tool:

### Step 0: Environment Assessment (ALWAYS FIRST)
Check the System Environment section in your system prompt. Before running ANY command:
- What OS and shell am I working with? (Windows/macOS/Linux)
- What commands are available on this platform?
- Are there platform-specific considerations?

DO NOT guess the platform. DO NOT try Linux commands on Windows or vice versa.
The System Environment section tells you exactly what platform you are on.

### Step 1: Task Decomposition (PERSISTENT)
Use the \`plan_step\` tool to record your planned approach BEFORE executing.
Plan steps are PERSISTED to .coworkany/task_plan.md on disk — they survive context truncation.
- plan_step(1, "Check system environment and determine appropriate commands", goal="<overall task goal>")
- plan_step(2, "Execute platform-specific command to gather data")
- plan_step(3, "Analyze results and synthesize findings")
- plan_step(4, "Generate report / deliver final answer")

### Step 2: Execute Plan
Follow your recorded plan steps sequentially. Use platform-appropriate commands only.
- After completing each step, call plan_step again with status="completed"
- Use \`log_finding\` to persist important discoveries to .coworkany/findings.md
- Use \`think\` for structured reasoning (also persisted to progress.md)

### Step 3: Verify & Report
Confirm results match the original goal before declaring completion.
Mark all plan steps as "completed" or "skipped" before giving FINAL ANSWER.

VIOLATION: Executing system commands without first confirming platform compatibility
is a planning failure. Always check your System Environment, plan, then execute.

## Standard Guidelines:
- Think step by step before acting
- Use tools when you need external information or to perform actions
- If memory context is provided, consider it in your reasoning
- **Autonomous Recovery**: If a tool fails, analyze the error. Use 'search_web' for unclear errors. Write debug scripts for complex logic. Do NOT give up immediately.
- **Browser Automation**: If search_web returns unhelpful results or you need to interact with a webpage, use browser automation (webapp-testing skill with Playwright).
- **Persistence**: Complex tasks require multiple steps. Find → Fix → Verify.

## CRITICAL: Self-Recovery & Community Knowledge Protocol

When encountering a problem you haven't solved before, ALWAYS follow this protocol:

### Step 1: Search for Community Best Practices
Before trying random things, use \`search_web\` to find how others solved similar problems:
- Query pattern: "[website/tool name] [specific problem] playwright automation best practices [year]"
- Examples:
  - "X Twitter playwright post automation SPA wait strategy 2025"
  - "小红书 playwright 发布按钮 click 自动化 2025"
  - "Playwright SPA page load networkidle React hydration"

### Step 2: Apply What You Learned
Based on search results, try the recommended approach. Common patterns:
- **SPA sites (X, Facebook, etc.)**: Use \`wait_until: "networkidle"\` in browser_navigate, then wait 3-5s for hydration
- **JavaScript not available**: The page needs longer to load. Wait for network idle, or navigate to direct action URLs
- **Anti-automation**: Use browser_execute_script to interact via real DOM events (dispatchEvent)
- **Unknown page structure**: Use browser_get_content to inspect, then browser_execute_script for custom interactions

### Step 3: NEVER Repeat Failing Approaches
- If \`browser_set_mode("smart")\` fails, it will ALWAYS fail. STOP calling it.
- If a page doesn't load, retrying the same navigation won't help. Change wait_until or URL.
- If a selector doesn't find an element, try different selectors or use JavaScript.

### Step 4: Escalate with Knowledge
If 3 attempts fail, search again with more specific error details:
- Include the exact error message in your search
- Search for the specific website + Playwright combination
- Try searching in Chinese if the site is Chinese (小红书, 微博, etc.)

When you're ready to provide a final answer (ONLY after verification), respond with:
FINAL ANSWER: [your answer here]`;
}
