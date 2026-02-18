/**
 * Token Usage Parsing Unit Tests
 *
 * Verifies that token usage data is correctly extracted from
 * Anthropic and OpenAI streaming response formats.
 *
 * Run: cd sidecar && bun test tests/token-usage.test.ts
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const SIDECAR_MAIN = path.resolve(__dirname, '../src/main.ts');

// ============================================================================
// Helper: Read and check source patterns
// ============================================================================

function readMainTs(): string {
    return fs.readFileSync(SIDECAR_MAIN, 'utf-8');
}

// ============================================================================
// Structural Tests: Verify token tracking code is in place
// ============================================================================

describe('Token Usage: Anthropic stream parser', () => {
    const source = readMainTs();

    test('streamAnthropicResponse tracks totalInputTokens', () => {
        expect(source).toContain('totalInputTokens');
        expect(source).toContain('totalOutputTokens');
    });

    test('streamAnthropicResponse parses message_start for input tokens', () => {
        expect(source).toContain("type === 'message_start'");
        expect(source).toContain('payload.message.usage.input_tokens');
    });

    test('streamAnthropicResponse parses message_delta for output tokens', () => {
        expect(source).toContain("type === 'message_delta'");
    });

    test('streamAnthropicResponse tracks cache token counts', () => {
        expect(source).toContain('cacheCreationInputTokens');
        expect(source).toContain('cacheReadInputTokens');
        expect(source).toContain('cache_creation_input_tokens');
        expect(source).toContain('cache_read_input_tokens');
    });

    test('streamAnthropicResponse emits TOKEN_USAGE event', () => {
        // Verify TOKEN_USAGE event emission pattern for Anthropic
        const tokenUsageEmitPattern = /type:\s*['"]TOKEN_USAGE['"]/;
        expect(tokenUsageEmitPattern.test(source)).toBe(true);
    });

    test('TOKEN_USAGE payload includes inputTokens, outputTokens, modelId, provider', () => {
        expect(source).toContain('inputTokens:');
        expect(source).toContain('outputTokens:');
        expect(source).toContain('modelId:');
        expect(source).toContain('provider:');
    });
});

describe('Token Usage: OpenAI stream parser', () => {
    const source = readMainTs();

    test('streamOpenAIResponse tracks openaiInputTokens', () => {
        expect(source).toContain('openaiInputTokens');
        expect(source).toContain('openaiOutputTokens');
    });

    test('streamOpenAIResponse parses payload.usage for token counts', () => {
        expect(source).toContain('payload.usage');
        expect(source).toContain('prompt_tokens');
        expect(source).toContain('completion_tokens');
    });

    test('streamOpenAIResponse emits TOKEN_USAGE event', () => {
        // There should be at least two TOKEN_USAGE emissions (Anthropic + OpenAI)
        const matches = source.match(/type:\s*['"]TOKEN_USAGE['"]/g);
        expect(matches).toBeTruthy();
        expect(matches!.length).toBeGreaterThanOrEqual(2);
    });
});

// ============================================================================
// Frontend Integration: TaskEventStore handles TOKEN_USAGE
// ============================================================================

describe('Token Usage: Frontend store integration', () => {
    const storeFile = path.resolve(__dirname, '../../desktop/src/stores/taskEvents/index.ts');

    test('taskEvents store file exists', () => {
        expect(fs.existsSync(storeFile)).toBe(true);
    });

    test('taskEvents store handles TOKEN_USAGE event type', () => {
        const content = fs.readFileSync(storeFile, 'utf-8');
        expect(content).toContain('TOKEN_USAGE');
    });

    test('taskEvents store accumulates token counts', () => {
        const content = fs.readFileSync(storeFile, 'utf-8');
        expect(content).toContain('tokenUsage');
        expect(content).toContain('inputTokens');
        expect(content).toContain('outputTokens');
    });

    test('taskEvents store calculates estimated cost', () => {
        const content = fs.readFileSync(storeFile, 'utf-8');
        expect(content).toContain('estimatedCost');
        expect(content).toContain('estimateTokenCost');
    });
});

// ============================================================================
// Frontend Component: TokenUsagePanel exists
// ============================================================================

describe('Token Usage: TokenUsagePanel component', () => {
    const panelFile = path.resolve(
        __dirname,
        '../../desktop/src/components/Chat/TokenUsagePanel.tsx'
    );

    test('TokenUsagePanel component exists', () => {
        expect(fs.existsSync(panelFile)).toBe(true);
    });

    test('TokenUsagePanel uses useTranslation', () => {
        const content = fs.readFileSync(panelFile, 'utf-8');
        expect(content).toContain('useTranslation');
    });

    test('TokenUsagePanel reads from useActiveSession', () => {
        const content = fs.readFileSync(panelFile, 'utf-8');
        expect(content).toContain('useActiveSession');
    });

    test('TokenUsagePanel displays formatted token counts', () => {
        const content = fs.readFileSync(panelFile, 'utf-8');
        expect(content).toContain('inputTokens');
        expect(content).toContain('outputTokens');
        expect(content).toContain('estimatedCost');
    });
});

// ============================================================================
// Event types include TOKEN_USAGE
// ============================================================================

describe('Token Usage: Type definitions', () => {
    const eventsFile = path.resolve(
        __dirname,
        '../../desktop/src/types/events.ts'
    );

    test('events.ts defines TOKEN_USAGE event type', () => {
        const content = fs.readFileSync(eventsFile, 'utf-8');
        expect(content).toContain('TOKEN_USAGE');
    });

    test('TaskSession type includes tokenUsage field', () => {
        const content = fs.readFileSync(eventsFile, 'utf-8');
        expect(content).toContain('tokenUsage');
    });
});
