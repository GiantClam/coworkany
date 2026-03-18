import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    analyzeWorkRequest,
    buildExecutionPlan,
    freezeWorkRequest,
} from '../src/orchestration/workRequestAnalyzer';
import {
    appendPlanningProgressEntry,
    ensurePlanningFilesForWorkRequest,
    updatePlanningStepStatus,
} from '../src/orchestration/planningFiles';

const tempDirs: string[] = [];

function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-planning-files-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('planning files orchestration', () => {
    test('creates and seeds planning files for complex work requests', () => {
        const workspacePath = makeTempDir();
        const frozen = freezeWorkRequest(analyzeWorkRequest({
            sourceText: '帮我规划并拆分一个多步实现方案，包含架构、测试和验收标准',
            workspacePath,
        }));
        const plan = buildExecutionPlan(frozen);

        const result = ensurePlanningFilesForWorkRequest({ request: frozen, plan });
        expect(result).toBeTruthy();

        const taskPlan = fs.readFileSync(path.join(workspacePath, '.coworkany', 'task_plan.md'), 'utf-8');
        const findings = fs.readFileSync(path.join(workspacePath, '.coworkany', 'findings.md'), 'utf-8');
        const progress = fs.readFileSync(path.join(workspacePath, '.coworkany', 'progress.md'), 'utf-8');

        expect(taskPlan).toContain(`**Work Request ID**: ${frozen.id}`);
        expect(taskPlan).toContain('Step 3:');
        expect(taskPlan).toContain('Step 5:');
        expect(findings).toContain('# Findings');
        expect(progress).toContain('Initialized control-plane plan');
    });

    test('updates persisted step state and progress entries as execution advances', () => {
        const workspacePath = makeTempDir();
        const frozen = freezeWorkRequest(analyzeWorkRequest({
            sourceText: '帮我规划并拆分一个多步实现方案，包含架构、测试和验收标准',
            workspacePath,
        }));
        const plan = buildExecutionPlan(frozen);
        ensurePlanningFilesForWorkRequest({ request: frozen, plan });

        updatePlanningStepStatus({
            workspacePath,
            stepNumber: 3,
            status: 'in_progress',
            note: 'Execution started for test plan.',
        });
        updatePlanningStepStatus({
            workspacePath,
            stepNumber: 3,
            status: 'completed',
        });
        appendPlanningProgressEntry(workspacePath, 'Execution completed for test plan.');

        const taskPlan = fs.readFileSync(path.join(workspacePath, '.coworkany', 'task_plan.md'), 'utf-8');
        const progress = fs.readFileSync(path.join(workspacePath, '.coworkany', 'progress.md'), 'utf-8');

        expect(taskPlan).toContain('Step 3:');
        expect(taskPlan).toContain('(completed)');
        expect(progress).toContain('Execution started for test plan.');
        expect(progress).toContain('Execution completed for test plan.');
    });
});
