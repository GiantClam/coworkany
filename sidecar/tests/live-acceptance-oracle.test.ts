import { describe, expect, test } from 'bun:test';

import {
    evaluateAssistantAnswerQuality,
    evaluateLiveAcceptance,
    evaluateProductTone,
    evaluateUiUnderstandability,
    evaluateVisualScreenshotAcceptance,
} from '../src/acceptance/liveAcceptanceOracle';

function failedIds(checks: { id: string; severity: string }[]): string[] {
    return checks
        .filter((check) => check.severity === 'fail')
        .map((check) => check.id);
}

function warningIds(checks: { id: string; severity: string }[]): string[] {
    return checks
        .filter((check) => check.severity === 'warn')
        .map((check) => check.id);
}

describe('live acceptance oracle', () => {
    test('rejects task false completion when required evidence and artifact are missing', () => {
        const checks = evaluateAssistantAnswerQuality({
            text: '已完成，结果已经写入并验证，无需进一步操作。',
            routeMode: 'task',
            requiresAction: true,
            requiredCapabilities: ['filesystem_read', 'artifact_write'],
            satisfiedCapabilities: ['filesystem_read'],
            requiredArtifactPaths: ['workspace/result.json'],
            presentArtifactPaths: [],
        });

        expect(failedIds(checks)).toEqual(expect.arrayContaining([
            'answer.required_evidence',
            'answer.required_artifacts',
            'answer.false_completion_claim',
        ]));
    });

    test('accepts a grounded task answer with required evidence and artifacts', () => {
        const checks = evaluateAssistantAnswerQuality({
            text: '已读取输入文件并写入 workspace/result.json，关键字段校验完成。',
            routeMode: 'task',
            requiresAction: true,
            requiredCapabilities: ['filesystem_read', 'artifact_write'],
            satisfiedCapabilities: ['filesystem_read', 'artifact_write'],
            requiredArtifactPaths: ['workspace/result.json'],
            presentArtifactPaths: ['workspace/result.json'],
        });

        expect(failedIds(checks)).toEqual([]);
    });

    test('flags placeholder answers and raw protocol errors', () => {
        expect(failedIds(evaluateAssistantAnswerQuality({
            text: 'Done',
            minChars: 4,
        }))).toContain('answer.placeholder');

        expect(failedIds(evaluateAssistantAnswerQuality({
            text: 'Task failed: workflow_missing_required_tool_evidence:artifact_write',
            minChars: 4,
        }))).toContain('answer.raw_protocol_error');
    });

    test('judges product tone without relying on manual review', () => {
        const failed = evaluateProductTone({
            text: 'As an AI language model, I cannot do that.',
        });
        expect(failedIds(failed)).toContain('tone.ai_meta');

        const warned = evaluateProductTone({
            text: 'Great question! This is super easy!!',
        });
        expect(warningIds(warned)).toEqual(expect.arrayContaining([
            'tone.cheerleading',
            'tone.excessive_punctuation',
        ]));

        const passed = evaluateProductTone({
            text: '已收到。下一步需要补充账号授权后继续执行。',
        });
        expect(failedIds(passed)).toEqual([]);
    });

    test('can promote product tone warnings into blocking acceptance failures', () => {
        const checks = evaluateProductTone({
            text: 'Great question! This is super easy!!',
            failOnWarnings: true,
        });

        expect(failedIds(checks)).toEqual(expect.arrayContaining([
            'tone.cheerleading',
            'tone.excessive_punctuation',
        ]));
    });

    test('rejects unclear UI states that expose raw runtime errors or lack recovery actions', () => {
        const checks = evaluateUiUnderstandability({
            phase: 'failed',
            statusLabel: 'Task failed',
            description: 'workflow_missing_required_tool_evidence:artifact_write',
            failureCategory: 'retryable',
        });

        expect(failedIds(checks)).toEqual(expect.arrayContaining([
            'ui.raw_protocol_error',
            'ui.recovery_action',
        ]));
    });

    test('accepts readable blocked UI states with recovery action labels', () => {
        const checks = evaluateUiUnderstandability({
            phase: 'failed',
            statusLabel: '需要重试',
            description: '执行步骤没有产生必需的输出文件。请重试，系统会重新运行任务步骤。',
            primaryActionLabel: '重试任务',
            failureCategory: 'retryable',
        });

        expect(failedIds(checks)).toEqual([]);
    });

    test('combines answer, tone, and UI checks into a live acceptance verdict', () => {
        const verdict = evaluateLiveAcceptance({
            answer: {
                text: '已读取输入并写入 workspace/result.json，输出已校验。',
                routeMode: 'task',
                requiredCapabilities: ['filesystem_read', 'artifact_write'],
                satisfiedCapabilities: ['filesystem_read', 'artifact_write'],
                requiredArtifactPaths: ['workspace/result.json'],
                presentArtifactPaths: ['workspace/result.json'],
            },
            tone: {
                text: '已读取输入并写入 workspace/result.json，输出已校验。',
            },
            ui: {
                phase: 'finished',
                statusLabel: '任务完成',
                description: '输出文件已生成并校验。',
            },
        });

        expect(verdict.passed).toBe(true);
        expect(verdict.failedChecks).toEqual([]);
    });

    test('accepts and rejects visual screenshot verdicts as automated gate input', () => {
        const passed = evaluateVisualScreenshotAcceptance({
            screenshotPath: 'test-results/failure-ui.png',
            referencePath: 'tests/snapshots/failure-ui.png',
            score: 99,
            threshold: 90,
            verdict: 'pass',
            categoryMatch: true,
        });
        expect(failedIds(passed)).toEqual([]);

        const failed = evaluateVisualScreenshotAcceptance({
            screenshotPath: 'test-results/failure-ui.png',
            referencePath: 'tests/snapshots/failure-ui.png',
            score: 72,
            threshold: 90,
            verdict: 'revise',
            categoryMatch: false,
            differences: ['Recovery banner is clipped'],
        });
        expect(failedIds(failed)).toEqual(expect.arrayContaining([
            'visual.score',
            'visual.verdict',
            'visual.category_match',
            'visual.differences',
        ]));
    });
});
