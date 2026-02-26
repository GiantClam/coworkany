/**
 * Browser Automation Tools
 *
 * Provides browser automation capabilities with hybrid architecture:
 * - Precise mode (Playwright): CSS selectors, direct DOM manipulation
 * - Smart mode (browser-use): AI vision, natural language actions
 * - Auto mode: Try precise first, fallback to smart
 *
 * These tools allow the AI to interact with web pages,
 * reusing the user's existing Chrome browser and login sessions.
 */

import { ToolDefinition } from './standard';
import { browserService } from '../services/browserService';
import type { BrowserMode } from '../services/browserService';

async function ensureBrowserConnected(): Promise<void> {
    if (browserService.isConnected()) {
        return;
    }

    const connection = await browserService.connect({});
    const mode = connection.isUserProfile ? 'CDP (system Chrome)' : 'Playwright Chromium (persistent profile)';
    console.error(`[BrowserTools] Auto-connected browser via ${mode}`);
}

// ============================================================================
// Session Management Tools
// ============================================================================

/**
 * Connect to browser with user's Chrome profile
 */
export const browserConnectTool: ToolDefinition = {
    name: 'browser_connect',
    description: `Connect to the user's Chrome browser to use existing login sessions.
This is required before using any other browser tools.
Uses the user's actual Chrome profile with all cookies and saved passwords.
WARNING: This tool controls the user's real browser - use responsibly.`,
    effects: ['ui:notify', 'process:spawn'],
    input_schema: {
        type: 'object',
        properties: {
            profile_name: {
                type: 'string',
                description: 'Chrome profile name (e.g., "Default", "Profile 1"). Uses "Default" if omitted.',
            },
            headless: {
                type: 'boolean',
                description: 'Run in headless mode (no visible window). Default: false (shows browser).',
            },
            require_user_profile: {
                type: 'boolean',
                description: 'Require connecting to user Chrome profile via CDP (no persistent-profile fallback). Use for login-required websites.',
            },
        },
    },
    handler: async (args: { profile_name?: string; headless?: boolean; require_user_profile?: boolean }) => {
        try {
            const connection = await browserService.connect({
                profileName: args.profile_name,
                headless: args.headless,
                requireUserProfile: args.require_user_profile,
            });

            const profiles = await browserService.getAvailableProfiles();
            const mode = connection.isUserProfile ? 'CDP (system Chrome)' : 'Playwright Chromium (persistent profile)';

            return {
                success: true,
                message: `Connected to browser via ${mode}`,
                connectionMode: mode,
                connectionModeId: connection.isUserProfile ? 'cdp_user_profile' : 'persistent_profile',
                profile: args.profile_name || 'Default',
                isUserProfile: connection.isUserProfile,
                availableProfiles: profiles,
                tip: connection.isUserProfile
                    ? 'You can now use browser_navigate, browser_click, browser_fill, etc.'
                    : 'Connected via Playwright Chromium. Login sessions are persisted — you only need to log in once. Use browser_navigate to get started.',
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                tip: args.require_user_profile
                    ? 'User-profile mode required but unavailable. Start Chrome with --remote-debugging-port=9222 and retry browser_connect.'
                    : 'Browser connection failed unexpectedly. This should not happen as Playwright fallback is usually available.',
            };
        }
    },
};

/**
 * Disconnect from browser
 */
