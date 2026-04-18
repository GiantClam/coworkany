import { describe, expect, test } from 'bun:test';
import { deriveFallbackOutputContent, derivePathScopedFallbackOutputContent } from '../src/ipc/outputMaterializer';

describe('outputMaterializer', () => {
    test('materializes valid JSON from fenced code blocks', () => {
        const assistantText = [
            'Done. Output below:',
            '```json',
            '{"selected_items":["water"],"total_value":6}',
            '```',
        ].join('\n');
        const content = deriveFallbackOutputContent('/tmp/workspace/solution.json', assistantText);
        expect(content).toBe('{\n  "selected_items": [\n    "water"\n  ],\n  "total_value": 6\n}\n');
    });

    test('refuses narrative fallback for JSON outputs', () => {
        const assistantText = [
            '# 执行降级交付（超时保护）',
            '已按任务要求准备交付文件。',
            '降级原因：Error: stream_idle_timeout:10000',
        ].join('\n');
        const content = deriveFallbackOutputContent('/tmp/workspace/task_plan.json', assistantText);
        expect(content).toBeNull();
    });

    test('extracts fenced python source for code outputs', () => {
        const assistantText = [
            'Implemented CLI:',
            '```python',
            'def main():',
            "    print('ok')",
            '```',
        ].join('\n');
        const content = deriveFallbackOutputContent('/tmp/workspace/tasknote.py', assistantText);
        expect(content).toBe("def main():\n    print('ok')\n");
    });

    test('avoids writing narrative summaries into txt outputs', () => {
        const assistantText = [
            'Completed.',
            '- Output file created',
            '- absolute path: /tmp/workspace/result.txt',
        ].join('\n');
        const content = deriveFallbackOutputContent('/tmp/workspace/result.txt', assistantText);
        expect(content).toBeNull();
    });

    test('allows plain non-narrative text for txt outputs', () => {
        const assistantText = '2025-01-15\nContact: support@newdomain.com\n[ ] TODO converted';
        const content = deriveFallbackOutputContent('/tmp/workspace/result.txt', assistantText);
        expect(content).toBe(`${assistantText}\n`);
    });

    test('refuses degraded timeout fallback content for markdown outputs', () => {
        const assistantText = [
            '# 执行降级交付（超时保护）',
            '',
            '上游模型在最终综合阶段超时。',
            '降级原因：stream_required_output_timeout:120000',
            '建议：可直接重试本任务。',
        ].join('\n');
        const content = deriveFallbackOutputContent('/tmp/workspace/debate/round1.md', assistantText);
        expect(content).toBeNull();
    });

    test('keeps normal markdown output for markdown targets', () => {
        const assistantText = [
            '# Debate Summary',
            '',
            'The pro position favors adopting a staged rollout with strict metrics.',
            'The con position warns about hidden integration overhead and support risk.',
            'A balanced recommendation is to run a scoped pilot, define rollback rules,',
            'and require explicit success criteria before full deployment.',
        ].join('\n');
        const content = deriveFallbackOutputContent('/tmp/workspace/debate/summary.md', assistantText);
        expect(content).toBe(`${assistantText}\n`);
    });

    test('rejects one-line placeholder markdown output', () => {
        const assistantText = 'Implemented.';
        const content = deriveFallbackOutputContent('/tmp/workspace/debate/pro_argument.md', assistantText);
        expect(content).toBeNull();
    });

    test('materializes path-scoped fenced blocks for multi-file markdown outputs', () => {
        const assistantText = [
            'FILE: /tmp/workspace/debate/pro_argument.md',
            '```md',
            '# Pro Argument',
            '',
            'Adopting the plan now improves delivery reliability, concentrates ownership,',
            'and reduces hidden integration risk by enforcing staged milestones and',
            'explicit rollback gates. It also improves operational transparency because',
            'metrics are defined early and reviewed before each phase expansion.',
            '```',
            '',
            'FILE: /tmp/workspace/debate/con_argument.md',
            '```md',
            '# Con Argument',
            '',
            'Shipping the plan immediately may lock the team into premature process',
            'overhead, constrain experimentation, and increase coordination burden.',
            'The policy-first approach can delay product learning, slow iteration speed,',
            'and mask simpler alternatives that deliver similar value with less friction.',
            '```',
        ].join('\n');
        const proContent = derivePathScopedFallbackOutputContent('/tmp/workspace/debate/pro_argument.md', assistantText);
        const conContent = derivePathScopedFallbackOutputContent('/tmp/workspace/debate/con_argument.md', assistantText);
        expect(proContent).toContain('# Pro Argument');
        expect(conContent).toContain('# Con Argument');
    });

    test('rejects path-scoped refusal/status content for markdown outputs', () => {
        const assistantText = [
            'FILE: /tmp/workspace/pipeline/stage1_log.md',
            '```md',
            'I can’t complete this request in the current turn because I don’t have active tool execution access.',
            '```',
        ].join('\n');
        const content = derivePathScopedFallbackOutputContent('/tmp/workspace/pipeline/stage1_log.md', assistantText);
        expect(content).toBeNull();
    });

    test('matches workspace-relative FILE paths against absolute required output paths', () => {
        const assistantText = [
            'FILE: workspace/orchestration/task_plan.json',
            '```json',
            '{"project_name":"TaskNote CLI","sub_tasks":[{"id":"task-1","owner":"backend"}]}',
            '```',
        ].join('\n');
        const content = derivePathScopedFallbackOutputContent(
            '/tmp/claw/tasks/mag-004/workspace/gpt-5.3-codex_run0/orchestration/task_plan.json',
            assistantText,
        );
        expect(content).toContain('"project_name": "TaskNote CLI"');
    });

    test('parses path-scoped blocks when FILE marker and fence are on the same line', () => {
        const assistantText = [
            'FILE: /tmp/workspace/orchestration/task_plan.json```json',
            '{"project_name":"TaskNote CLI","sub_tasks":[{"id":"task-1","owner":"backend"}]}',
            '```',
        ].join('\n');
        const content = derivePathScopedFallbackOutputContent(
            '/tmp/workspace/orchestration/task_plan.json',
            assistantText,
        );
        expect(content).toContain('"project_name": "TaskNote CLI"');
    });

    test('does not materialize whole path-scoped manifest text into markdown fallback files', () => {
        const assistantText = [
            'FILE: /tmp/workspace/orchestration/task_plan.json',
            '```json',
            '{"project_name":"TaskNote CLI","sub_tasks":[]}',
            '```',
            'FILE: /tmp/workspace/orchestration/integration_log.md',
            '```md',
            '# Integration Log',
            '',
            'Backend, test, and docs outputs were merged and verified with acceptance checks.',
            '```',
        ].join('\n');
        const content = deriveFallbackOutputContent('/tmp/workspace/orchestration/integration_log.md', assistantText);
        expect(content).toBeNull();
    });

    test('normalizes csv date columns and drops rows with invalid dates', () => {
        const assistantText = [
            'FILE: /tmp/workspace/pipeline/stage1_clean.csv',
            '```csv',
            'date,amount,region',
            '2024-01-03,120.5,East',
            'unknown,88.0,West',
            '2024/02/10,99.9,South',
            '```',
        ].join('\n');
        const content = derivePathScopedFallbackOutputContent('/tmp/workspace/pipeline/stage1_clean.csv', assistantText);
        expect(content).toContain('2024-01-03,120.5,East');
        expect(content).toContain('2024-02-10,99.9,South');
        expect(content).not.toContain('unknown,88.0,West');
    });

    test('adds summary aliases for stats-like json payloads', () => {
        const assistantText = [
            'FILE: /tmp/workspace/pipeline/stage3_stats.json',
            '```json',
            '{"amount_summary":{"count":32,"sum":8270.5,"mean":258.45},"by_quarter":[{"quarter":"Q1","total":3100}]}',
            '```',
        ].join('\n');
        const content = derivePathScopedFallbackOutputContent('/tmp/workspace/pipeline/stage3_stats.json', assistantText);
        expect(content).toContain('"summary"');
        expect(content).toContain('"amount"');
        expect(content).toContain('"total"');
    });

    test('normalizes aggregate-shaped json arrays into summary objects', () => {
        const assistantText = [
            'FILE: /tmp/workspace/pipeline/stage3_stats.json',
            '```json',
            '[{"region":"South","total":2237.5},{"region":"West","total":2215}]',
            '```',
        ].join('\n');
        const content = derivePathScopedFallbackOutputContent('/tmp/workspace/pipeline/stage3_stats.json', assistantText);
        expect(content).toContain('"summary"');
        expect(content).toContain('"total"');
        expect(content).toContain('"entries"');
    });

    test('repairs concatenated python top-level definitions before materialization', () => {
        const assistantText = [
            'FILE: /tmp/workspace/project/main.py',
            '```python',
            'def next_id(tasks):',
            '    return max((t.get("id", 0) for t in tasks), default=0) +1def find_task(tasks, task_id):',
            '    return None',
            '```',
        ].join('\n');
        const content = derivePathScopedFallbackOutputContent('/tmp/workspace/project/main.py', assistantText);
        expect(content).toContain('+1\n');
        expect(content).toContain('def find_task(tasks, task_id):');
    });
});
