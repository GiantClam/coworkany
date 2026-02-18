/**
 * Unit Tests for New Browser Tools
 *
 * Tests the tool definitions and basic handler behavior for:
 * - browser_upload_file
 * - browser_set_mode
 * - browser_ai_action
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
    BROWSER_TOOLS,
    browserUploadFileTool,
    browserSetModeTool,
    browserAiActionTool,
    browserConnectTool,
    browserDisconnectTool,
    browserNavigateTool,
    browserClickTool,
    browserFillTool,
    browserWaitTool,
    browserScreenshotTool,
    browserGetContentTool,
    browserExecuteScriptTool,
    browserGetSessionsTool,
} from '../browser';
import { browserService, BrowserService } from '../../services/browserService';

// ============================================================================
// 1. BROWSER_TOOLS Array Completeness
// ============================================================================

describe('BROWSER_TOOLS array', () => {
    test('contains all 13 tools', () => {
        expect(BROWSER_TOOLS.length).toBe(13);
    });

    test('contains all original tools', () => {
        const names = BROWSER_TOOLS.map(t => t.name);
        expect(names).toContain('browser_connect');
        expect(names).toContain('browser_disconnect');
        expect(names).toContain('browser_get_sessions');
        expect(names).toContain('browser_navigate');
        expect(names).toContain('browser_screenshot');
        expect(names).toContain('browser_get_content');
        expect(names).toContain('browser_click');
        expect(names).toContain('browser_fill');
        expect(names).toContain('browser_wait');
        expect(names).toContain('browser_execute_script');
    });

    test('contains all new hybrid tools', () => {
        const names = BROWSER_TOOLS.map(t => t.name);
        expect(names).toContain('browser_upload_file');
        expect(names).toContain('browser_set_mode');
        expect(names).toContain('browser_ai_action');
    });

    test('all tools have required fields', () => {
        for (const tool of BROWSER_TOOLS) {
            expect(typeof tool.name).toBe('string');
            expect(tool.name.length).toBeGreaterThan(0);
            expect(typeof tool.description).toBe('string');
            expect(tool.description.length).toBeGreaterThan(0);
            expect(typeof tool.handler).toBe('function');
            expect(tool.input_schema).toBeDefined();
            expect(tool.input_schema.type).toBe('object');
        }
    });

    test('no duplicate tool names', () => {
        const names = BROWSER_TOOLS.map(t => t.name);
        const unique = new Set(names);
        expect(unique.size).toBe(names.length);
    });
});

// ============================================================================
// 2. browser_upload_file Tool Definition
// ============================================================================

describe('browser_upload_file tool', () => {
    test('has correct name', () => {
        expect(browserUploadFileTool.name).toBe('browser_upload_file');
    });

    test('requires file_path parameter', () => {
        const required = browserUploadFileTool.input_schema.required;
        expect(required).toContain('file_path');
    });

    test('has optional selector and instruction parameters', () => {
        const props = browserUploadFileTool.input_schema.properties;
        expect(props.file_path).toBeDefined();
        expect(props.selector).toBeDefined();
        expect(props.instruction).toBeDefined();
    });

    test('has filesystem:read effect', () => {
        expect(browserUploadFileTool.effects).toContain('filesystem:read');
    });

    test('handler returns error when upload fails', async () => {
        const originalIsConnected = browserService.isConnected;
        const originalUploadFile = browserService.uploadFile;

        (browserService as any).isConnected = () => true;
        (browserService as any).uploadFile = async () => ({
            success: false,
            message: 'File not found',
            error: 'mock upload failure',
        });

        try {
            const result = await browserUploadFileTool.handler(
                { file_path: 'C:\\test\\image.png' },
                undefined as any
            );
            expect(result.success).toBe(false);
        } finally {
            (browserService as any).isConnected = originalIsConnected;
            (browserService as any).uploadFile = originalUploadFile;
        }
    });
});

// ============================================================================
// 3. browser_set_mode Tool Definition
// ============================================================================

describe('browser_set_mode tool', () => {
    beforeEach(() => {
        // Reset BrowserService singleton
        (BrowserService as any).instance = null;
    });

    test('has correct name', () => {
        expect(browserSetModeTool.name).toBe('browser_set_mode');
    });

    test('requires mode parameter', () => {
        const required = browserSetModeTool.input_schema.required;
        expect(required).toContain('mode');
    });

    test('mode parameter has valid enum values', () => {
        const modeSchema = browserSetModeTool.input_schema.properties.mode;
        expect(modeSchema.enum).toEqual(['precise', 'smart', 'auto']);
    });

    test('handler sets mode to precise', async () => {
        const result = await browserSetModeTool.handler(
            { mode: 'precise' },
            undefined as any
        );
        expect(result.success).toBe(true);
        expect(result.currentMode).toBe('precise');
    });

    test('handler sets mode to smart and reports availability', async () => {
        const result = await browserSetModeTool.handler(
            { mode: 'smart' },
            undefined as any
        );
        expect(result.success).toBe(true);
        expect(result.currentMode).toBe('smart');
        expect(typeof result.smartModeAvailable).toBe('boolean');
    });

    test('handler sets mode to auto', async () => {
        const result = await browserSetModeTool.handler(
            { mode: 'auto' },
            undefined as any
        );
        expect(result.success).toBe(true);
        expect(result.currentMode).toBe('auto');
    });

    test('handler reports previousMode', async () => {
        // First set to precise
        await browserSetModeTool.handler({ mode: 'precise' }, undefined as any);
        // Then change to smart
        const result = await browserSetModeTool.handler(
            { mode: 'smart' },
            undefined as any
        );
        expect(result.previousMode).toBe('precise');
        expect(result.currentMode).toBe('smart');
    });
});

// ============================================================================
// 4. browser_ai_action Tool Definition
// ============================================================================

describe('browser_ai_action tool', () => {
    test('has correct name', () => {
        expect(browserAiActionTool.name).toBe('browser_ai_action');
    });

    test('requires action parameter', () => {
        const required = browserAiActionTool.input_schema.required;
        expect(required).toContain('action');
    });

    test('has optional context parameter', () => {
        const props = browserAiActionTool.input_schema.properties;
        expect(props.action).toBeDefined();
        expect(props.context).toBeDefined();
    });

    test('description mentions natural language and AI vision', () => {
        expect(browserAiActionTool.description).toContain('natural language');
        expect(browserAiActionTool.description).toContain('AI');
    });

    test('handler returns error when service unavailable', async () => {
        const originalIsConnected = browserService.isConnected;
        const originalAiAction = browserService.aiAction;

        (browserService as any).isConnected = () => true;
        (browserService as any).aiAction = async () => ({
            success: false,
            error: 'browser-use-service is not available',
        });

        try {
            const result = await browserAiActionTool.handler(
                { action: 'click the publish button' },
                undefined as any
            );
            expect(result.success).toBe(false);
        } finally {
            (browserService as any).isConnected = originalIsConnected;
            (browserService as any).aiAction = originalAiAction;
        }
    });
});

// ============================================================================
// 5. Original Tools Backward Compatibility
// ============================================================================

describe('Original tools backward compatibility', () => {
    test('browser_connect has profile_name and headless params', () => {
        const props = browserConnectTool.input_schema.properties;
        expect(props.profile_name).toBeDefined();
        expect(props.headless).toBeDefined();
    });

    test('browser_navigate requires url', () => {
        expect(browserNavigateTool.input_schema.required).toContain('url');
    });

    test('browser_click has selector and text params', () => {
        const props = browserClickTool.input_schema.properties;
        expect(props.selector).toBeDefined();
        expect(props.text).toBeDefined();
    });

    test('browser_fill requires selector and value', () => {
        const required = browserFillTool.input_schema.required;
        expect(required).toContain('selector');
        expect(required).toContain('value');
    });

    test('browser_wait requires selector', () => {
        expect(browserWaitTool.input_schema.required).toContain('selector');
    });

    test('browser_execute_script requires script', () => {
        expect(browserExecuteScriptTool.input_schema.required).toContain('script');
    });
});
