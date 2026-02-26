import { describe, expect, test } from 'bun:test';
import {
    buildArtifactTelemetry,
    buildArtifactContract,
    detectDegradedOutputs,
    evaluateArtifactContract,
    extractArtifactPathsFromToolResult,
} from '../artifactContract';

describe('artifact contract', () => {
    test('detects pptx expectation from user query', () => {
        const contract = buildArtifactContract('请帮我制作一个PPT演示文稿，并导出为pptx文件');
        const hasPptFileRequirement = contract.requirements.some(r =>
            r.kind === 'file' && String(r.payload.extension) === '.pptx'
        );

        expect(hasPptFileRequirement).toBe(true);
    });

    test('fails when required artifact extension is missing', () => {
        const contract = buildArtifactContract('请生成ppt并导出pptx');
        const evaluation = evaluateArtifactContract(contract, {
            files: ['slides.md'],
            toolsUsed: ['write_to_file'],
            outputText: '# slides',
        });

        expect(evaluation.passed).toBe(false);
        expect(evaluation.failed.length).toBeGreaterThan(0);
    });

    test('passes when required artifact extension exists', () => {
        const contract = buildArtifactContract('create a presentation deck and export pptx');
        const evaluation = evaluateArtifactContract(contract, {
            files: ['deck-final.pptx'],
            toolsUsed: ['write_to_file'],
            outputText: '# slides',
        });

        expect(evaluation.passed).toBe(true);
        expect(evaluation.failed.length).toBe(0);
    });

    test('extracts artifact path from write_to_file tool result', () => {
        const paths = extractArtifactPathsFromToolResult('write_to_file', {
            success: true,
            path: '/tmp/slides-final.pptx',
        });

        expect(paths).toEqual(['/tmp/slides-final.pptx']);
    });

    test('detects markdown as degraded output when pptx is required', () => {
        const contract = buildArtifactContract('生成pptx演示文稿');
        const degraded = detectDegradedOutputs(contract, ['slides-outline.md']);

        expect(degraded.hasDegradedOutput).toBe(true);
        expect(degraded.degradedArtifacts).toContain('slides-outline.md');
    });

    test('detects section requirements from numbered list', () => {
        const contract = buildArtifactContract('请写PPT，需要包含：1. 背景 2. 技术路线 3. 展望');
        const evaluation = evaluateArtifactContract(contract, {
            files: ['demo.pptx'],
            toolsUsed: ['write_to_file'],
            outputText: '背景\n技术路线\n展望',
        });

        expect(evaluation.passed).toBe(true);
    });

    test('tracks strictness and telemetry for failures', () => {
        const contract = buildArtifactContract('请生成PPT并导出pptx');
        const evidence = {
            files: ['slides.md'],
            toolsUsed: ['write_to_file'],
            outputText: '这里只是markdown大纲',
        };
        const evaluation = evaluateArtifactContract(contract, evidence);
        const telemetry = buildArtifactTelemetry(contract, evidence, evaluation);

        expect(evaluation.passed).toBe(false);
        expect(telemetry.requirementResults.some(r => r.passed === false && r.strictness === 'hard')).toBe(true);
    });

    test('extracts and evaluates keyword requirements', () => {
        const contract = buildArtifactContract('请写报告，关键词: AI, 环卫, 2026');
        const evaluation = evaluateArtifactContract(contract, {
            files: [],
            toolsUsed: ['write_to_file'],
            outputText: '本报告聚焦AI在环卫行业的2026年发展趋势。',
        });

        expect(evaluation.warnings.length).toBe(0);
    });

    test('extracts and evaluates tool call requirements', () => {
        const contract = buildArtifactContract('请先搜索再写入文件，先搜索相关资料再输出结果');
        const evaluation = evaluateArtifactContract(contract, {
            files: ['result.md'],
            toolsUsed: ['write_to_file'],
            outputText: '输出内容',
        });

        expect(evaluation.warnings.some(w => w.includes('缺少关键工具调用'))).toBe(true);
    });
});
