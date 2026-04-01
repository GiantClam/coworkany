import type {
    InputProcessorOrWorkflow,
    OutputProcessorOrWorkflow,
} from '@mastra/core/processors';
import {
    ModerationProcessor,
    PIIDetector,
    PromptInjectionDetector,
} from '@mastra/core/processors';

const DEFAULT_MODEL = process.env.COWORKANY_GUARDRAIL_MODEL
    || process.env.COWORKANY_MODEL
    || 'anthropic/claude-sonnet-4-5';
const GUARDRAILS_ENABLED = process.env.COWORKANY_ENABLE_GUARDRAILS !== '0';

const sharedModelConfig = DEFAULT_MODEL;

function buildInputProcessors(): InputProcessorOrWorkflow[] {
    if (!GUARDRAILS_ENABLED) {
        return [];
    }
    return [
        new PromptInjectionDetector({
            model: sharedModelConfig,
            strategy: 'block',
            threshold: 0.72,
        }),
        new PIIDetector({
            model: sharedModelConfig,
            // Input prompts often include task metadata (uuid/url/date strings).
            // Redact instead of hard-blocking to avoid false-positive task aborts.
            strategy: 'redact',
            redactionMethod: 'placeholder',
            threshold: 0.7,
        }),
        new ModerationProcessor({
            model: sharedModelConfig,
            strategy: 'block',
            threshold: 0.6,
        }),
    ];
}

function buildOutputProcessors(): OutputProcessorOrWorkflow[] {
    if (!GUARDRAILS_ENABLED) {
        return [];
    }
    return [
        new PIIDetector({
            model: sharedModelConfig,
            strategy: 'redact',
            redactionMethod: 'placeholder',
            threshold: 0.7,
        }),
        new ModerationProcessor({
            model: sharedModelConfig,
            strategy: 'block',
            threshold: 0.6,
            chunkWindow: 1,
        }),
    ];
}

export const guardrailInputProcessors = buildInputProcessors();
export const guardrailOutputProcessors = buildOutputProcessors();
