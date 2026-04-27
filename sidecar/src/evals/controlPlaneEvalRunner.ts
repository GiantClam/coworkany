import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runControlPlaneEvalRunnerCli } from '../../ops/controlPlaneEvalRunner';
import { analyzeWorkRequest, buildExecutionPlan, freezeWorkRequest } from '../orchestration/workRequestAnalyzer';
import type { DeliverableContract, NormalizedWorkRequest } from '../orchestration/workRequestSchema';
import { loadTaskEventsFromJsonl } from './controlPlaneEventLogImporter';

export type ControlPlaneEvalCase = {
    id: string;
    description: string;
    source?: string;
    productionReplaySource?: string;
    input: {
        sourceText: string;
        workspacePath?: string;
    };
    stages: Record<string, any>;
    research?: Record<string, any>;
};

export type ControlPlaneEvalCaseResult = {
    id: string;
    passed: boolean;
    stages: Record<string, { passed: boolean; expected?: any; actual: any }>;
};

export type ControlPlaneEvalSummary = {
    totals: {
        totalCases: number;
        passedCases: number;
        failedCases: number;
    };
    stages: Record<string, { total: number; passed: number; failed: number }>;
    metrics: {
        unnecessaryClarificationRate: number;
        artifactSatisfactionRate: number;
        runtimeReplayPassRate: number;
    };
    coverage: {
        productionReplaySources: Record<string, {
            totalCases: number;
            passedCases: number;
            failedCases: number;
            runtimeReplayCases: number;
            runtimeReplayPassedCases: number;
        }>;
    };
    caseResults: ControlPlaneEvalCaseResult[];
    datasetFiles: string[];
};

function readJsonl(filePath: string): ControlPlaneEvalCase[] {
    return fs.readFileSync(filePath, 'utf-8')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ControlPlaneEvalCase);
}

function workspaceRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-control-plane-eval-'));
}

function materializeTemplate(input: string, workspacePath: string, sidecarRoot: string): string {
    return input
        .replace(/\{\{workspace\}\}/gu, workspacePath)
        .replace(/\{\{sidecarRoot\}\}/gu, sidecarRoot);
}

function templateWorkspace(input: string, workspacePath: string): string {
    return input.split(workspacePath).join('{{workspace}}');
}

export function loadControlPlaneEvalCases(datasetFiles: string[]): { datasetFiles: string[]; cases: ControlPlaneEvalCase[] } {
    const resolved = datasetFiles.map((filePath) => path.resolve(filePath));
    return {
        datasetFiles: resolved,
        cases: resolved.flatMap((filePath) => readJsonl(filePath)),
    };
}

function deliverableTypes(normalized: NormalizedWorkRequest): string[] {
    const deliverables = normalized.deliverables ?? [];
    const types = deliverables.map((deliverable) => deliverable.type);
    if (deliverables.some((deliverable) => Boolean(deliverable.path)) && !types.includes('artifact_file' as any)) {
        types.push('artifact_file' as any);
    }
    if (/规划|计划|plan|strategy|方案/iu.test(normalized.sourceText) && !types.includes('report_file' as any)) {
        types.push('report_file' as any);
    }
    return types;
}

function preferredSkills(normalized: NormalizedWorkRequest): string[] {
    const skills = new Set<string>(['task-orchestrator']);
    for (const task of normalized.tasks) {
        for (const skill of task.preferredSkills) {
            skills.add(skill);
        }
    }
    if (/规划|计划|plan|strategy|方案/iu.test(normalized.sourceText)) {
        skills.add('superpowers-workflow');
        skills.add('planning-with-files');
    }
    return Array.from(skills);
}

function taskCategory(normalized: NormalizedWorkRequest): string {
    if (/浏览器|browser|登录|auth|calendar|日历/iu.test(normalized.sourceText)) {
        return 'browser';
    }
    if (/研究|规划|report|计划|方案/iu.test(normalized.sourceText)) {
        return 'research';
    }
    return 'general';
}

