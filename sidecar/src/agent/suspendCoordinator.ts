/**
 * Suspend Coordinator
 *
 * Coordinates task suspension/resumption based on intent detection and execution results.
 * Works with IntentDetector and SuspendResumeManager to provide universal suspend/resume capabilities.
 */

import { IntentDetector, TaskIntent } from './intentDetector';
import { SuspendResumeManager, ResumeCondition, ResumeConditions } from './suspendResumeManager';
import { browserService } from '../services/browserService';

export interface SuspendDecision {
    shouldSuspend: boolean;
    reason?: string;
    userMessage?: string;
    resumeCondition?: ResumeCondition;
    context?: any;
}

export class SuspendCoordinator {
    constructor(
        private suspendResumeManager: SuspendResumeManager,
        private intentDetector: IntentDetector
    ) {}

    /**
     * Check if suspension is needed before executing a tool
     * (Pre-execution check)
     */
    async checkPreExecutionSuspend(
        taskId: string,
        thought: string,
        action: { tool: string; args: any }
    ): Promise<SuspendDecision> {
        const intent = this.intentDetector.detectIntent(thought, action);

        // Scenario 1: Interactive command (ssh, mysql, etc.)
        if (intent.type === 'command_execution' && intent.requiresUserInput) {
            return this.createInteractiveCommandSuspension(action.args);
        }

        // Scenario 2: External application launch (code, vim, etc.)
        if (intent.type === 'command_execution' && intent.requiresExternalApp) {
            return this.createExternalAppSuspension(action.args);
        }

        // Scenario 3: sudo command (requires password)
        if (intent.type === 'command_execution' && intent.requiresAuthentication) {
            return this.createSudoCommandSuspension(action.args);
        }

        // Most scenarios are checked post-execution
        return { shouldSuspend: false };
    }

    /**
     * Check if suspension is needed after executing a tool
     * (Post-execution check)
     */
    async checkPostExecutionSuspend(
        taskId: string,
        action: { tool: string; args: any },
        result: any
    ): Promise<SuspendDecision> {
        // Scenario: Browser navigation detected login requirement
        if (action.tool === 'browser_navigate') {
            return await this.checkBrowserAuthSuspension(action.args, result);
        }

        // Scenario: API call returned 401/403
        if (action.tool === 'api_call' || action.tool === 'fetch_url') {
            return this.checkApiAuthSuspension(result);
        }

        // More scenarios can be added here

        return { shouldSuspend: false };
    }

    /**
     * Execute suspension
     */
    async suspend(taskId: string, decision: SuspendDecision): Promise<void> {
        if (!decision.shouldSuspend || !decision.resumeCondition) {
            return;
        }

        await this.suspendResumeManager.suspend(
            taskId,
            decision.reason || 'unknown',
            decision.userMessage || 'Task suspended, waiting for user action',
            decision.resumeCondition,
            decision.context
        );
    }

    /**
     * Check if a task is currently suspended
     */
    isSuspended(taskId: string): boolean {
        return this.suspendResumeManager.isSuspended(taskId);
    }

    /**
     * Manually resume a suspended task
     */
    async resume(taskId: string, reason?: string): Promise<{ success: boolean; context?: any }> {
        return await this.suspendResumeManager.resume(taskId, reason);
    }

    /**
     * Cancel a suspended task
     */
    async cancel(taskId: string, reason?: string): Promise<boolean> {
        return await this.suspendResumeManager.cancel(taskId, reason);
    }

    // ============================================================================
    // Suspension Decision Creators
    // ============================================================================

    private createInteractiveCommandSuspension(args: any): SuspendDecision {
        const command = args.command || args.script || '';

        return {
            shouldSuspend: true,
            reason: 'interactive_command',
            userMessage: `Interactive command detected: "${command}". Please interact with the terminal and press Enter when done.`,
            resumeCondition: ResumeConditions.manual(), // User must manually resume
            context: { command },
        };
    }

    private createExternalAppSuspension(args: any): SuspendDecision {
        const command = args.command || args.script || '';

        return {
            shouldSuspend: true,
            reason: 'external_application',
            userMessage: `External application launched: "${command}". Close the application to continue.`,
            resumeCondition: ResumeConditions.manual(), // User must manually resume
            context: { command },
        };
    }

    private createSudoCommandSuspension(args: any): SuspendDecision {
        const command = args.command || args.script || '';

        return {
            shouldSuspend: true,
            reason: 'sudo_password',
            userMessage: `sudo command requires password: "${command}". Enter password in terminal and press Enter when done.`,
            resumeCondition: ResumeConditions.manual(), // User must manually resume
            context: { command },
        };
    }

    private async checkBrowserAuthSuspension(
        args: any,
        result: any
    ): Promise<SuspendDecision> {
        // Only check if navigation was successful
        if (!result.success) {
            return { shouldSuspend: false };
        }

        try {
            const page = await browserService.getPage();

            // Check for common login indicators
            const loginButton = await page.$(
                'button:has-text("登录"), a:has-text("登录"), ' +
                'button:has-text("Sign in"), a:has-text("Sign in"), ' +
                'button:has-text("Log in"), a:has-text("Log in"), ' +
                'button:has-text("Login"), a:has-text("Login")'
            ).catch(() => null);

            if (loginButton) {
                const url = args.url || '';
                let domain = 'the website';
                try {
                    domain = new URL(url).hostname;
                } catch {
                    // Ignore URL parse error
                }

                return {
                    shouldSuspend: true,
                    reason: 'authentication_required',
                    userMessage: `Please login to ${domain} in the browser. The task will resume automatically once you're logged in.`,
                    resumeCondition: ResumeConditions.browserPageCheck(
                        async () => {
                            // Check if login button disappeared
                            try {
                                const page = await browserService.getPage();
                                const loginBtn = await page.$(
                                    'button:has-text("登录"), a:has-text("登录"), ' +
                                    'button:has-text("Sign in"), a:has-text("Sign in"), ' +
                                    'button:has-text("Log in"), a:has-text("Log in")'
                                ).catch(() => null);
                                return !loginBtn; // Resume if login button NOT found
                            } catch {
                                return false;
                            }
                        },
                        5000, // Check every 5 seconds
                        5 * 60 * 1000 // Max wait 5 minutes
                    ),
                    context: { navigatedUrl: args.url },
                };
            }
        } catch (error) {
            console.error('[SuspendCoordinator] Error checking browser auth:', error);
        }

        return { shouldSuspend: false };
    }

    private checkApiAuthSuspension(result: any): SuspendDecision {
        // Check if result indicates authentication failure
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        const resultLower = resultStr.toLowerCase();

        const authErrors = [
            'unauthorized',
            '401',
            '403',
            'forbidden',
            'authentication required',
            'invalid token',
            'invalid api key',
        ];

        const hasAuthError = authErrors.some(err => resultLower.includes(err));

        if (hasAuthError) {
            return {
                shouldSuspend: true,
                reason: 'api_authentication',
                userMessage: 'API authentication failed. Please provide valid credentials or API key.',
                resumeCondition: ResumeConditions.manual(), // User must provide credentials
                context: { error: resultStr },
            };
        }

        return { shouldSuspend: false };
    }
}

/**
 * Factory function
 */
export function createSuspendCoordinator(
    suspendResumeManager: SuspendResumeManager,
    intentDetector: IntentDetector
): SuspendCoordinator {
    return new SuspendCoordinator(suspendResumeManager, intentDetector);
}
