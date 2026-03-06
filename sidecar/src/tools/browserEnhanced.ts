/**
 * Enhanced Browser Tools with Adaptive Execution and Suspend/Resume
 *
 * Wraps browser tools with:
 * - Adaptive retry loop (DETECT→PLAN→EXECUTE→FEEDBACK)
 * - Task suspension/resumption for user actions (e.g., login)
 * - Alternative strategy generation on errors
 * - Auto-fallback from precise to smart mode (browser_ai_action suggestion)
 */

import { ToolDefinition } from './standard';
import { BROWSER_TOOLS } from './builtin';
import type { AdaptiveExecutor } from '../agent/adaptiveExecutor';
import type { SuspendResumeManager } from '../agent/suspendResumeManager';
import { ResumeConditions } from '../agent/suspendResumeManager';
import { browserService } from '../services/browserService';

/**
 * Enhanced browser tools factory
 * Wraps browser tools with adaptive execution and suspend/resume capabilities
 */
export function createEnhancedBrowserTools(
    adaptiveExecutor: AdaptiveExecutor,
    suspendResumeManager: SuspendResumeManager,
    taskIdGetter: () => string | undefined
): ToolDefinition[] {
    const isXDomain = (urlOrHost: string): boolean => {
        const lower = (urlOrHost || '').toLowerCase();
        return lower.includes('x.com') || lower.includes('twitter.com');
    };

    const isLoginSensitiveDomain = (urlOrHost: string): boolean => {
        const lower = (urlOrHost || '').toLowerCase();
        return [
            'x.com', 'twitter.com', 'facebook.com', 'instagram.com',
            'linkedin.com', 'github.com', 'reddit.com',
        ].some((d) => lower.includes(d));
    };

    const detectXLoginState = async (): Promise<{ needsLogin: boolean; loggedIn: boolean }> => {
        try {
            const state = await browserService.executeScript<{
                hasPrimaryHome: boolean;
                hasComposer: boolean;
                hasAuthInputs: boolean;
                hasLoginCta: boolean;
                hasLoginFlowPath: boolean;
            }>(`(() => {
                const hasPrimaryHome = !!document.querySelector('[data-testid="primaryColumn"], [data-testid="AppTabBar_Home_Link"]');
                const hasComposer = !!document.querySelector('[data-testid="SideNav_NewTweet_Button"], [data-testid="tweetTextarea_0"]');
                const hasAuthInputs = !!document.querySelector('input[name="text"], input[autocomplete="username"], input[name="session[username_or_email]"], input[type="password"]');
                const hasLoginCta = Array.from(document.querySelectorAll('a,button')).some((el) => {
                    const t = (el.textContent || '').trim();
                    return /^(log\s*in|sign\s*in|登录)$/i.test(t);
                });
                const p = (location.pathname || '').toLowerCase();
                const hasLoginFlowPath = p.includes('/i/flow/login') || p.includes('/login') || p.includes('/signin');
                return { hasPrimaryHome, hasComposer, hasAuthInputs, hasLoginCta, hasLoginFlowPath };
            })()`);

            const loggedIn = !!(state.hasPrimaryHome || state.hasComposer);
            const needsLogin = !loggedIn && !!(state.hasAuthInputs || state.hasLoginCta || state.hasLoginFlowPath);
            return { needsLogin, loggedIn };
        } catch {
            return { needsLogin: false, loggedIn: false };
        }
    };

    // Get original browser tools
    const originalTools = BROWSER_TOOLS;

    // Create enhanced versions
    const enhancedTools: ToolDefinition[] = [];

    for (const tool of originalTools) {
        // Enhance interaction tools (click, fill, wait, upload) with adaptive execution
        if (['browser_click', 'browser_fill', 'browser_wait', 'browser_upload_file'].includes(tool.name)) {
            enhancedTools.push({
                ...tool,
                handler: async (args: any) => {
                    // Wrap in adaptive executor for retry with alternatives
                    const result = await adaptiveExecutor.executeWithRetry(
                        {
                            id: `${tool.name}-${Date.now()}`,
                            description: `Execute ${tool.name} with adaptive retry`,
                            toolName: tool.name,
                            args,
                        },
                        async (toolName, retryArgs) => {
                            // Call original handler
                            return await tool.handler(retryArgs, undefined as any);
                        }
                    );

                    if (result.success) {
                        return result.output;
                    } else {
                        // If precise mode fails, suggest using browser_ai_action
                        const smartAvailable = await browserService.isBrowserUseAvailable();
                        return {
                            success: false,
                            error: result.error,
                            shouldRetry: result.shouldRetry,
                            ...(smartAvailable ? {
                                suggestion: `If the CSS selector approach is not working, try using browser_ai_action with a natural language description of the action, or switch to smart mode with browser_set_mode.`,
                            } : {}),
                        };
                    }
                },
            });
        }
        // Enhance navigate with authentication detection and suspend/resume
        else if (tool.name === 'browser_navigate') {
            enhancedTools.push({
                ...tool,
                handler: async (args: any) => {
                    const taskId = taskIdGetter();

                    // Call original navigate
                    const result = await tool.handler(args, undefined as any);

                    // Check if authentication is required
                    if (result.success && taskId) {
                        try {
                            // Guardrail: if this is a login-sensitive site and we're on
                            // persistent_profile mode, require explicit user confirmation.
                            const connInfo = browserService.getConnectionInfo();
                            if (
                                isLoginSensitiveDomain(args.url || '') &&
                                connInfo.mode === 'persistent_profile'
                            ) {
                                await suspendResumeManager.suspend(
                                    taskId,
                                    'user_profile_recommended',
                                    '当前连接为 persistent_profile（非系统Chrome登录态）。若需要复用你已登录账号，请先启动 Chrome 9222 并重新 browser_connect(require_user_profile=true)。若继续使用当前自动化窗口登录，请回复“继续”。',
                                    ResumeConditions.manual(),
                                    {
                                        domain: args.url,
                                        connectionMode: connInfo.mode,
                                    }
                                );

                                return {
                                    ...result,
                                    suspended: true,
                                    reason: 'waiting_for_user_profile_confirmation',
                                    message: 'Task suspended: login-sensitive site detected under persistent_profile. Awaiting user confirmation.',
                                };
                            }

                            // Check for login indicators using page content
                            // This works with both CDP-connected pages and Bridge proxy pages
                            const contentResult = await browserService.getContent(true);
                            const pageText = contentResult.content || '';
                            const currentUrl = contentResult.url || args.url || '';

                            // Detect login page by content keywords and URL patterns
                            const loginKeywords = ['登录', '登 录', 'Sign in', 'Log in', 'Login', '验证码'];
                            const loginUrlPatterns = ['/login', '/signin', '/auth'];
                            const loggedInKeywords = ['退出', '注销', 'Logout', 'Sign out', '我的主页', '创作中心', '发布笔记'];

                            const hasLoginKeyword = loginKeywords.some(kw => pageText.includes(kw));
                            const hasLoginUrl = loginUrlPatterns.some(pat => currentUrl.toLowerCase().includes(pat));
                            const hasLoggedInKeyword = loggedInKeywords.some(kw => pageText.includes(kw));

                            // Domain-specific hardening for X/Twitter: use DOM state first, then fallback.
                            let needsLogin = (hasLoginKeyword || hasLoginUrl) && !hasLoggedInKeyword;
                            if (isXDomain(currentUrl || args.url || '')) {
                                const xState = await detectXLoginState();
                                if (xState.loggedIn) {
                                    needsLogin = false;
                                } else if (xState.needsLogin) {
                                    needsLogin = true;
                                }
                            }

                            if (needsLogin) {
                                // Suspend task and wait for user to login
                                const url = args.url || '';
                                let domain = 'unknown';
                                try { domain = new URL(url).hostname; } catch { /* ignore */ }

                                console.log(`[BrowserEnhanced] Login detected on ${domain}, suspending task ${taskId}`);
                                console.log(`[BrowserEnhanced] Login keywords found: ${loginKeywords.filter(kw => pageText.includes(kw)).join(', ')}`);
                                console.log(`[BrowserEnhanced] URL pattern match: ${hasLoginUrl}`);

                                await suspendResumeManager.suspend(
                                    taskId,
                                    'authentication_required',
                                    `Please login to ${domain} in the browser window. The task will resume automatically once you're logged in.`,
                                    ResumeConditions.browserPageCheck(
                                        async () => {
                                            // Check if user has logged in by looking at page content
                                            try {
                                                const checkContent = await browserService.getContent(true);
                                                const checkText = checkContent.content || '';
                                                const checkUrl = checkContent.url || '';

                                                if (isXDomain(checkUrl || args.url || '')) {
                                                    const xState = await detectXLoginState();
                                                    // For X/Twitter, avoid generic fallback heuristics that can
                                                    // produce false positives during redirects/hydration.
                                                    // Only resume when explicit logged-in signals are present.
                                                    return xState.loggedIn;
                                                }

                                                // Generic fallback for other websites
                                                const stillHasLogin = loginKeywords.some(kw => checkText.includes(kw));
                                                const nowLoggedIn = loggedInKeywords.some(kw => checkText.includes(kw));
                                                const urlChanged = !loginUrlPatterns.some(pat => checkUrl.toLowerCase().includes(pat));
                                                // Avoid false-positive auto-resume on transient redirects/hydration.
                                                // Require either explicit logged-in signal, or both URL transition and
                                                // meaningful non-login content.
                                                const hasMeaningfulContent = (checkText || '').trim().length > 200;
                                                return nowLoggedIn || (!stillHasLogin && urlChanged && hasMeaningfulContent);
                                            } catch {
                                                return false;
                                            }
                                        },
                                        5000, // Check every 5 seconds
                                        5 * 60 * 1000 // Max wait 5 minutes
                                    ),
                                    { navigatedUrl: args.url }
                                );

                                return {
                                    ...result,
                                    suspended: true,
                                    reason: 'waiting_for_login',
                                    message: `Task suspended. Please login to ${domain} in the browser. The task will resume automatically.`,
                                };
                            }
                        } catch (error) {
                            console.error('[BrowserEnhanced] Error checking authentication:', error);
                        }
                    }

                    return result;
                },
            });
        }
        // browser_ai_action: wrap with adaptive retry but no precise fallback
        else if (tool.name === 'browser_ai_action') {
            enhancedTools.push({
                ...tool,
                handler: async (args: any) => {
                    const result = await adaptiveExecutor.executeWithRetry(
                        {
                            id: `browser_ai_action-${Date.now()}`,
                            description: 'Execute AI-driven browser action with adaptive retry',
                            toolName: tool.name,
                            args,
                        },
                        async (toolName, retryArgs) => {
                            return await tool.handler(retryArgs, undefined as any);
                        }
                    );

                    if (result.success) {
                        return result.output;
                    } else {
                        return {
                            success: false,
                            error: result.error,
                            shouldRetry: result.shouldRetry,
                        };
                    }
                },
            });
        }
        // Keep other tools (browser_set_mode, browser_execute_script, etc.) unchanged
        else {
            enhancedTools.push(tool);
        }
    }

    return enhancedTools;
}

/**
 * Check if a task is suspended
 */
export function isTaskSuspended(taskId: string, suspendResumeManager: SuspendResumeManager): boolean {
    return suspendResumeManager.isSuspended(taskId);
}

/**
 * Manually resume a suspended task
 */
export async function resumeTask(taskId: string, suspendResumeManager: SuspendResumeManager): Promise<boolean> {
    const result = await suspendResumeManager.resume(taskId, 'Manual resume');
    return result.success;
}
