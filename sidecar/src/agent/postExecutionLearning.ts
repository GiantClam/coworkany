/**
 * Post-Execution Learning Manager
 *
 * Analyzes successful task sessions and decides whether to precipitate them
 * as reusable knowledge, procedures, or skills.
 *
 * This is the CORRECT way to learn: learn from successful experiences,
 * not from hypothetical scenarios.
 */

import type { TaskEvent } from '../protocol/events';
import type { SelfLearningController } from './selfLearning/controller';
import type { Precipitator } from './selfLearning/precipitator';
import type { ConfidenceTracker } from './selfLearning/confidenceTracker';

export interface PostExecutionLearningConfig {
    /**
     * Minimum number of tool calls to consider for skill generation
     */
    minToolCallsForSkill: number;

    /**
     * Minimum task duration (ms) to consider valuable
     */
    minDurationForLearning: number;

    /**
     * Keywords that indicate high-value tasks
     */
    valueKeywords: string[];
}

const DEFAULT_CONFIG: PostExecutionLearningConfig = {
    minToolCallsForSkill: 3,
    minDurationForLearning: 5000, // 5 seconds
    valueKeywords: [
        'post', 'publish', 'create', 'deploy', 'build', 'generate',
        '发布', '创建', '部署', '生成', '制作'
    ],
};

export interface TaskSession {
    taskId: string;
    userQuery: string;
    events: TaskEvent[];
    status: 'finished' | 'failed';
    duration: number;
    toolCalls: Array<{
        toolName: string;
        args: any;
        result?: any;
        success: boolean;
    }>;
}

export interface LearningDecision {
    shouldLearn: boolean;
    reason: string;
    suggestedType: 'knowledge' | 'procedure' | 'skill';
    confidence: number;
}

export class PostExecutionLearningManager {
    private config: PostExecutionLearningConfig;
    private precipitator: Precipitator;
    private confidenceTracker: ConfidenceTracker;
    private selfLearningController?: SelfLearningController;

    // Track sessions to analyze
    private sessionBuffer: Map<string, TaskSession> = new Map();

    constructor(
        precipitator: Precipitator,
        confidenceTracker: ConfidenceTracker,
        config?: Partial<PostExecutionLearningConfig>,
        selfLearningController?: SelfLearningController
    ) {
        this.precipitator = precipitator;
        this.confidenceTracker = confidenceTracker;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.selfLearningController = selfLearningController;
    }

    /**
     * Set the self-learning controller (for deferred initialization)
     */
    setSelfLearningController(controller: SelfLearningController): void {
        this.selfLearningController = controller;
    }

    /**
     * Handle task event - build session from events
     */
    handleEvent(event: TaskEvent): void {
        const { taskId } = event;

        // Get or create session
        let session = this.sessionBuffer.get(taskId);
        if (!session && event.type === 'TASK_STARTED') {
            const payload = event.payload as any;
            session = {
                taskId,
                userQuery: payload.context?.userQuery || payload.description || '',
                events: [],
                status: 'finished',
                duration: 0,
                toolCalls: [],
            };
            this.sessionBuffer.set(taskId, session);
        }

        if (!session) return;

        // Add event to session
        session.events.push(event);

        // Extract tool calls
        const eventType = (event as any).type;

        if (eventType === 'TOOL_CALLED' || eventType === 'TOOL_CALL') {
            const payload = event.payload as any;
            session.toolCalls.push({
                toolName: payload.toolName || payload.name || 'unknown_tool',
                args: payload.args || payload.input || {},
                success: true, // Will be updated on TOOL_RESULT
            });
        }

        if (event.type === 'TOOL_RESULT') {
            const payload = event.payload as any;
            const lastCall = session.toolCalls[session.toolCalls.length - 1];
            if (lastCall) {
                lastCall.result = payload.result;
                if (typeof payload.success === 'boolean') {
                    lastCall.success = payload.success;
                } else if (typeof payload.isError === 'boolean') {
                    lastCall.success = !payload.isError;
                } else {
                    lastCall.success = true;
                }
            }
        }

            // Task failed - analyze failure and learn what went wrong
        if (event.type === 'TASK_FAILED') {
            session.status = 'failed';
            const payload = event.payload as any;
            session.duration = payload.duration || 0;
            
            // Trigger failure analysis asynchronously
            void this.analyzeFailure(session);

            // Clean up buffer after a delay
            setTimeout(() => this.sessionBuffer.delete(taskId), 60000);
        }
    }

