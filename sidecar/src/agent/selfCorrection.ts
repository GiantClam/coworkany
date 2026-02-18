/**
 * CoworkAny - Self-Correction Engine
 *
 * Analyzes errors from tool executions and provides suggestions for automatic correction.
 * Implements OpenClaw-style "Error Self-Correction" capability.
 */

import type { ErrorAnalysis } from '../tools/codeExecution';
import { getAlternativeCommands } from '../utils/commandAlternatives';

// ============================================================================
// Types
// ============================================================================

export type RetryStrategy =
    | 'modify_code'
    | 'install_deps'
    | 'change_params'
    | 'manual'
    | 'search_web'
    | 'diagnose_code'
    | 'browser_automation'  // Use Playwright for web interaction
    | 'refine_plan'         // Rethink the approach
    | 'try_alternative_command';  // NEW: Try alternative command (e.g., python3 -> python)

export interface RetryPlan {
    shouldRetry: boolean;
    maxRetries: number;
    currentRetry: number;
    strategy: RetryStrategy;
    modifications: {
        code?: string;
        dependencies?: string[];
        params?: Record<string, unknown>;
        env?: Record<string, string>;
    };
    reason: string;
    /** For browser_automation strategy */
    browserAction?: {
        url?: string;
        action: 'screenshot' | 'interact' | 'scrape' | 'wait_for_spa' | 'use_precise_mode' | 'find_alternative_selector';
        selectors?: string[];
        searchQuery?: string;
    };
    /** For refine_plan strategy */
    refinementHints?: string[];
    /** For try_alternative_command strategy */
    alternativeCommands?: string[];
}

export interface ErrorPattern {
    pattern: RegExp;
    errorType: ErrorAnalysis['errorType'];
    extract?: (match: RegExpMatchArray, stderr: string) => Partial<ErrorAnalysis>;
    confidence: number;
    canAutoRetry: boolean;
}

export interface CorrectionContext {
    toolName: string;
    toolArgs: Record<string, unknown>;
    stderr: string;
    stdout?: string;
    exitCode: number;
    retryCount: number;
    maxRetries: number;
}

export interface CorrectionResult {
    analysis: ErrorAnalysis;
    retryPlan: RetryPlan;
    formattedHint: string;
}

// ============================================================================
// Error Patterns
// ============================================================================

