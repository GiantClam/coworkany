import { describe, expect, test } from 'bun:test';
import { extractExplicitOutputPaths, injectOutputPathContract } from '../src/ipc/outputContract';

describe('output contract extraction', () => {
    test('extracts explicit output path from write-to clauses', () => {
        const message = [
            'Task: Form Field Inventory',
            '4. Write to `/tmp/task/workspace/form_fields.json` as an array of field objects.',
            'Save the form field inventory to `/tmp/task/workspace/form_fields.json`.',
        ].join('\n');
        expect(extractExplicitOutputPaths(message)).toEqual([
            '/tmp/task/workspace/form_fields.json',
        ]);
    });

    test('extracts multiple output paths from create clauses', () => {
        const message = [
            'Create `workspace/resolved.txt` and `workspace/conflicts.json`.',
            'Keep paths exact.',
        ].join('\n');
        expect(extractExplicitOutputPaths(message)).toEqual([
            'workspace/resolved.txt',
            'workspace/conflicts.json',
        ]);
    });

    test('extracts output paths for Chinese write cues without explicit prepositions', () => {
        const message = '读取 `workspace/form.html` 后，写入 workspace/form_fields.json。';
        expect(extractExplicitOutputPaths(message)).toEqual([
            'workspace/form_fields.json',
        ]);
    });

    test('trims natural-language tail after Chinese punctuation in output paths', () => {
        const message = '请写入 /tmp/bubble_sort.py，然后运行它验证结果。';
        expect(extractExplicitOutputPaths(message)).toEqual([
            '/tmp/bubble_sort.py',
        ]);
    });

    test('trims natural-language tail after ASCII punctuation in output paths', () => {
        const message = 'Save to /tmp/report.json, then print a summary.';
        expect(extractExplicitOutputPaths(message)).toEqual([
            '/tmp/report.json',
        ]);
    });

    test('does not treat URL fragments as output paths', () => {
        const message = 'Open https://example.com, then save screenshot to ./example.com.';
        expect(extractExplicitOutputPaths(message)).toEqual([
            './example.com',
        ]);
    });

    test('ignores internal retry contract block when extracting output paths', () => {
        const message = [
            '[CoworkAny Retry Execution Contract]',
            '- Do not repeat refusal/disclaimer-only output in this retry.',
            '',
            'Write the final result to /tmp/final-result.json.',
        ].join('\n');
        expect(extractExplicitOutputPaths(message)).toEqual([
            '/tmp/final-result.json',
        ]);
    });

    test('ignores file paths that are not output cues', () => {
        const message = 'Read `workspace/form.html` and inspect `<input>` fields.';
        expect(extractExplicitOutputPaths(message)).toEqual([]);
    });

    test('does not treat directory-like tokens as output file paths', () => {
        const message = [
            'Create workspace/orchestration and then write status to workspace/orchestration/task_plan.json.',
            'Record approval status as approved/rejected in the report.',
        ].join('\n');
        expect(extractExplicitOutputPaths(message)).toEqual([
            'workspace/orchestration/task_plan.json',
        ]);
    });

    test('supports known extensionless file names', () => {
        const message = 'Create workspace/Dockerfile and save final instructions there.';
        expect(extractExplicitOutputPaths(message)).toEqual([
            'workspace/Dockerfile',
        ]);
    });

    test('ignores templated placeholder paths in output cues', () => {
        const message = [
            'Create workspace/orchestration/{role}_agent_log.md for each role.',
            'Write final merged plan to workspace/orchestration/task_plan.json.',
        ].join('\n');
        expect(extractExplicitOutputPaths(message)).toEqual([
            'workspace/orchestration/task_plan.json',
        ]);
    });

    test('expands templated role placeholder paths when explicit agent roles are listed', () => {
        const message = [
            'Required Sub-Agent Roles:',
            '- **Backend Agent** — implements core logic',
            '- **Test Agent** — validates behavior',
            '- **Docs Agent** — writes user documentation',
            'For each sub-agent, create `workspace/orchestration/{role}_agent_log.md`.',
        ].join('\n');
        expect(extractExplicitOutputPaths(message)).toEqual([
            'workspace/orchestration/backend_agent_log.md',
            'workspace/orchestration/test_agent_log.md',
            'workspace/orchestration/docs_agent_log.md',
        ]);
    });

    test('infers concrete file outputs from directory include requirements', () => {
        const message = [
            'The final project must be in `workspace/project/` and include:',
            '- Working source code (the CLI tool described in requirements.md)',
            '- Test file(s) that validate the tool',
            '- A README.md with usage instructions',
        ].join('\n');
        expect(extractExplicitOutputPaths(message)).toEqual([
            'workspace/project/main.py',
            'workspace/project/test_main.py',
            'workspace/project/README.md',
            'workspace/project/readme.md',
        ]);
    });

    test('drops likely truncated extension variants when full path exists', () => {
        const message = [
            'Write the con argument to `workspace/debate/con_argument.m`.',
            'Write the con argument to `workspace/debate/con_argument.md`.',
        ].join('\n');
        expect(extractExplicitOutputPaths(message)).toEqual([
            'workspace/debate/con_argument.md',
        ]);
    });

    test('ignores input-only path lines inside output cue windows', () => {
        const message = [
            'Produce the following files:',
            '- Input: `workspace/raw_data.csv`',
            '- Output: `workspace/report.json`',
        ].join('\n');
        expect(extractExplicitOutputPaths(message)).toEqual([
            'workspace/report.json',
        ]);
    });
});

describe('output contract injection', () => {
    test('injects contract block before original request', () => {
        const message = 'Write to `/tmp/task/workspace/form_fields.json` as an array.';
        const injected = injectOutputPathContract(message);
        expect(injected).toContain('[Output File Contract]');
        expect(injected).toContain('/tmp/task/workspace/form_fields.json');
        expect(injected).toContain('FILE: <exact path>');
        expect(injected.endsWith(message)).toBe(true);
    });

    test('does not duplicate contract block', () => {
        const message = 'Write to `workspace/result.txt`.';
        const once = injectOutputPathContract(message);
        const twice = injectOutputPathContract(once);
        expect(twice).toBe(once);
    });
});