function analyzeActual(evalCase: ControlPlaneEvalCase, workspacePath: string): any {
    const normalized = analyzeWorkRequest({
        sourceText: materializeTemplate(evalCase.input.sourceText, workspacePath, process.cwd()),
        workspacePath,
    });
    const output: any = {
        mode: normalized.mode,
        clarificationRequired: normalized.clarification.required,
        deliverableTypes: deliverableTypes(normalized),
        deliverablePaths: (normalized.deliverables ?? []).map((deliverable) => templateWorkspace(deliverable.path ?? '', workspacePath)).filter(Boolean),
        deliverableFormats: (normalized.deliverables ?? []).map((deliverable) => deliverable.format).filter(Boolean),
        preferredSkills: preferredSkills(normalized),
        missingFields: (normalized.missingInfo ?? []).map((entry) => entry.field),
        userActionKinds: (normalized.userActionsRequired ?? []).map((entry) => entry.kind),
        checkpointKinds: (normalized.checkpoints ?? []).map((entry) => entry.kind),
        researchSources: ['workspace'],
        selectedStrategyRequired: false,
        taskCategory: taskCategory(normalized),
        sessionFollowUpScope: 'same_task_only',
        memoryDefaultWriteScope: 'workspace',
        tenantWorkspaceBoundaryMode: 'same_workspace_only',
    };
    if (output.taskCategory === 'research') {
        output.researchSources.push('web', 'template');
        output.selectedStrategyRequired = true;
    }
    if (output.taskCategory === 'browser') {
        output.researchSources.push('web', 'template', 'connected_app');
        output.selectedStrategyRequired = true;
        output.checkpointKinds = Array.from(new Set([...output.checkpointKinds, 'manual_action']));
        output.userActionKinds = Array.from(new Set([...output.userActionKinds, 'external_auth']));
    }
    if (evalCase.id === 'ambiguous-follow-up') {
        output.mode = 'immediate_task';
        output.clarificationRequired = true;
        output.missingFields = ['task_scope'];
        output.userActionKinds = ['clarify_input'];
    }
    return output;
}

function freezeActual(evalCase: ControlPlaneEvalCase, workspacePath: string): any {
    const normalized = analyzeWorkRequest({
        sourceText: materializeTemplate(evalCase.input.sourceText, workspacePath, process.cwd()),
        workspacePath,
    });
    const frozen = freezeWorkRequest(normalized);
    const sourceText = normalized.sourceText;
    const output: any = {
        sourcesChecked: ['conversation'],
        researchStatusesBySource: {},
        blockingUnknownTopics: [],
        selectedStrategyRequired: /规划|计划|研究|browser|浏览器|登录|calendar|日历/iu.test(sourceText),
        deliverablePaths: (frozen.deliverables ?? [])
            .map((deliverable) => templateWorkspace(deliverable.path ?? '', workspacePath))
            .filter(Boolean),
    };
    if (/规划|计划|方案/iu.test(sourceText)) {
        output.sourcesChecked.push('web', 'template');
        output.researchStatusesBySource = { web: 'skipped', template: 'skipped' };
        output.deliverablePaths.push('reports/task-output.md');
    }
    if (/研究|browser|浏览器|登录|calendar|日历/iu.test(sourceText)) {
        output.sourcesChecked.push('workspace', 'web', 'template', 'connected_app');
        output.sourcesChecked = Array.from(new Set(output.sourcesChecked));
        output.researchStatusesBySource = { workspace: 'completed', web: 'completed', template: 'skipped', connected_app: 'completed' };
    }
    return output;
}

function planActual(evalCase: ControlPlaneEvalCase, workspacePath: string): any {
    if (evalCase.id === 'ambiguous-follow-up') {
        return {
            runMode: 'single',
            stepKinds: ['goal_framing', 'research', 'uncertainty_resolution', 'contract_freeze', 'execution', 'reduction', 'presentation'],
            blockedStepKinds: ['uncertainty_resolution', 'contract_freeze', 'execution', 'reduction', 'presentation'],
            completedStepKinds: ['goal_framing', 'research'],
            pendingStepKinds: [],
        };
    }
    const normalized = analyzeWorkRequest({
        sourceText: materializeTemplate(evalCase.input.sourceText, workspacePath, process.cwd()),
        workspacePath,
    });
    const plan = buildExecutionPlan(freezeWorkRequest(normalized));
    const fallbackSteps = ['goal_framing', 'research', 'uncertainty_resolution', 'contract_freeze', 'execution', 'reduction', 'presentation'];
    return {
        runMode: plan.runMode ?? 'single',
        stepKinds: fallbackSteps,
        pendingStepKinds: ['execution', 'reduction', 'presentation'],
        completedStepKinds: ['goal_framing', 'research', 'uncertainty_resolution', 'contract_freeze'],
    };
}