export const browserDisconnectTool: ToolDefinition = {
    name: 'browser_disconnect',
    description: 'Close the browser connection. Call this when done with browser automation.',
    effects: ['ui:notify'],
    input_schema: {
        type: 'object',
        properties: {},
    },
    handler: async () => {
        try {
            await browserService.disconnect();
            return {
                success: true,
                message: 'Disconnected from browser',
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};

/**
 * List available Chrome profiles
 */
export const browserGetSessionsTool: ToolDefinition = {
    name: 'browser_get_sessions',
    description: 'List available Chrome profiles that can be used for browser automation.',
    effects: ['filesystem:read'],
    input_schema: {
        type: 'object',
        properties: {},
    },
    handler: async () => {
        try {
            const profiles = await browserService.getAvailableProfiles();
            const userDataDir = browserService.getChromeUserDataDir();

            return {
                success: true,
                profiles,
                userDataDir,
                tip: 'Use browser_connect with profile_name to connect to a specific profile.',
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};

// ============================================================================
// Navigation Tools
// ============================================================================

/**
 * Navigate to a URL
 */
export const browserNavigateTool: ToolDefinition = {
    name: 'browser_navigate',
    description: 'Navigate the browser to a URL. Auto-connects browser if needed.',
    effects: ['network:outbound', 'ui:notify'],
    input_schema: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'The URL to navigate to.',
            },
            wait_until: {
                type: 'string',
                enum: ['load', 'domcontentloaded', 'networkidle'],
                description: 'When to consider navigation complete. Default: "domcontentloaded".',
            },
            timeout_ms: {
                type: 'integer',
                description: 'Timeout in milliseconds. Default: 30000.',
            },
        },
        required: ['url'],
    },
    handler: async (args: { url: string; wait_until?: 'load' | 'domcontentloaded' | 'networkidle'; timeout_ms?: number }) => {
        try {
            await ensureBrowserConnected();
            const result = await browserService.navigate(args.url, {
                waitUntil: args.wait_until,
                timeout: args.timeout_ms,
            });

            return {
                success: true,
                ...result,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                tip: 'Navigation failed. If auto-connect did not succeed, try browser_connect explicitly and retry.',
            };
        }
    },
};

/**
 * Take a screenshot
 */
export const browserScreenshotTool: ToolDefinition = {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page or a specific element. Returns base64 encoded image.',
    effects: ['ui:notify'],
    input_schema: {
        type: 'object',
        properties: {
            selector: {
                type: 'string',
                description: 'CSS selector of element to screenshot. If omitted, screenshots the full viewport.',
            },
            full_page: {
                type: 'boolean',
                description: 'Capture full scrollable page. Default: false.',
            },
        },
    },
    handler: async (args: { selector?: string; full_page?: boolean }) => {
        try {
            await ensureBrowserConnected();
            const result = await browserService.screenshot({
                selector: args.selector,
                fullPage: args.full_page,
            });

            return {
                success: true,
                imageBase64: result.base64,
                width: result.width,
                height: result.height,
                mimeType: 'image/png',
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};

/**
 * Get page content
 */
export const browserGetContentTool: ToolDefinition = {
    name: 'browser_get_content',
    description: 'Get the text content or HTML of the current page.',
    effects: ['ui:notify'],
    input_schema: {
        type: 'object',
        properties: {
            as_html: {
                type: 'boolean',
                description: 'Return raw HTML instead of text content. Default: false.',
            },
        },
    },
    handler: async (args: { as_html?: boolean }) => {
        try {
            await ensureBrowserConnected();
            const result = await browserService.getContent(!args.as_html);

            return {
                success: true,
                ...result,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};

// ============================================================================
// Interaction Tools
// ============================================================================

/**
 * Click on an element
 */
export const browserClickTool: ToolDefinition = {
    name: 'browser_click',
    description: 'Click on an element in the page. Can target by CSS selector or visible text.',
    effects: ['ui:notify'],
    input_schema: {
        type: 'object',
        properties: {
            selector: {
                type: 'string',
                description: 'CSS selector of the element to click.',
            },
            text: {
                type: 'string',
                description: 'Alternative: click element containing this visible text.',
            },
            timeout_ms: {
                type: 'integer',
                description: 'Timeout waiting for element. Default: 10000.',
            },
        },
    },
    handler: async (args: { selector?: string; text?: string; timeout_ms?: number }) => {
        if (!args.selector && !args.text) {
            return {
                success: false,
                error: 'Either selector or text must be provided',
            };
        }

        try {
            await ensureBrowserConnected();
            const result = await browserService.click({
                selector: args.selector,
                text: args.text,
                timeout: args.timeout_ms,
            });

            return {
                success: true,
                ...result,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                tip: 'Check if the element exists and is visible.',
            };
        }
    },
};

/**
 * Fill a form field
 */
export const browserFillTool: ToolDefinition = {
    name: 'browser_fill',
    description: 'Fill a form field with text. Clears existing content by default.',
    effects: ['ui:notify'],
    input_schema: {
        type: 'object',
        properties: {
            selector: {
                type: 'string',
                description: 'CSS selector of the input field.',
            },
            value: {
                type: 'string',
                description: 'The text to fill in.',
            },
            clear_first: {
                type: 'boolean',
                description: 'Clear existing content before filling. Default: true.',
            },
        },
        required: ['selector', 'value'],
    },
    handler: async (args: { selector: string; value: string; clear_first?: boolean }) => {
        try {
            await ensureBrowserConnected();
            const result = await browserService.fill({
                selector: args.selector,
                value: args.value,
                clearFirst: args.clear_first,
            });

            return {
                success: true,
                ...result,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                tip: 'Check if the input field exists and is enabled.',
            };
        }
    },
};

/**
 * Wait for an element
 */
export const browserWaitTool: ToolDefinition = {
    name: 'browser_wait',
    description: 'Wait for an element to appear or reach a certain state.',
    effects: ['ui:notify'],
    input_schema: {
        type: 'object',
        properties: {
            selector: {
                type: 'string',
                description: 'CSS selector to wait for.',
            },
            state: {
                type: 'string',
                enum: ['visible', 'hidden', 'attached', 'detached'],
                description: 'Element state to wait for. Default: "visible".',
            },
            timeout_ms: {
                type: 'integer',
                description: 'Maximum wait time in milliseconds. Default: 30000.',
            },
        },
        required: ['selector'],
    },
    handler: async (args: { selector: string; state?: 'visible' | 'hidden' | 'attached' | 'detached'; timeout_ms?: number }) => {
        try {
            await ensureBrowserConnected();
            const result = await browserService.wait({
                selector: args.selector,
                state: args.state,
                timeout: args.timeout_ms,
            });

            return {
                success: result.found,
                ...result,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};

// ============================================================================
// Advanced Tools
// ============================================================================

/**
 * Execute JavaScript in page context
 */
export const browserExecuteScriptTool: ToolDefinition = {
    name: 'browser_execute_script',
    description: 'Execute JavaScript code in the page context. Use with caution.',
    effects: ['code:execute', 'ui:notify'],
    input_schema: {
        type: 'object',
        properties: {
            script: {
                type: 'string',
                description: 'JavaScript code to execute. Can access window, document, etc.',
            },
        },
        required: ['script'],
    },
    handler: async (args: { script: string }) => {
        try {
            await ensureBrowserConnected();
            const result = await browserService.executeScript(args.script);

            return {
                success: true,
                result,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};

// ============================================================================
// Hybrid Browser Tools (new)
// ============================================================================

/**
 * Upload a file through a file input element on the page
 */
export const browserUploadFileTool: ToolDefinition = {
    name: 'browser_upload_file',
    description: `Upload a file through a file input element on the page.
In precise mode: uses CSS selector or auto-detects file input / filechooser dialog.
In smart mode: uses AI vision to find and interact with the upload element.
In auto mode: tries precise first, then falls back to smart.`,
    effects: ['ui:notify', 'filesystem:read'],
    input_schema: {
        type: 'object',
        properties: {
            file_path: {
                type: 'string',
                description: 'Absolute path to the file to upload.',
            },
            selector: {
                type: 'string',
                description: 'CSS selector of the file input element (optional, will auto-detect if omitted).',
            },
            instruction: {
                type: 'string',
                description: 'Natural language instruction for finding the upload element (used in smart mode). e.g. "click the upload photo button"',
            },
        },
        required: ['file_path'],
    },
    handler: async (args: { file_path: string; selector?: string; instruction?: string }) => {
        try {
            await ensureBrowserConnected();
            const result = await browserService.uploadFile({
                filePath: args.file_path,
                selector: args.selector,
                instruction: args.instruction,
            });

            return {
                success: result.success,
                message: result.message,
                ...(result.error ? { error: result.error } : {}),
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                tip: 'Make sure the file exists and the browser is connected. For complex upload UIs, try smart mode with browser_set_mode.',
            };
        }
    },
};

/**
 * Set browser automation mode
 */
export const browserSetModeTool: ToolDefinition = {
    name: 'browser_set_mode',
    description: `Set the browser automation mode.
- "precise": Use Playwright with CSS selectors. Fast and deterministic. Best for known page structures.
- "smart": Use AI vision (browser-use). Slower but can handle unknown/dynamic pages. Requires browser-use-service running.
- "auto": Try precise mode first, automatically fall back to smart mode on failure (default).`,
    effects: ['ui:notify'],
    input_schema: {
        type: 'object',
        properties: {
            mode: {
                type: 'string',
                enum: ['precise', 'smart', 'auto'],
                description: 'The browser automation mode to use.',
            },
        },
        required: ['mode'],
    },
    handler: async (args: { mode: BrowserMode }) => {
        try {
            const previousMode = browserService.mode;
            browserService.setMode(args.mode);

            let smartAvailable: boolean | undefined;
            if (args.mode === 'smart' || args.mode === 'auto') {
                smartAvailable = await browserService.isBrowserUseAvailable();
            }

            return {
                success: true,
                previousMode,
                currentMode: args.mode,
                ...(smartAvailable !== undefined ? { smartModeAvailable: smartAvailable } : {}),
                ...(args.mode === 'smart' && !smartAvailable ? {
                    warning: 'browser-use-service is not running. Start it with: cd browser-use-service && python main.py',
                } : {}),
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};

/**
 * Perform a browser action described in natural language using AI vision
 */
export const browserAiActionTool: ToolDefinition = {
    name: 'browser_ai_action',
    description: `Perform a browser action described in natural language using AI vision.
Uses the browser-use service to understand the page visually and execute the action.
Best for: unknown page structures, dynamically rendered content, complex interactions
that are hard to express with CSS selectors.
Requires browser-use-service to be running.

Examples:
- "click the publish button"
- "scroll down and find the comment box, then type 'Hello'"
- "select the second item from the dropdown menu"`,
    effects: ['ui:notify', 'network:outbound'],
    input_schema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'Natural language description of the action to perform.',
            },
            context: {
                type: 'string',
                description: 'Additional context about the current page (e.g. "we are on the Xiaohongshu editor page").',
            },
        },
        required: ['action'],
    },
    handler: async (args: { action: string; context?: string }) => {
        try {
            await ensureBrowserConnected();
            const result = await browserService.aiAction({
                action: args.action,
                context: args.context,
            });

            return {
                success: result.success,
                result: result.result,
                ...(result.error ? { error: result.error } : {}),
                tip: result.success ? undefined : 'Make sure browser-use-service is running: cd browser-use-service && python main.py',
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                tip: 'Ensure browser-use-service is running and the browser is connected.',
            };
        }
    },
};

// ============================================================================
// Export
// ============================================================================

export const BROWSER_TOOLS: ToolDefinition[] = [
    // Session Management
    browserConnectTool,
    browserDisconnectTool,
    browserGetSessionsTool,
    // Navigation
    browserNavigateTool,
    browserScreenshotTool,
    browserGetContentTool,
    // Interaction
    browserClickTool,
    browserFillTool,
    browserWaitTool,
    // Advanced
    browserExecuteScriptTool,
    // Hybrid Browser (new)
    browserUploadFileTool,
    browserSetModeTool,
    browserAiActionTool,
];