    /**
     * Analyze failed session and learn from the failure
     */
    private async analyzeFailure(session: TaskSession): Promise<void> {
        console.log(`[PostLearning] 📚 Learning from FAILED session: ${session.userQuery}`);
        
        try {
            // Extract failure information
            const failedToolCalls = session.toolCalls.filter(tc => !tc.success);
            const errorMessages = failedToolCalls
                .map(tc => tc.result?.error || tc.result || 'Unknown error')
                .join('; ');
            
            console.log(`[PostLearning] Failed tool calls: ${failedToolCalls.length}`);
            console.log(`[PostLearning] Errors: ${errorMessages}`);
            
            // Extract what capability is missing
            const missingCapability = this.extractMissingCapability(session, errorMessages);
            
            if (missingCapability) {
                console.log(`[PostLearning] Detected missing capability: ${missingCapability}`);
                
                // Check if we should trigger self-learning
                const shouldTriggerLearning = this.shouldTriggerLearning(missingCapability, errorMessages);
                
                if (shouldTriggerLearning && this.selfLearningController) {
                    console.log(`[PostLearning] Triggering self-learning for: ${missingCapability}`);
                    try {
                        const learnResult = await this.selfLearningController.quickLearnFromError(
                            errorMessages,
                            session.userQuery,
                            failedToolCalls.length
                        );
                        if (learnResult.learned) {
                            console.log(`[PostLearning] Self-learning succeeded for: ${missingCapability}`);
                            if (learnResult.suggestion) {
                                console.log(`[PostLearning] Suggestion: ${learnResult.suggestion.substring(0, 200)}...`);
                            }
                        } else {
                            console.log(`[PostLearning] Self-learning did not produce results for: ${missingCapability}`);
                        }
                    } catch (learnErr) {
                        console.error(`[PostLearning] Self-learning failed:`, learnErr);
                    }
                } else if (shouldTriggerLearning) {
                    console.log(`[PostLearning] Would trigger learning for ${missingCapability}, but selfLearningController not available`);
                }
            }
            
            // Extract failure knowledge to save
            const failureKnowledge = this.extractFailureKnowledge(session, errorMessages);
            
            // Precipitate as failed knowledge (for future reference)
            const result = await this.precipitator.precipitate(failureKnowledge, {
                success: false,
                testResults: [],
                installedDependencies: [],
                finalWorkingCode: '',
                discoveredIssues: [errorMessages],
                refinements: [],
                executionTimeMs: session.duration,
                retryCount: 0,
            });
            
            if (result.success) {
                console.log(`[PostLearning] ✅ Saved failure knowledge: ${result.path}`);
            } else {
                console.error(`[PostLearning] ❌ Failed to save failure knowledge: ${result.error}`);
            }
        } catch (error) {
            console.error('[PostLearning] Error during failure analysis:', error);
        }
    }
    
    /**
     * Extract missing capability from failed session
     */
    private extractMissingCapability(session: TaskSession, errorMessages: string): string | null {
        const errorLower = errorMessages.toLowerCase();
        const queryLower = session.userQuery.toLowerCase();
        
        // Database related
        if (errorLower.includes('database') || errorLower.includes('sql') || 
            errorLower.includes('mysql') || errorLower.includes('postgres') ||
            queryLower.includes('database') || queryLower.includes('db')) {
            return 'database_operations';
        }
        
        // Network related
        if (errorLower.includes('connection') || errorLower.includes('network') ||
            errorLower.includes('timeout') || errorLower.includes('refused')) {
            return 'network_operations';
        }
        
        // API related
        if (errorLower.includes('api') || errorLower.includes('http') ||
            errorLower.includes('401') || errorLower.includes('403') || errorLower.includes('500')) {
            return 'api_integration';
        }

        // Presentation/ppt generation related
        if (queryLower.includes('ppt') || queryLower.includes('pptx') ||
            queryLower.includes('powerpoint') || queryLower.includes('presentation') ||
            queryLower.includes('演示文稿') || queryLower.includes('幻灯片') ||
            errorLower.includes('ppt') || errorLower.includes('pptx') ||
            errorLower.includes('missing required artifact')) {
            return 'presentation_generation';
        }
        
        // File system related
        if (errorLower.includes('permission') || errorLower.includes('denied') ||
            errorLower.includes('not found') || errorLower.includes('enoent')) {
            return 'file_operations';
        }
        
        // Generic - return keywords from query
        if (queryLower.length > 0) {
            const keywords = queryLower.split(/\s+/).slice(0, 3).join(' ');
            return keywords;
        }
        
        return null;
    }
    
    /**
     * Decide if we should trigger self-learning
     */
    private shouldTriggerLearning(missingCapability: string, errorMessages: string): boolean {
        // High priority capabilities that should trigger learning
        const highPriority = ['database_operations', 'api_integration', 'presentation_generation'];
        const hasHighPriority = highPriority.some(p => missingCapability.includes(p));
        
        // Only trigger for actionable errors (not auth/syntax errors)
        const isActionableError = !errorMessages.includes('syntax error') && 
                                  !errorMessages.includes('authentication');
        
        return hasHighPriority && isActionableError;
    }
    