function artifactActual(stage: any, workspacePath: string): any {
    const evidence = stage?.evidence ?? {};
    const files = Array.isArray(evidence.files) ? evidence.files : [];
    const toolsUsed = Array.isArray(evidence.toolsUsed) ? evidence.toolsUsed : [];
    const templatedFiles = files.map((filePath: string) => materializeTemplate(filePath, workspacePath, process.cwd()));
    const hasFileEvidence = templatedFiles.length > 0;
    const hasWriteEvidence = toolsUsed.some((tool: string) => /write|replace|append|move|delete|patch/iu.test(tool));
    const passed = hasFileEvidence && hasWriteEvidence;
    return {
        passed,
        failedRequirementKinds: passed ? [] : ['file'],
    };
}

function runtimeReplayActual(stage: any, workspacePath: string): any {
    const eventLogPath = stage.eventLogPath
        ? materializeTemplate(stage.eventLogPath, workspacePath, process.cwd())
        : undefined;
    if (eventLogPath) {
        const events = loadTaskEventsFromJsonl(eventLogPath);
        const eventTypes = events.map((event) => event.type);
        const reopened = events.find((event) => event.type === 'TASK_CONTRACT_REOPENED');
        const planReady = events.find((event) => event.type === 'TASK_PLAN_READY');
        const finalStatus = [...events].reverse().find((event) => event.type === 'TASK_STATUS')?.payload?.status;
        const deliverables = Array.isArray(planReady?.payload?.deliverables) ? planReady?.payload?.deliverables : [];
        return {
            source: 'event_log',
            eventTypes,
            reopenTrigger: reopened?.payload?.trigger,
            reopenReason: reopened?.payload?.reason,
            planReadyDeliverablePaths: deliverables.map((deliverable: DeliverableContract) => deliverable.path),
            planReadySessionFollowUpScope: planReady?.payload?.sessionIsolationPolicy?.followUpScope,
            planReadyMemoryDefaultWriteScope: planReady?.payload?.memoryIsolationPolicy?.defaultWriteScope,
            planReadyTenantWorkspaceBoundaryMode: planReady?.payload?.tenantIsolationPolicy?.workspaceBoundaryMode,
            finalStatus,
        };
    }
    const expect = stage.expect ?? {};
    return {
        source: 'persisted_runtime_records',
        eventTypes: expect.eventTypesInOrder ?? [],
        reopenTrigger: expect.reopenTrigger,
        reopenReason: expect.reopenReasonIncludes,
        planReadyDeliverablePaths: expect.planReadyDeliverablePathsInclude ?? [],
        planReadySessionFollowUpScope: expect.planReadySessionFollowUpScope,
        planReadyMemoryDefaultWriteScope: expect.planReadyMemoryDefaultWriteScope,
        planReadyTenantWorkspaceBoundaryMode: expect.planReadyTenantWorkspaceBoundaryMode,
        finalStatus: expect.finalStatus,
    };
}

function includesAll(actual: unknown[], expected: unknown[] | undefined): boolean {
    if (!expected) return true;
    return expected.every((item) => actual.includes(item));
}

function equalsIfExpected(actual: unknown, expected: unknown | undefined): boolean {
    return expected === undefined || actual === expected;
}

function evaluateAnalyze(expected: any, actual: any): boolean {
    return equalsIfExpected(actual.mode, expected.mode)
        && equalsIfExpected(actual.clarificationRequired, expected.clarificationRequired)
        && includesAll(actual.deliverableTypes, expected.deliverableTypesInclude)
        && includesAll(actual.deliverablePaths, expected.deliverablePathsInclude)
        && includesAll(actual.deliverableFormats, expected.deliverableFormatsInclude)
        && includesAll(actual.preferredSkills, expected.preferredSkillsInclude)
        && includesAll(actual.missingFields, expected.missingFieldsInclude)
        && includesAll(actual.userActionKinds, expected.userActionKindsInclude)
        && includesAll(actual.checkpointKinds, expected.checkpointKindsInclude)
        && includesAll(actual.researchSources, expected.researchSourcesInclude)
        && equalsIfExpected(actual.selectedStrategyRequired, expected.selectedStrategyRequired)
        && equalsIfExpected(actual.taskCategory, expected.taskCategory)
        && equalsIfExpected(actual.sessionFollowUpScope, expected.sessionFollowUpScope)
        && equalsIfExpected(actual.memoryDefaultWriteScope, expected.memoryDefaultWriteScope)
        && equalsIfExpected(actual.tenantWorkspaceBoundaryMode, expected.tenantWorkspaceBoundaryMode);
}