const PYTHON_ERROR_PATTERNS: ErrorPattern[] = [
    // ModuleNotFoundError
    {
        pattern: /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/,
        errorType: 'missing_module',
        confidence: 0.95,
        canAutoRetry: true,
        extract: (match) => {
            const moduleName = match[1].split('.')[0];
            const MODULE_TO_PACKAGE: Record<string, string> = {
                cv2: 'opencv-python',
                PIL: 'Pillow',
                sklearn: 'scikit-learn',
                yaml: 'pyyaml',
                bs4: 'beautifulsoup4',
                dotenv: 'python-dotenv',
                dateutil: 'python-dateutil',
            };
            const packageName = MODULE_TO_PACKAGE[moduleName] || moduleName;
            return {
                suggestedFix: `Install the missing package: pip install ${packageName}`,
                retryStrategy: {
                    additionalDeps: [packageName],
                },
            };
        },
    },

    // ImportError
    {
        pattern: /ImportError: cannot import name ['"]([^'"]+)['"] from ['"]([^'"]+)['"]/,
        errorType: 'missing_module',
        confidence: 0.7,
        canAutoRetry: false,
        extract: (match) => ({
            suggestedFix: `Cannot import '${match[1]}' from '${match[2]}'. Check if the module version is compatible.`,
        }),
    },

    // SyntaxError
    {
        pattern: /SyntaxError: (.+?)(?:\s*\(.+line (\d+)\))?/,
        errorType: 'python_syntax',
        confidence: 0.9,
        canAutoRetry: false,
        extract: (match) => ({
            suggestedFix: match[2]
                ? `Syntax error on line ${match[2]}: ${match[1]}`
                : `Syntax error: ${match[1]}`,
        }),
    },

    // IndentationError
    {
        pattern: /IndentationError: (.+)/,
        errorType: 'python_syntax',
        confidence: 0.9,
        canAutoRetry: false,
        extract: (match) => ({
            suggestedFix: `Indentation error: ${match[1]}. Check spacing consistency (use 4 spaces).`,
        }),
    },

    // NameError
    {
        pattern: /NameError: name ['"]([^'"]+)['"] is not defined/,
        errorType: 'python_runtime',
        confidence: 0.85,
        canAutoRetry: false,
        extract: (match) => ({
            suggestedFix: `Variable '${match[1]}' is not defined. Define it before use or check for typos.`,
        }),
    },

    // TypeError
    {
        pattern: /TypeError: (.+)/,
        errorType: 'python_runtime',
        confidence: 0.75,
        canAutoRetry: false,
        extract: (match) => ({
            suggestedFix: `Type error: ${match[1]}. Check data types and function arguments.`,
        }),
    },

    // ValueError
    {
        pattern: /ValueError: (.+)/,
        errorType: 'python_runtime',
        confidence: 0.75,
        canAutoRetry: false,
        extract: (match) => ({
            suggestedFix: `Value error: ${match[1]}. Check input values and formats.`,
        }),
    },

    // FileNotFoundError
    {
        pattern: /FileNotFoundError: \[Errno 2\] No such file or directory: ['"]([^'"]+)['"]/,
        errorType: 'file_not_found',
        confidence: 0.95,
        canAutoRetry: false,
        extract: (match) => ({
            suggestedFix: `File not found: '${match[1]}'. Check if the file path is correct and the file exists.`,
        }),
    },

    // PermissionError
    {
        pattern: /PermissionError: \[Errno \d+\] (.+): ['"]([^'"]+)['"]/,
        errorType: 'permission_denied',
        confidence: 0.9,
        canAutoRetry: false,
        extract: (match) => ({
            suggestedFix: `Permission denied for '${match[2]}': ${match[1]}`,
        }),
    },

    // KeyError
    {
        pattern: /KeyError: ['"]?([^'"]+)['"]?/,
        errorType: 'python_runtime',
        confidence: 0.8,
        canAutoRetry: false,
        extract: (match) => ({
            suggestedFix: `Key '${match[1]}' not found in dictionary. Check available keys or use .get() method.`,
        }),
    },

    // AttributeError
    {
        pattern: /AttributeError: ['"]?([^'"]+)['"]? object has no attribute ['"]([^'"]+)['"]/,
        errorType: 'python_runtime',
        confidence: 0.8,
        canAutoRetry: false,
        extract: (match) => ({
            suggestedFix: `'${match[1]}' object has no attribute '${match[2]}'. Check the object type and available methods.`,
        }),
    },

    // JSONDecodeError
    {
        pattern: /JSONDecodeError: (.+)/,
        errorType: 'python_runtime',
        confidence: 0.85,
        canAutoRetry: false,
        extract: (match) => ({
            suggestedFix: `JSON parsing error: ${match[1]}. Check if the input is valid JSON.`,
        }),
    },
];