    /**
     * Extract knowledge from failed session
     */
    private extractFailureKnowledge(session: TaskSession, errorMessages: string): any {
        const failedToolCalls = session.toolCalls.filter(tc => !tc.success);
        
        return {
            id: `failed-${session.taskId}`,
            type: 'failure_knowledge',
            title: `Failed: ${this.generateTitle(session)}`,
            summary: `Task failed: ${session.userQuery}. Errors: ${errorMessages}`,
            steps: session.toolCalls.map((tc, i) => 
                `${i + 1}. ${tc.success ? '✓' : '✗'} Call ${tc.toolName}`
            ),
            codeTemplate: '',
            dependencies: [],
            prerequisites: [],
            detailedContent: `## Failure Analysis\n\n**Original Query:** ${session.userQuery}\n\n**Errors:**\n${errorMessages}\n\n**Failed Steps:**\n${failedToolCalls.map(tc => `- ${tc.toolName}: ${JSON.stringify(tc.args)}`).join('\n')}\n\n**What to learn:** ${this.extractMissingCapability(session, errorMessages) || 'Unknown'}`,
            confidence: 0.9,
            sourceResearch: {
                gap: {
                    type: 'capability_gap',
                    description: `Failed to complete: ${session.userQuery}`,
                    keywords: [this.extractMissingCapability(session, errorMessages) || 'unknown'],
                    suggestedResearchQueries: [this.extractMissingCapability(session, errorMessages) || session.userQuery],
                    confidence: 0.8,
                },
                sources: [{
                    url: 'internal://failed-execution',
                    title: 'Failed Task Execution',
                    type: 'execution_log',
                    extractedInfo: errorMessages,
                    reliability: 1.0,
                }],
            },
        };
    }

    /**
     * Analyze session and decide if it's worth learning from
     */
    private async analyzeAndLearn(session: TaskSession): Promise<void> {
        const decision = this.decideIfWorthLearning(session);

        if (!decision.shouldLearn) {
            console.log(`[PostLearning] Skipping session ${session.taskId}: ${decision.reason}`);
            return;
        }

        console.log(`[PostLearning] ✅ Learning from successful session: ${session.userQuery}`);
        console.log(`[PostLearning] Reason: ${decision.reason}`);
        console.log(`[PostLearning] Type: ${decision.suggestedType}, Confidence: ${decision.confidence}`);

        try {
            // Extract knowledge from successful session
            const knowledge = await this.extractKnowledge(session, decision);

            // Precipitate as knowledge/procedure/skill
            const result = await this.precipitator.precipitate(knowledge, {
                success: true,
                testResults: [{
                    testCase: { id: 'post-exec', name: 'actual_execution', input: '', expectedBehavior: 'Task completed successfully' },
                    passed: true,
                    output: 'Task completed successfully',
                    executionTimeMs: 0,
                }],
                installedDependencies: [],
                finalWorkingCode: this.generateCodeFromSession(session),
                discoveredIssues: [],
                refinements: [],
                executionTimeMs: 0,
                retryCount: 0,
            });

            if (result.success) {
                console.log(`[PostLearning] ✅ Precipitated as ${result.type}: ${result.path}`);

                // Update confidence tracker
                this.confidenceTracker.recordUsage(session.taskId, true, 'post-learning', 'Task completed successfully');
            } else {
                console.error(`[PostLearning] ❌ Failed to precipitate: ${result.error}`);
            }
        } catch (error) {
            console.error('[PostLearning] Error during learning:', error);
        }
    }

    /**
     * Decide if this session is worth learning from
     */
    private decideIfWorthLearning(session: TaskSession): LearningDecision {
        // Failed tasks are not worth learning from
        if (session.status !== 'finished') {
            return {
                shouldLearn: false,
                reason: 'Task failed',
                suggestedType: 'knowledge',
                confidence: 0,
            };
        }

        // Too short - likely not interesting
        if (session.duration < this.config.minDurationForLearning) {
            return {
                shouldLearn: false,
                reason: `Task too short (${session.duration}ms)`,
                suggestedType: 'knowledge',
                confidence: 0,
            };
        }

        // Not enough tool calls - too simple
        const successfulToolCalls = session.toolCalls.filter(tc => tc.success);
        if (successfulToolCalls.length < this.config.minToolCallsForSkill) {
            return {
                shouldLearn: false,
                reason: `Too few tool calls (${successfulToolCalls.length})`,
                suggestedType: 'knowledge',
                confidence: 0,
            };
        }

        // Check if query contains value keywords
        const queryLower = session.userQuery.toLowerCase();
        const hasValueKeyword = this.config.valueKeywords.some(kw => queryLower.includes(kw));

        if (!hasValueKeyword) {
            return {
                shouldLearn: false,
                reason: 'No high-value keywords in query',
                suggestedType: 'knowledge',
                confidence: 0,
            };
        }

        // Multiple tool calls + value keyword = skill
        if (successfulToolCalls.length >= 5) {
            return {
                shouldLearn: true,
                reason: `Complex workflow with ${successfulToolCalls.length} tool calls`,
                suggestedType: 'skill',
                confidence: 0.85,
            };
        }

        // Moderate complexity = procedure
        return {
            shouldLearn: true,
            reason: `Valuable task with ${successfulToolCalls.length} steps`,
            suggestedType: 'procedure',
            confidence: 0.7,
        };
    }