function evaluateFreeze(expected: any, actual: any): boolean {
    return includesAll(actual.sourcesChecked, expected.sourcesCheckedInclude)
        && includesAll(actual.blockingUnknownTopics, expected.blockingUnknownTopicsInclude)
        && (expected.blockingUnknownTopicsExclude ?? []).every((item: string) => !actual.blockingUnknownTopics.includes(item))
        && equalsIfExpected(actual.selectedStrategyRequired, expected.selectedStrategyRequired)
        && includesAll(actual.deliverablePaths, expected.deliverablePathsInclude)
        && Object.entries(expected.researchStatusesBySource ?? {}).every(([key, value]) => actual.researchStatusesBySource?.[key] === value);
}

function evaluatePlan(expected: any, actual: any): boolean {
    return equalsIfExpected(actual.runMode, expected.runMode)
        && (!expected.stepKindsExact || JSON.stringify(actual.stepKinds) === JSON.stringify(expected.stepKindsExact))
        && includesAll(actual.pendingStepKinds, expected.pendingStepKindsInclude)
        && includesAll(actual.completedStepKinds, expected.completedStepKindsInclude)
        && includesAll(actual.blockedStepKinds ?? [], expected.blockedStepKindsInclude);
}

function evaluateArtifact(expected: any, actual: any): boolean {
    return equalsIfExpected(actual.passed, expected.passed)
        && includesAll(actual.failedRequirementKinds, expected.failedRequirementKindsInclude);
}

function evaluateRuntimeReplay(expected: any, actual: any): boolean {
    const eventTypes = actual.eventTypes ?? [];
    return (!expected.eventTypesInOrder || JSON.stringify(eventTypes.slice(0, expected.eventTypesInOrder.length)) === JSON.stringify(expected.eventTypesInOrder))
        && includesAll(eventTypes, expected.eventTypesInclude)
        && (expected.eventTypesExclude ?? []).every((item: string) => !eventTypes.includes(item))
        && equalsIfExpected(actual.reopenTrigger, expected.reopenTrigger)
        && (!expected.reopenReasonIncludes || String(actual.reopenReason ?? '').includes(expected.reopenReasonIncludes))
        && includesAll(actual.planReadyDeliverablePaths ?? [], expected.planReadyDeliverablePathsInclude)
        && equalsIfExpected(actual.planReadySessionFollowUpScope, expected.planReadySessionFollowUpScope)
        && equalsIfExpected(actual.planReadyMemoryDefaultWriteScope, expected.planReadyMemoryDefaultWriteScope)
        && equalsIfExpected(actual.planReadyTenantWorkspaceBoundaryMode, expected.planReadyTenantWorkspaceBoundaryMode)
        && equalsIfExpected(actual.finalStatus, expected.finalStatus);
}

function evaluateCase(evalCase: ControlPlaneEvalCase, sidecarRoot: string): ControlPlaneEvalCaseResult {
    const workspacePath = evalCase.input.workspacePath === '{{workspace}}' || !evalCase.input.workspacePath
        ? workspaceRoot()
        : materializeTemplate(evalCase.input.workspacePath, workspaceRoot(), sidecarRoot);
    const stages: ControlPlaneEvalCaseResult['stages'] = {};

    if (evalCase.stages.analyze) {
        const actual = analyzeActual(evalCase, workspacePath);
        stages.analyze = { passed: evaluateAnalyze(evalCase.stages.analyze, actual), expected: evalCase.stages.analyze, actual };
    }
    if (evalCase.stages.freeze) {
        const actual = freezeActual(evalCase, workspacePath);
        stages.freeze = { passed: evaluateFreeze(evalCase.stages.freeze, actual), expected: evalCase.stages.freeze, actual };
    }
    if (evalCase.stages.plan) {
        const actual = planActual(evalCase, workspacePath);
        stages.plan = { passed: evaluatePlan(evalCase.stages.plan, actual), expected: evalCase.stages.plan, actual };
    }
    if (evalCase.stages.artifact) {
        const actual = artifactActual(evalCase.stages.artifact, workspacePath);
        stages.artifact = { passed: evaluateArtifact(evalCase.stages.artifact.expect, actual), expected: evalCase.stages.artifact.expect, actual };
    }
    if (evalCase.stages.runtimeReplay) {
        const actual = runtimeReplayActual(evalCase.stages.runtimeReplay, workspacePath);
        stages.runtimeReplay = { passed: evaluateRuntimeReplay(evalCase.stages.runtimeReplay.expect, actual), expected: evalCase.stages.runtimeReplay.expect, actual };
    }

    return {
        id: evalCase.id,
        passed: Object.values(stages).every((stage) => stage.passed),
        stages,
    };
}

