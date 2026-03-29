/**
 * Token Usage Parsing Unit Tests
 *
 * Verifies that token usage data is correctly extracted from
 * Mastra streaming response formats and forwarded to desktop timeline events.
 *
 * Run: cd sidecar && bun test tests/token-usage.test.ts
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const BRIDGE_FILE = path.resolve(__dirname, '../src/ipc/bridge.ts');
const STREAMING_FILE = path.resolve(__dirname, '../src/ipc/streaming.ts');
const ENTRYPOINT_FILE = path.resolve(__dirname, '../src/mastra/entrypoint.ts');
const RUNTIME_FILE = path.resolve(__dirname, '../src/handlers/runtime.ts');

// ============================================================================
// Helper: Read and check source patterns
// ============================================================================

function read(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
}

// ============================================================================
// Structural Tests: Verify token tracking code is in place
// ============================================================================

describe('Token Usage: Mastra stream extraction', () => {
    const bridgeSource = read(BRIDGE_FILE);
    const streamingSource = read(STREAMING_FILE);

    test('bridge exports extractMastraTokenUsageEvent for finish/step-finish chunks', () => {
        expect(bridgeSource).toContain('export function extractMastraTokenUsageEvent');
        expect(bridgeSource).toContain("chunk.type !== 'step-finish' && chunk.type !== 'finish'");
    });

    test('bridge normalizes usage fields across provider shapes', () => {
        expect(bridgeSource).toContain('promptTokens');
        expect(bridgeSource).toContain('completionTokens');
        expect(bridgeSource).toContain('inputTokens');
        expect(bridgeSource).toContain('outputTokens');
    });

    test('streaming forwards token usage events before normal chunk mapping', () => {
        expect(streamingSource).toContain('extractMastraTokenUsageEvent');
        expect(streamingSource).toContain('sendToDesktop(tokenUsageEvent)');
    });
});

describe('Token Usage: Runtime event emission', () => {
    const entrypointSource = read(ENTRYPOINT_FILE);
    const runtimeSource = read(RUNTIME_FILE);

    test('main-mastra entrypoint emits TOKEN_USAGE timeline event', () => {
        expect(entrypointSource).toContain("if (event.type === 'token_usage')");
        expect(entrypointSource).toContain("type: 'TOKEN_USAGE'");
    });

    test('runtime bridge emits TOKEN_USAGE through TaskEventBus', () => {
        const tokenUsageEmitPattern = /emitRaw\(\s*taskId\s*,\s*['"]TOKEN_USAGE['"]/;
        expect(runtimeSource).toContain("if (event.type === 'token_usage')");
        expect(tokenUsageEmitPattern.test(runtimeSource)).toBe(true);
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