    /**
     * Extract knowledge from successful session
     */
    private async extractKnowledge(session: TaskSession, decision: LearningDecision): Promise<any> {
        // Extract steps from tool calls
        const steps = session.toolCalls
            .filter(tc => tc.success)
            .map((tc, i) => `${i + 1}. Call ${tc.toolName} with ${JSON.stringify(tc.args)}`);

        // Generate title and summary
        const title = this.generateTitle(session);
        const summary = `Successfully executed task: ${session.userQuery}. Completed in ${session.duration}ms with ${session.toolCalls.length} tool calls.`;

        return {
            id: `learned-${session.taskId}`,
            type: decision.suggestedType === 'skill' ? 'procedure' : 'concept',
            title,
            summary,
            steps,
            codeTemplate: this.generateCodeFromSession(session),
            dependencies: this.extractDependencies(session),
            prerequisites: [],
            detailedContent: this.generateDetailedContent(session),
            confidence: decision.confidence,
            sourceResearch: {
                gap: {
                    type: 'domain_knowledge',
                    description: `Learned from successful execution: ${session.userQuery}`,
                    keywords: this.extractKeywords(session.userQuery),
                    suggestedResearchQueries: [],
                    confidence: decision.confidence,
                },
                sources: [{
                    url: 'internal://successful-execution',
                    title: 'Successful Task Execution',
                    type: 'execution_log',
                    extractedInfo: summary,
                    reliability: 1.0,
                }],
            },
        };
    }

    /**
     * Generate title from session
     */
    private generateTitle(session: TaskSession): string {
        // Extract first 5 words from query
        const words = session.userQuery.split(/\s+/).slice(0, 5);
        return words.join(' ');
    }

    /**
     * Generate code template from tool calls
     */
    private generateCodeFromSession(session: TaskSession): string {
        const lines: string[] = [];
        lines.push('// Auto-generated from successful execution');
        lines.push('');

        for (const call of session.toolCalls) {
            if (!call.success) continue;
            lines.push(`await ${call.toolName}(${JSON.stringify(call.args, null, 2)});`);
        }

        return lines.join('\n');
    }

    /**
     * Extract dependencies from tool calls
     */
    private extractDependencies(session: TaskSession): string[] {
        const deps = new Set<string>();

        for (const call of session.toolCalls) {
            // Extract package names from tool calls
            if (call.toolName.includes('install') || call.toolName.includes('npm')) {
                const pkg = call.args?.package || call.args?.name;
                if (pkg) deps.add(pkg);
            }
        }

        return Array.from(deps);
    }

    /**
     * Extract keywords from user query
     */
    private extractKeywords(query: string): string[] {
        // Simple keyword extraction - split and filter
        return query
            .toLowerCase()
            .split(/\s+/)
            .filter(w => w.length > 3)
            .slice(0, 5);
    }

    /**
     * Generate detailed content
     */
    private generateDetailedContent(session: TaskSession): string {
        const lines: string[] = [];
        lines.push(`## Successful Execution: ${session.userQuery}`);
        lines.push('');
        lines.push(`**Duration**: ${session.duration}ms`);
        lines.push(`**Tool Calls**: ${session.toolCalls.length}`);
        lines.push('');
        lines.push('### Steps Executed');
        lines.push('');

        for (let i = 0; i < session.toolCalls.length; i++) {
            const call = session.toolCalls[i];
            const status = call.success ? '✅' : '❌';
            lines.push(`${i + 1}. ${status} \`${call.toolName}\``);
            lines.push(`   Args: \`\`\`json\n   ${JSON.stringify(call.args, null, 2)}\n   \`\`\``);
            if (call.result) {
                lines.push(`   Result: ${typeof call.result === 'string' ? call.result : JSON.stringify(call.result)}`);
            }
            lines.push('');
        }

        return lines.join('\n');
    }
}

/**
 * Factory function
 */
export function createPostExecutionLearningManager(
    precipitator: Precipitator,
    confidenceTracker: ConfidenceTracker,
    config?: Partial<PostExecutionLearningConfig>,
    selfLearningController?: SelfLearningController
): PostExecutionLearningManager {
    return new PostExecutionLearningManager(precipitator, confidenceTracker, config, selfLearningController);
}