const SHELL_ERROR_PATTERNS: ErrorPattern[] = [
    // Command not found (Unix)
    {
        pattern: /(.+): command not found/,
        errorType: 'missing_command',
        confidence: 0.95,
        canAutoRetry: true,  // Changed to true - we can try alternatives
        extract: (match) => {
            const cmd = match[1];
            const alternatives = getAlternativeCommands(cmd);
            return {
                suggestedFix: alternatives.length > 0
                    ? `Command '${cmd}' not found. Try alternatives: ${alternatives.join(', ')}`
                    : `Command '${cmd}' not found. Install it or check if it's in PATH.`,
                retryStrategy: alternatives.length > 0 ? { alternativeCommands: alternatives } : undefined,
            };
        },
    },

    // Command not found (Windows) - "is not recognized"
    {
        pattern: /['"]?(.+?)['"]? is not recognized as an internal or external command/,
        errorType: 'missing_command',
        confidence: 0.95,
        canAutoRetry: true,  // Changed to true
        extract: (match) => {
            const cmd = match[1];
            const alternatives = getAlternativeCommands(cmd);
            return {
                suggestedFix: alternatives.length > 0
                    ? `Command '${cmd}' not recognized. Try alternatives: ${alternatives.join(', ')}`
                    : `Command '${cmd}' not recognized. Install it or check system PATH.`,
                retryStrategy: alternatives.length > 0 ? { alternativeCommands: alternatives } : undefined,
            };
        },
    },

    // Windows exit code 9009 - command not found (often no stderr message)
    {
        pattern: /exit.code.*9009|9009.*exit|command.*failed.*9009/i,
        errorType: 'missing_command',
        confidence: 0.9,
        canAutoRetry: true,
        extract: () => ({
            suggestedFix: 'Windows error 9009: Command not found. The command may not be installed or not in PATH.',
        }),
    },

    // Permission denied (Unix)
    {
        pattern: /Permission denied/i,
        errorType: 'permission_denied',
        confidence: 0.9,
        canAutoRetry: false,
        extract: () => ({
            suggestedFix: 'Permission denied. Check file permissions or run with appropriate privileges.',
        }),
    },

    // File not found
    {
        pattern: /No such file or directory/i,
        errorType: 'file_not_found',
        confidence: 0.85,
        canAutoRetry: false,
        extract: () => ({
            suggestedFix: 'File or directory not found. Check the path and try again.',
        }),
    },
];

const WEB_SEARCH_ERROR_PATTERNS: ErrorPattern[] = [
    // Search returned no useful results
    {
        pattern: /no (?:relevant |useful )?results?(?: found)?|0 results|empty response/i,
        errorType: 'web_search_failed',
        confidence: 0.85,
        canAutoRetry: true,
        extract: () => ({
            suggestedFix: 'Web search returned no useful results. Try browser automation to interact with the page directly.',
        }),
    },

    // Rate limited
    {
        pattern: /rate limit|too many requests|429/i,
        errorType: 'web_search_failed',
        confidence: 0.9,
        canAutoRetry: true,
        extract: () => ({
            suggestedFix: 'Rate limited. Wait and retry, or use browser automation as fallback.',
        }),
    },

    // Generic search failure
    {
        pattern: /search failed|unable to search|search error/i,
        errorType: 'web_search_failed',
        confidence: 0.8,
        canAutoRetry: true,
        extract: () => ({
            suggestedFix: 'Search tool failed. Use browser automation (Playwright) to access the web directly.',
        }),
    },

    // Content blocked or requires interaction
    {
        pattern: /captcha|blocked|forbidden|access denied|login required|paywall/i,
        errorType: 'web_interaction_required',
        confidence: 0.9,
        canAutoRetry: true,
        extract: () => ({
            suggestedFix: 'Page requires interaction or is blocked. Use browser automation to handle dynamic content.',
        }),
    },

    // JavaScript-rendered content
    {
        pattern: /javascript|dynamic content|spa|single.page|react|angular|vue/i,
        errorType: 'web_interaction_required',
        confidence: 0.7,
        canAutoRetry: true,
        extract: () => ({
            suggestedFix: 'Content may be JavaScript-rendered. Use browser automation with networkidle wait.',
        }),
    },
];

const BROWSER_SPA_ERROR_PATTERNS: ErrorPattern[] = [
    // JavaScript not available (SPA didn't render)
    {
        pattern: /JavaScript is not available|JavaScript.*not available|enable javascript/i,
        errorType: 'browser_spa_not_rendered',
        confidence: 0.95,
        canAutoRetry: true,
        extract: () => ({
            suggestedFix: 'SPA page did not render. The page requires JavaScript/SPA hydration. ' +
                'SOLUTION: 1) Use browser_navigate with wait_until="networkidle" to wait for full page load. ' +
                '2) Wait 5-10 seconds after navigation for React/Vue/Angular to hydrate. ' +
                '3) For X/Twitter, navigate directly to https://x.com/compose/post. ' +
                '4) Use search_web to find automation best practices for this specific site.',
        }),
    },

    // Noscript content showing
    {
        pattern: /noscript|<noscript/i,
        errorType: 'browser_spa_not_rendered',
        confidence: 0.8,
        canAutoRetry: true,
        extract: () => ({
            suggestedFix: 'Page is showing noscript content - SPA framework has not rendered. ' +
                'Wait for networkidle or check if JavaScript is enabled in the browser context.',
        }),
    },

    // Smart mode not available
    {
        pattern: /smart.?mode.*(?:not available|unavailable)|browser-use-service.*not running/i,
        errorType: 'browser_smart_mode_unavailable',
        confidence: 0.95,
        canAutoRetry: false,
        extract: () => ({
            suggestedFix: 'Smart mode (AI vision) is NOT available. STOP trying browser_set_mode("smart"). ' +
                'Instead: 1) Use browser_execute_script to interact via JavaScript. ' +
                '2) Use browser_click with CSS selectors. ' +
                '3) Use search_web to find automation approaches for this site. ' +
                '4) Use browser_get_content to inspect the page structure.',
        }),
    },

    // Empty page / page not loaded
    {
        pattern: /body.?(?:length|len|size).*(?:0|empty)|page.*(?:empty|blank|not loaded)/i,
        errorType: 'browser_spa_not_rendered',
        confidence: 0.7,
        canAutoRetry: true,
        extract: () => ({
            suggestedFix: 'Page appears empty. SPA content has not loaded. ' +
                'Try: browser_navigate with wait_until="networkidle", then wait 5s for hydration.',
        }),
    },

    // Element not found in SPA
    {
        pattern: /(?:no )?element.*(?:not found|not visible|could not find)|selector.*(?:not found|no match)/i,
        errorType: 'browser_element_not_found',
        confidence: 0.8,
        canAutoRetry: true,
        extract: () => ({
            suggestedFix: 'Element not found. This may be because the SPA has not fully rendered. ' +
                '1) Wait for the page to fully load (networkidle). ' +
                '2) Use browser_get_content to inspect the actual DOM. ' +
                '3) Try different selectors. ' +
                '4) Use search_web to find the correct selectors for this website.',
        }),
    },
];

const NETWORK_ERROR_PATTERNS: ErrorPattern[] = [
    // Connection refused
    {
        pattern: /Connection refused/i,
        errorType: 'network',
        confidence: 0.9,
        canAutoRetry: true,
        extract: () => ({
            suggestedFix: 'Connection refused. Check if the server is running and the port is correct.',
        }),
    },

    // Network unreachable
    {
        pattern: /Network (?:is )?unreachable/i,
        errorType: 'network',
        confidence: 0.9,
        canAutoRetry: true,
        extract: () => ({
            suggestedFix: 'Network unreachable. Check your internet connection.',
        }),
    },

    // DNS resolution failed
    {
        pattern: /(?:Name|DNS|nodename) (?:resolution|lookup|nor servname provided)/i,
        errorType: 'network',
        confidence: 0.85,
        canAutoRetry: true,
        extract: () => ({
            suggestedFix: 'DNS resolution failed. Check the hostname and network connection.',
        }),
    },

    // Timeout
    {
        pattern: /(?:timed? ?out|timeout)/i,
        errorType: 'timeout',
        confidence: 0.9,
        canAutoRetry: true,
        extract: () => ({
            suggestedFix: 'Operation timed out. Try increasing the timeout or check network connectivity.',
        }),
    },

    // SSL/TLS errors
    {
        pattern: /SSL(?:Error)?|certificate verify failed/i,
        errorType: 'network',
        confidence: 0.8,
        canAutoRetry: false,
        extract: () => ({
            suggestedFix: 'SSL/TLS error. Check certificate validity or try with verify=False (not recommended for production).',
        }),
    },
];

// ============================================================================
// Self-Correction Engine
// ============================================================================

export class SelfCorrectionEngine {
    private maxRetries: number;

    constructor(maxRetries: number = 3) {
        this.maxRetries = maxRetries;
    }

    /**
     * Analyze an error and provide correction suggestions
     */
    analyzeError(
        stderr: string,
        toolArgs: Record<string, unknown>,
        toolName: string
    ): ErrorAnalysis {
        // Determine language based on tool name
        const isPython = toolName.toLowerCase().includes('python');
        const isShell =
            toolName.toLowerCase().includes('command') ||
            toolName.toLowerCase().includes('shell');
        const isWebSearch =
            toolName.toLowerCase().includes('search') ||
            toolName.toLowerCase().includes('web') ||
            toolName.toLowerCase().includes('fetch');
        const isBrowser =
            toolName.toLowerCase().includes('browser') ||
            toolName.toLowerCase().includes('playwright');

        // Collect all patterns to check
        const patterns: ErrorPattern[] = [
            ...NETWORK_ERROR_PATTERNS,
            ...(isBrowser ? BROWSER_SPA_ERROR_PATTERNS : []),
            ...(isWebSearch ? WEB_SEARCH_ERROR_PATTERNS : []),
            ...(isPython ? PYTHON_ERROR_PATTERNS : []),
            ...(isShell || !isPython ? SHELL_ERROR_PATTERNS : []),
        ];

        // Find matching pattern
        for (const errorPattern of patterns) {
            const match = stderr.match(errorPattern.pattern);
            if (match) {
                const extracted = errorPattern.extract
                    ? errorPattern.extract(match, stderr)
                    : {};

                return {
                    errorType: errorPattern.errorType,
                    originalError: stderr,
                    suggestedFix:
                        extracted.suggestedFix ||
                        `Error detected: ${errorPattern.errorType}`,
                    confidence: errorPattern.confidence,
                    canAutoRetry: errorPattern.canAutoRetry,
                    retryStrategy: extracted.retryStrategy,
                };
            }
        }

        // No pattern matched - return unknown error
        return {
            errorType: 'unknown',
            originalError: stderr,
            suggestedFix: 'An unknown error occurred. Review the error message for details.',
            confidence: 0.3,
            canAutoRetry: false,
        };
    }

    /**
     * Generate a retry plan based on error analysis
     */
    generateRetryPlan(
        analysis: ErrorAnalysis,
        context: CorrectionContext
    ): RetryPlan {
        const canRetry =
            analysis.canAutoRetry && context.retryCount < context.maxRetries;

        if (!canRetry) {
            return {
                shouldRetry: false,
                maxRetries: context.maxRetries,
                currentRetry: context.retryCount,
                strategy: 'manual',
                modifications: {},
                reason: analysis.canAutoRetry
                    ? 'Maximum retry attempts reached'
                    : 'Error type does not support auto-retry',
            };
        }

        // Determine retry strategy based on error type

        // NEW: Try alternative commands for missing_command errors
        if (analysis.errorType === 'missing_command' && analysis.retryStrategy?.alternativeCommands?.length) {
            return {
                shouldRetry: true,
                maxRetries: context.maxRetries,
                currentRetry: context.retryCount + 1,
                strategy: 'try_alternative_command',
                modifications: {},
                reason: `Command not found. Try alternatives: ${analysis.retryStrategy.alternativeCommands.join(', ')}`,
                alternativeCommands: analysis.retryStrategy.alternativeCommands,
            };
        }

        if (analysis.retryStrategy?.additionalDeps?.length) {
            return {
                shouldRetry: true,
                maxRetries: context.maxRetries,
                currentRetry: context.retryCount + 1,
                strategy: 'install_deps',
                modifications: {
                    dependencies: analysis.retryStrategy.additionalDeps,
                },
                reason: `Install missing dependencies: ${analysis.retryStrategy.additionalDeps.join(', ')}`,
            };
        }

        if (analysis.errorType === 'timeout') {
            // Double the timeout for retry
            const currentTimeout =
                (context.toolArgs.timeout_ms as number) || 30000;
            return {
                shouldRetry: true,
                maxRetries: context.maxRetries,
                currentRetry: context.retryCount + 1,
                strategy: 'change_params',
                modifications: {
                    params: {
                        timeout_ms: Math.min(currentTimeout * 2, 300000),
                    },
                },
                reason: `Increase timeout from ${currentTimeout}ms to ${Math.min(currentTimeout * 2, 300000)}ms`,
            };
        }

        if (analysis.errorType === 'network') {
            return {
                shouldRetry: true,
                maxRetries: context.maxRetries,
                currentRetry: context.retryCount + 1,
                strategy: 'change_params',
                modifications: {},
                reason: 'Retry due to network error',
            };
        }

        // New: Suggest Web Search for unknown errors
        if (analysis.errorType === 'unknown' && context.retryCount < 2) {
            return {
                shouldRetry: true,
                maxRetries: context.maxRetries,
                currentRetry: context.retryCount + 1,
                strategy: 'search_web',
                modifications: {},
                reason: 'Error is unknown. Search the web for solutions.',
            };
        }

        // New: Suggest Code Diagnosis for runtime logic errors (if not a simple built-in fix)
        if (analysis.errorType === 'python_runtime' && !analysis.retryStrategy) {
            return {
                shouldRetry: true,
                maxRetries: context.maxRetries,
                currentRetry: context.retryCount + 1,
                strategy: 'diagnose_code',
                modifications: {},
                reason: 'Runtime error requires investigation. Write a debug script.',
            };
        }

        // Browser SPA not rendered - wait for hydration
        if (analysis.errorType === 'browser_spa_not_rendered') {
            return {
                shouldRetry: true,
                maxRetries: context.maxRetries,
                currentRetry: context.retryCount + 1,
                strategy: 'browser_automation',
                modifications: {
                    params: {
                        wait_until: 'networkidle',
                        timeout_ms: 30000,
                    },
                },
                reason: 'SPA page did not render. Use browser_navigate with wait_until="networkidle" to wait for page hydration. ' +
                    'After navigation, wait 5s for the SPA framework to fully render. ' +
                    'Use search_web to find automation best practices for this specific website.',
                browserAction: {
                    action: 'wait_for_spa',
                    searchQuery: 'playwright SPA page load wait strategy networkidle',
                },
            };
        }

        // Smart mode unavailable - suggest alternatives
        if (analysis.errorType === 'browser_smart_mode_unavailable') {
            return {
                shouldRetry: false,  // Do NOT retry browser_set_mode
                maxRetries: 0,
                currentRetry: context.retryCount + 1,
                strategy: 'try_alternative_command',
                modifications: {},
                reason: 'Smart mode is unavailable. STOP calling browser_set_mode. Use browser_execute_script to interact ' +
                    'via JavaScript, browser_click with CSS selectors, or search_web for automation techniques.',
                browserAction: {
                    action: 'use_precise_mode',
                    searchQuery: '[site name] playwright automation without AI vision CSS selectors',
                },
            };
        }

        // Element not found - try different selectors
        if (analysis.errorType === 'browser_element_not_found') {
            return {
                shouldRetry: true,
                maxRetries: context.maxRetries,
                currentRetry: context.retryCount + 1,
                strategy: 'browser_automation',
                modifications: {},
                reason: 'Element not found. 1) Wait for page to fully load. 2) Use browser_get_content to inspect actual DOM. ' +
                    '3) Use search_web to find correct selectors for this website. 4) Try browser_execute_script with JavaScript queries.',
                browserAction: {
                    action: 'find_alternative_selector',
                    searchQuery: '[site name] playwright correct CSS selectors',
                },
            };
        }

        // NEW: Browser automation for web search failures
        if (analysis.errorType === 'web_search_failed') {
            return {
                shouldRetry: true,
                maxRetries: context.maxRetries,
                currentRetry: context.retryCount + 1,
                strategy: 'browser_automation',
                modifications: {},
                reason: 'Web search failed. Use browser automation (Playwright) to access web content directly.',
                browserAction: {
                    action: 'scrape',
                },
            };
        }

        // NEW: Browser automation for pages requiring interaction
        if (analysis.errorType === 'web_interaction_required') {
            return {
                shouldRetry: true,
                maxRetries: context.maxRetries,
                currentRetry: context.retryCount + 1,
                strategy: 'browser_automation',
                modifications: {},
                reason: 'Page requires browser interaction. Use webapp-testing skill with Playwright.',
                browserAction: {
                    action: 'interact',
                },
            };
        }

        // NEW: Plan refinement when multiple approaches have failed
        if (analysis.errorType === 'plan_refinement_needed' || context.retryCount >= 2) {
            return {
                shouldRetry: true,
                maxRetries: context.maxRetries,
                currentRetry: context.retryCount + 1,
                strategy: 'refine_plan',
                modifications: {},
                reason: 'Current approach is not working. Step back and reconsider the strategy.',
                refinementHints: [
                    'Break down the problem into smaller steps',
                    'Try an alternative tool or approach',
                    'Search for similar problems and their solutions',
                    'Consider if the original request needs clarification',
                ],
            };
        }

        return {
            shouldRetry: false,
            maxRetries: context.maxRetries,
            currentRetry: context.retryCount,
            strategy: 'manual',
            modifications: {},
            reason: 'No automatic retry strategy available for this error type',
        };
    }

    /**
     * Analyze error and generate full correction result
     */
    analyze(context: CorrectionContext): CorrectionResult {
        const analysis = this.analyzeError(
            context.stderr,
            context.toolArgs,
            context.toolName
        );

        const retryPlan = this.generateRetryPlan(analysis, context);

        const formattedHint = this.formatHint(analysis, retryPlan, context);

        return {
            analysis,
            retryPlan,
            formattedHint,
        };
    }

    /**
     * Format error analysis as a hint for the AI
     */
    formatHint(
        analysis: ErrorAnalysis,
        retryPlan: RetryPlan,
        context: CorrectionContext
    ): string {
        const lines: string[] = [];

        lines.push('[Self-Correction Analysis]');
        lines.push(`Error Type: ${analysis.errorType}`);
        lines.push(`Confidence: ${(analysis.confidence * 100).toFixed(0)}%`);
        lines.push(`Suggestion: ${analysis.suggestedFix}`);
        lines.push('');

        if (retryPlan.shouldRetry) {
            lines.push('[Retry Plan]');
            lines.push(`Strategy: ${retryPlan.strategy}`);
            lines.push(`Attempt: ${retryPlan.currentRetry}/${retryPlan.maxRetries}`);
            lines.push(`Reason: ${retryPlan.reason}`);

            if (retryPlan.modifications.dependencies?.length) {
                lines.push(`Dependencies to install: ${retryPlan.modifications.dependencies.join(', ')}`);
            }

            if (retryPlan.modifications.params) {
                lines.push(`Parameter changes: ${JSON.stringify(retryPlan.modifications.params)}`);
            }

            if (retryPlan.strategy === 'search_web') {
                lines.push(`Action: Use the 'search_web' tool to search for the error message.`);
                lines.push(`Refined Query: "${analysis.originalError.split('\n')[0].slice(0, 100)}..."`);
            }

            if (retryPlan.strategy === 'diagnose_code') {
                lines.push(`Action: Write a small script to debug the state or print variable values.`);
            }

            if (retryPlan.strategy === 'browser_automation') {
                lines.push(`Action: Use browser automation (webapp-testing skill with Playwright).`);
                lines.push(`Steps:`);
                lines.push(`  1. Write a Python script using playwright.sync_api`);
                lines.push(`  2. Navigate to the URL and wait for page.wait_for_load_state('networkidle')`);
                lines.push(`  3. Take a screenshot or inspect page.content() to understand the page`);
                lines.push(`  4. Interact with elements using proper selectors`);
                if (retryPlan.browserAction) {
                    lines.push(`  Suggested action: ${retryPlan.browserAction.action}`);
                }
            }

            if (retryPlan.strategy === 'refine_plan') {
                lines.push(`Action: Step back and reconsider your approach.`);
                lines.push(`Refinement hints:`);
                if (retryPlan.refinementHints) {
                    retryPlan.refinementHints.forEach((hint, i) => {
                        lines.push(`  ${i + 1}. ${hint}`);
                    });
                }
            }

            if (retryPlan.strategy === 'try_alternative_command') {
                lines.push(`Action: The command was not found. Try one of these alternatives:`);
                if (retryPlan.alternativeCommands) {
                    retryPlan.alternativeCommands.forEach((cmd, i) => {
                        lines.push(`  ${i + 1}. ${cmd}`);
                    });
                }
                lines.push(`Note: On Windows, use 'python' instead of 'python3', 'dir' instead of 'ls', etc.`);
            }
        } else {
            lines.push('[Manual Intervention Required]');
            lines.push(`Reason: ${retryPlan.reason}`);
            lines.push('');
            lines.push('Recommended actions:');
            lines.push('1. Review the error message above');
            lines.push('2. Apply the suggested fix');
            lines.push('3. Search knowledge base for similar errors');
            lines.push('4. If resolved, save the solution for future reference');
        }

        return lines.join('\n');
    }

    /**
     * Check if an error indicates a recoverable condition
     */
    isRecoverable(analysis: ErrorAnalysis): boolean {
        const recoverableTypes: ErrorAnalysis['errorType'][] = [
            'missing_module',
            'timeout',
            'network',
            'web_search_failed',
            'web_interaction_required',
            'plan_refinement_needed',
        ];
        return recoverableTypes.includes(analysis.errorType);
    }

    /**
     * Extract actionable items from error analysis
     */
    getActionableItems(analysis: ErrorAnalysis): string[] {
        const items: string[] = [];

        if (analysis.retryStrategy?.additionalDeps?.length) {
            items.push(
                `Install packages: ${analysis.retryStrategy.additionalDeps.join(', ')}`
            );
        }

        if (analysis.errorType === 'python_syntax') {
            items.push('Fix syntax error in code');
        }

        if (analysis.errorType === 'file_not_found') {
            items.push('Verify file path exists');
        }

        if (analysis.errorType === 'permission_denied') {
            items.push('Check file/directory permissions');
        }

        if (analysis.errorType === 'web_search_failed') {
            items.push('Use browser automation (Playwright) instead of search');
        }

        if (analysis.errorType === 'web_interaction_required') {
            items.push('Use webapp-testing skill with Playwright to interact with the page');
        }

        if (analysis.errorType === 'plan_refinement_needed') {
            items.push('Reconsider the approach and try a different strategy');
        }

        if (items.length === 0) {
            items.push('Review error message and fix manually');
        }

        return items;
    }

    /**
     * Create a recursive diagnosis plan for complex errors
     * This implements OpenClaw-style iterative debugging
     */
    createRecursiveDiagnosisPlan(
        originalError: string,
        previousAttempts: string[],
        maxDepth: number = 3
    ): {
        steps: string[];
        shouldContinue: boolean;
        nextStrategy: RetryStrategy;
    } {
        const depth = previousAttempts.length;

        if (depth >= maxDepth) {
            return {
                steps: ['Maximum diagnosis depth reached. Escalate to user.'],
                shouldContinue: false,
                nextStrategy: 'manual',
            };
        }

        // Progressive diagnosis strategy
        const diagnosisStrategies = [
            {
                steps: [
                    'Add debug logging to identify the exact failure point',
                    'Print variable values before the error occurs',
                    'Check function inputs and outputs',
                ],
                nextStrategy: 'diagnose_code' as RetryStrategy,
            },
            {
                steps: [
                    'Isolate the failing component in a minimal script',
                    'Test with known good inputs',
                    'Compare expected vs actual behavior',
                ],
                nextStrategy: 'modify_code' as RetryStrategy,
            },
            {
                steps: [
                    'Search for similar errors in documentation',
                    'Check for version incompatibilities',
                    'Look for known issues in issue trackers',
                ],
                nextStrategy: 'search_web' as RetryStrategy,
            },
        ];

        const currentStrategy = diagnosisStrategies[depth] || diagnosisStrategies[diagnosisStrategies.length - 1];

        return {
            steps: currentStrategy.steps,
            shouldContinue: depth < maxDepth - 1,
            nextStrategy: currentStrategy.nextStrategy,
        };
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalEngine: SelfCorrectionEngine | null = null;

export function getSelfCorrectionEngine(maxRetries?: number): SelfCorrectionEngine {
    if (!globalEngine) {
        globalEngine = new SelfCorrectionEngine(maxRetries);
    }
    return globalEngine;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Quick analysis for inline use
 */
export function quickAnalyzeError(
    stderr: string,
    toolName: string = 'unknown'
): ErrorAnalysis {
    const engine = getSelfCorrectionEngine();
    return engine.analyzeError(stderr, {}, toolName);
}

/**
 * Format error for AI consumption
 */
export function formatErrorForAI(
    stderr: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    retryCount: number = 0
): string {
    const engine = getSelfCorrectionEngine();
    const result = engine.analyze({
        toolName,
        toolArgs,
        stderr,
        exitCode: 1,
        retryCount,
        maxRetries: 3,
    });

    return result.formattedHint;
}

// ============================================================================
// Export
// ============================================================================

export default SelfCorrectionEngine;