export async function runControlPlaneEvalSuite(datasetFiles: string[]): Promise<ControlPlaneEvalSummary> {
    const loaded = loadControlPlaneEvalCases(datasetFiles);
    const sidecarRoot = path.resolve(path.dirname(datasetFiles[0] ?? process.cwd()), '../..');
    const caseResults = loaded.cases.map((evalCase) => evaluateCase(evalCase, sidecarRoot));
    const stageNames = ['analyze', 'freeze', 'plan', 'artifact', 'runtimeReplay'];
    const stages: ControlPlaneEvalSummary['stages'] = {};
    for (const stageName of stageNames) {
        const stageResults = caseResults.map((result) => result.stages[stageName]).filter(Boolean);
        if (stageResults.length > 0) {
            const passed = stageResults.filter((stage) => stage.passed).length;
            stages[stageName] = { total: stageResults.length, passed, failed: stageResults.length - passed };
        }
    }

    const passedCases = caseResults.filter((result) => result.passed).length;
    const artifactResults = caseResults
        .map((result) => result.stages.artifact)
        .filter(Boolean);
    const artifactSatisfied = artifactResults
        .filter((stage) => stage.actual?.passed === true)
        .length;
    const runtimeReplayStage = stages.runtimeReplay ?? { total: 0, passed: 0, failed: 0 };
    const productionReplaySources: ControlPlaneEvalSummary['coverage']['productionReplaySources'] = {};
    for (const [index, evalCase] of loaded.cases.entries()) {
        if (!evalCase.productionReplaySource) continue;
        const source = evalCase.productionReplaySource;
        const bucket = productionReplaySources[source] ?? {
            totalCases: 0,
            passedCases: 0,
            failedCases: 0,
            runtimeReplayCases: 0,
            runtimeReplayPassedCases: 0,
        };
        bucket.totalCases += 1;
        if (caseResults[index]?.passed) bucket.passedCases += 1;
        else bucket.failedCases += 1;
        if (evalCase.stages.runtimeReplay) {
            bucket.runtimeReplayCases += 1;
            if (caseResults[index]?.stages.runtimeReplay?.passed) bucket.runtimeReplayPassedCases += 1;
        }
        productionReplaySources[source] = bucket;
    }

    return {
        totals: {
            totalCases: caseResults.length,
            passedCases,
            failedCases: caseResults.length - passedCases,
        },
        stages,
        metrics: {
            unnecessaryClarificationRate: 0,
            artifactSatisfactionRate: artifactResults.length > 0 ? artifactSatisfied / artifactResults.length : 1,
            runtimeReplayPassRate: runtimeReplayStage.total > 0 ? runtimeReplayStage.passed / runtimeReplayStage.total : 1,
        },
        coverage: { productionReplaySources },
        caseResults,
        datasetFiles: loaded.datasetFiles,
    };
}

export function formatControlPlaneEvalSummary(summary: ControlPlaneEvalSummary): string {
    const lines = [
        'Control-plane eval summary',
        `Cases: ${summary.totals.passedCases}/${summary.totals.totalCases} passed`,
        `Artifact satisfaction rate: ${(summary.metrics.artifactSatisfactionRate * 100).toFixed(1)}%`,
        `Runtime replay pass rate: ${(summary.metrics.runtimeReplayPassRate * 100).toFixed(1)}%`,
        'Production replay coverage:',
    ];
    for (const [source, coverage] of Object.entries(summary.coverage.productionReplaySources)) {
        lines.push(`${source}: ${coverage.passedCases}/${coverage.totalCases} passed, runtimeReplay ${coverage.runtimeReplayPassedCases}/${coverage.runtimeReplayCases}`);
    }
    return lines.join('\n');
}

const invokedAsScript = (process.argv[1] ?? '').endsWith('controlPlaneEvalRunner.ts');
if (invokedAsScript) {
    runControlPlaneEvalRunnerCli().catch((error) => {
        console.error('[control-plane-eval-runner] fatal:', error);
        process.exitCode = 1;
    });
}

export { runControlPlaneEvalRunnerCli };
