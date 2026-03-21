import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import {
    analyzeWorkRequest,
    buildExecutionPlan,
    buildExecutionQuery,
    freezeWorkRequest,
} from '../orchestration/workRequestAnalyzer';
import { runPreFreezeResearchLoop, type ResearchLoopOptions, type ResearchLoopResolvers } from '../orchestration/researchLoop';
import { WorkRequestStore } from '../orchestration/workRequestStore';
import type { ArtifactKind } from '../agent/artifactContract';
import { buildArtifactContract, evaluateArtifactContract } from '../agent/artifactContract';
import { TaskEventSchema, type TaskEvent } from '../protocol';
import type {
    ExecutionPlan,
    ExecutionPlanStepKind,
    FrozenWorkRequest,
    NormalizedWorkRequest,
    ResearchSource,
    WorkMode,
} from '../orchestration/workRequestSchema';

const CONTROL_PLANE_STAGE_NAMES = ['analyze', 'freeze', 'plan', 'artifact', 'runtimeReplay'] as const;

type ControlPlaneEvalStageName = typeof CONTROL_PLANE_STAGE_NAMES[number];

const workspaceEntrySchema = z.object({
    path: z.string(),
    kind: z.enum(['file', 'dir']).default('file'),
    content: z.string().optional(),
});

const analyzeExpectationSchema = z.object({
    mode: z.custom<WorkMode>().optional(),
    clarificationRequired: z.boolean().optional(),
    missingFieldsInclude: z.array(z.string()).optional(),
    missingFieldsExclude: z.array(z.string()).optional(),
    deliverableTypesInclude: z.array(z.string()).optional(),
    deliverablePathsInclude: z.array(z.string()).optional(),
    deliverableFormatsInclude: z.array(z.string()).optional(),
    checkpointKindsInclude: z.array(z.string()).optional(),
    userActionKindsInclude: z.array(z.string()).optional(),
    researchSourcesInclude: z.array(z.custom<ResearchSource>()).optional(),
    selectedStrategyRequired: z.boolean().optional(),
    taskCategory: z.string().optional(),
    preferredSkillsInclude: z.array(z.string()).optional(),
    preferredToolsInclude: z.array(z.string()).optional(),
    preferredWorkflow: z.string().optional(),
    sessionFollowUpScope: z.string().optional(),
    memoryDefaultWriteScope: z.string().optional(),
    tenantWorkspaceBoundaryMode: z.string().optional(),
});

const freezeExpectationSchema = z.object({
    sourcesCheckedInclude: z.array(z.custom<ResearchSource>()).optional(),
    researchStatusesBySource: z.record(z.string(), z.string()).optional(),
    blockingUnknownTopicsInclude: z.array(z.string()).optional(),
    blockingUnknownTopicsExclude: z.array(z.string()).optional(),
    selectedStrategyRequired: z.boolean().optional(),
    deliverablePathsInclude: z.array(z.string()).optional(),
});

const planExpectationSchema = z.object({
    runMode: z.enum(['single', 'dag']).optional(),
    stepKindsExact: z.array(z.custom<ExecutionPlanStepKind>()).optional(),
    blockedStepKindsInclude: z.array(z.custom<ExecutionPlanStepKind>()).optional(),
    pendingStepKindsInclude: z.array(z.custom<ExecutionPlanStepKind>()).optional(),
    completedStepKindsInclude: z.array(z.custom<ExecutionPlanStepKind>()).optional(),
});

const artifactEvidenceSchema = z.object({
    files: z.array(z.string()).default([]),
    toolsUsed: z.array(z.string()).default([]),
    outputText: z.string().default(''),
});

const artifactExpectationSchema = z.object({
    passed: z.boolean().optional(),
    failedRequirementKindsInclude: z.array(z.custom<ArtifactKind>()).optional(),
    warningsInclude: z.array(z.string()).optional(),
});

const persistedTaskRuntimeRecordSchema = z.object({
    taskId: z.string(),
    title: z.string(),
    workspacePath: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    status: z.enum(['running', 'suspended', 'interrupted', 'idle', 'finished', 'failed']),
    conversation: z.array(z.any()),
    config: z.record(z.any()).optional(),
    historyLimit: z.number().int().positive(),
    artifactContract: z.any().optional(),
    artifactsCreated: z.array(z.string()),
    suspension: z.object({
        reason: z.string(),
        userMessage: z.string(),
        canAutoResume: z.boolean(),
        maxWaitTimeMs: z.number().optional(),
    }).optional(),
});

const runtimeReplayExpectationSchema = z.object({
    eventTypesInOrder: z.array(z.string()).optional(),
    eventTypesInclude: z.array(z.string()).optional(),
    eventTypesExclude: z.array(z.string()).optional(),
    reopenTrigger: z.enum([
        'new_scope_signal',
        'missing_resource',
        'permission_block',
        'contradictory_evidence',
        'execution_infeasible',
    ]).optional(),
    reopenReasonIncludes: z.string().optional(),
    planReadyDeliverablePathsInclude: z.array(z.string()).optional(),
    planReadySessionFollowUpScope: z.string().optional(),
    planReadyMemoryDefaultWriteScope: z.string().optional(),
    planReadyTenantWorkspaceBoundaryMode: z.string().optional(),
    finalStatus: z.enum(['idle', 'running', 'finished', 'failed']).optional(),
});

const runtimeReplayStageSchema = z.object({
    persistedRuntimeRecords: z.array(persistedTaskRuntimeRecordSchema).default([]),
    eventLogPath: z.string().optional(),
    command: z.object({
        type: z.literal('send_task_message'),
        taskId: z.string(),
        content: z.string(),
        disabledTools: z.array(z.string()).optional(),
    }).optional(),
    startupDelayMs: z.number().int().nonnegative().optional(),
    postBootstrapDelayMs: z.number().int().nonnegative().optional(),
    timeoutMs: z.number().int().positive().optional(),
    expect: runtimeReplayExpectationSchema,
}).superRefine((value, ctx) => {
    if (!value.eventLogPath && !value.command) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'runtimeReplay requires either eventLogPath or command',
            path: ['command'],
        });
    }
    if (!value.eventLogPath && value.persistedRuntimeRecords.length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'runtimeReplay live-sidecar mode requires persistedRuntimeRecords',
            path: ['persistedRuntimeRecords'],
        });
    }
});

const controlPlaneEvalCaseSchema = z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    source: z.enum(['gold', 'production_replay']).default('gold'),
    productionReplaySource: z.string().min(1).optional(),
    input: z.object({
        sourceText: z.string().min(1),
        workspacePath: z.string().optional(),
        now: z.string().datetime().optional(),
        systemContext: z.object({
            homeDir: z.string().optional(),
            platform: z.string().optional(),
        }).optional(),
    }),
    workspace: z.object({
        entries: z.array(workspaceEntrySchema).default([]),
    }).optional(),
    research: z.object({
        webSearch: z.object({
            success: z.boolean(),
            summary: z.string(),
            resultCount: z.number().optional(),
            provider: z.string().optional(),
            error: z.string().optional(),
        }).optional(),
        connectedAppStatus: z.object({
            success: z.boolean(),
            summary: z.string(),
            connectedApps: z.array(z.string()),
            error: z.string().optional(),
        }).optional(),
        options: z.object({
            webSearchTimeoutMs: z.number().int().positive().optional(),
            connectedAppTimeoutMs: z.number().int().positive().optional(),
        }).optional(),
    }).optional(),
    stages: z.object({
        analyze: analyzeExpectationSchema.optional(),
        freeze: freezeExpectationSchema.optional(),
        plan: planExpectationSchema.optional(),
        artifact: z.object({
            evidence: artifactEvidenceSchema,
            expect: artifactExpectationSchema,
        }).optional(),
        runtimeReplay: runtimeReplayStageSchema.optional(),
    }).default({}),
});

export type ControlPlaneEvalCase = z.infer<typeof controlPlaneEvalCaseSchema>;

export type ControlPlaneEvalAnalyzeActual = {
    mode: WorkMode;
    clarificationRequired: boolean;
    missingFields: string[];
    deliverableTypes: string[];
    deliverablePaths: string[];
    deliverableFormats: string[];
    checkpointKinds: string[];
    userActionKinds: string[];
    researchSources: ResearchSource[];
    selectedStrategyPresent: boolean;
    taskCategory?: string;
    preferredSkills: string[];
    preferredTools: string[];
    preferredWorkflow?: string;
    sessionFollowUpScope?: string;
    memoryDefaultWriteScope?: string;
    tenantWorkspaceBoundaryMode?: string;
};

export type ControlPlaneEvalFreezeActual = {
    sourcesChecked: ResearchSource[];
    researchStatusesBySource: Record<string, string>;
    blockingUnknownTopics: string[];
    selectedStrategyPresent: boolean;
    deliverablePaths: string[];
};

export type ControlPlaneEvalPlanActual = {
    runMode: ExecutionPlan['runMode'];
    stepKinds: ExecutionPlanStepKind[];
    blockedStepKinds: ExecutionPlanStepKind[];
    pendingStepKinds: ExecutionPlanStepKind[];
    completedStepKinds: ExecutionPlanStepKind[];
};

export type ControlPlaneEvalArtifactActual = {
    passed: boolean;
    failedRequirementKinds: ArtifactKind[];
    warnings: string[];
};

export type ControlPlaneEvalRuntimeReplayActual = {
    validatedEventCount: number;
    eventTypes: string[];
    source: 'live_sidecar' | 'event_log';
    reopenTrigger?: string;
    reopenReason?: string;
    planReadyDeliverablePaths: string[];
    planReadySessionFollowUpScope?: string;
    planReadyMemoryDefaultWriteScope?: string;
    planReadyTenantWorkspaceBoundaryMode?: string;
    finalStatus?: string;
};

export type ControlPlaneEvalStageResult<TActual> = {
    passed: boolean;
    mismatches: string[];
    actual: TActual;
};

export type ControlPlaneEvalCaseResult = {
    id: string;
    description: string;
    source: ControlPlaneEvalCase['source'];
    productionReplaySource?: string;
    passed: boolean;
    stages: {
        analyze?: ControlPlaneEvalStageResult<ControlPlaneEvalAnalyzeActual>;
        freeze?: ControlPlaneEvalStageResult<ControlPlaneEvalFreezeActual>;
        plan?: ControlPlaneEvalStageResult<ControlPlaneEvalPlanActual>;
        artifact?: ControlPlaneEvalStageResult<ControlPlaneEvalArtifactActual>;
        runtimeReplay?: ControlPlaneEvalStageResult<ControlPlaneEvalRuntimeReplayActual>;
    };
};

export type ControlPlaneEvalSummary = {
    datasetFiles: string[];
    totals: {
        totalCases: number;
        passedCases: number;
        failedCases: number;
    };
    stages: Record<ControlPlaneEvalStageName, {
        total: number;
        passed: number;
        failed: number;
    }>;
    metrics: {
        clarificationRate: number | null;
        unnecessaryClarificationRate: number | null;
        contractFreezeExpectationPassRate: number | null;
        artifactExpectationPassRate: number | null;
        artifactSatisfactionRate: number | null;
        runtimeReplayPassRate: number | null;
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
    failures: Array<{
        caseId: string;
        stage: ControlPlaneEvalStageName;
        mismatches: string[];
    }>;
    caseResults: ControlPlaneEvalCaseResult[];
};

type EvalWorkspaceContext = {
    rootDir: string;
    workspacePath: string;
    homeDir: string;
    cleanup: () => void;
};

type PreparedEvalArtifacts = {
    analyzed: NormalizedWorkRequest;
    frozen: FrozenWorkRequest;
    plan: ExecutionPlan;
};

function dedupe<T>(items: T[]): T[] {
    return Array.from(new Set(items));
}

function resolveDefaultDatasetDir(): string {
    const filePath = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(filePath), '../../evals/control-plane');
}

function resolveSidecarPackageRoot(): string {
    const filePath = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(filePath), '../..');
}

function parseJsonLine(line: string, filePath: string, lineNumber: number): ControlPlaneEvalCase {
    let parsed: unknown;
    try {
        parsed = JSON.parse(line);
    } catch (error) {
        throw new Error(`Invalid JSON in ${filePath}:${lineNumber}: ${String(error)}`);
    }

    return controlPlaneEvalCaseSchema.parse(parsed);
}

function collectDatasetFiles(inputs: string[]): string[] {
    const files = new Set<string>();
    for (const input of inputs) {
        const resolved = path.resolve(input);
        if (!fs.existsSync(resolved)) {
            throw new Error(`Eval dataset path does not exist: ${resolved}`);
        }

        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
            for (const entry of fs.readdirSync(resolved).sort()) {
                if (entry.endsWith('.jsonl')) {
                    files.add(path.join(resolved, entry));
                }
            }
            continue;
        }

        if (!resolved.endsWith('.jsonl')) {
            throw new Error(`Eval dataset file must end with .jsonl: ${resolved}`);
        }
        files.add(resolved);
    }

    const collected = Array.from(files).sort();
    if (collected.length === 0) {
        throw new Error(`No .jsonl eval files found in: ${inputs.join(', ')}`);
    }
    return collected;
}

export function loadControlPlaneEvalCases(inputs: string[] = [resolveDefaultDatasetDir()]): {
    datasetFiles: string[];
    cases: ControlPlaneEvalCase[];
} {
    const datasetFiles = collectDatasetFiles(inputs);
    const cases: ControlPlaneEvalCase[] = [];

    for (const datasetFile of datasetFiles) {
        const lines = fs.readFileSync(datasetFile, 'utf-8')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        lines.forEach((line, index) => {
            cases.push(parseJsonLine(line, datasetFile, index + 1));
        });
    }

    return { datasetFiles, cases };
}

function createEvalWorkspace(caseId: string): EvalWorkspaceContext {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), `coworkany-control-plane-eval-${caseId}-`));
    const workspacePath = path.join(rootDir, 'workspace');
    const homeDir = path.join(rootDir, 'home');
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });

    return {
        rootDir,
        workspacePath,
        homeDir,
        cleanup: () => {
            fs.rmSync(rootDir, { recursive: true, force: true });
        },
    };
}

function interpolateTemplate(value: string, variables: Record<string, string>): string {
    return value.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => variables[key] ?? _match);
}

function interpolateCaseValue<T>(value: T, variables: Record<string, string>): T {
    if (typeof value === 'string') {
        return interpolateTemplate(value, variables) as T;
    }
    if (Array.isArray(value)) {
        return value.map((item) => interpolateCaseValue(item, variables)) as T;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>).map(([key, child]) => {
            return [key, interpolateCaseValue(child, variables)];
        });
        return Object.fromEntries(entries) as T;
    }
    return value;
}

function seedWorkspace(workspacePath: string, entries: z.infer<typeof workspaceEntrySchema>[]): void {
    for (const entry of entries) {
        const targetPath = path.isAbsolute(entry.path)
            ? entry.path
            : path.join(workspacePath, entry.path);

        if (entry.kind === 'dir') {
            fs.mkdirSync(targetPath, { recursive: true });
            continue;
        }

        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, entry.content ?? '', 'utf-8');
    }
}

function buildResearchResolversFromCase(
    research: ControlPlaneEvalCase['research']
): {
    resolvers?: ResearchLoopResolvers;
    options?: ResearchLoopOptions;
} {
    if (!research) {
        return {};
    }

    const resolvers: ResearchLoopResolvers = {};

    if (research.webSearch) {
        const response = research.webSearch;
        resolvers.webSearch = async () => ({ ...response });
    }

    if (research.connectedAppStatus) {
        const response = research.connectedAppStatus;
        resolvers.connectedAppStatus = async () => ({ ...response });
    }

    return {
        resolvers: Object.keys(resolvers).length > 0 ? resolvers : undefined,
        options: research.options,
    };
}

async function prepareControlPlaneArtifacts(evalCase: ControlPlaneEvalCase): Promise<PreparedEvalArtifacts> {
    const store = new WorkRequestStore(path.join(evalCase.input.workspacePath || '', '.unused'));
    const analyzed = analyzeWorkRequest({
        sourceText: evalCase.input.sourceText,
        workspacePath: evalCase.input.workspacePath || '',
        now: evalCase.input.now ? new Date(evalCase.input.now) : undefined,
        systemContext: evalCase.input.systemContext
            ? {
                homeDir: evalCase.input.systemContext.homeDir,
                platform: evalCase.input.systemContext.platform as NodeJS.Platform | undefined,
            }
            : undefined,
    });
    const { resolvers, options } = buildResearchResolversFromCase(evalCase.research);
    const researched = await runPreFreezeResearchLoop({
        request: analyzed,
        workRequestStore: store,
        resolvers,
        options,
    });
    const frozen = freezeWorkRequest(researched);
    const plan = buildExecutionPlan(frozen);
    return { analyzed, frozen, plan };
}

function buildAnalyzeActual(analyzed: NormalizedWorkRequest): ControlPlaneEvalAnalyzeActual {
    const deliverables = analyzed.deliverables ?? [];
    const tasks = analyzed.tasks ?? [];

    return {
        mode: analyzed.mode,
        clarificationRequired: analyzed.clarification.required,
        missingFields: analyzed.clarification.missingFields,
        deliverableTypes: deliverables.map((deliverable) => deliverable.type),
        deliverablePaths: deliverables
            .map((deliverable) => deliverable.path)
            .filter((value): value is string => typeof value === 'string'),
        deliverableFormats: deliverables
            .map((deliverable) => deliverable.format)
            .filter((value): value is string => typeof value === 'string'),
        checkpointKinds: (analyzed.checkpoints ?? []).map((checkpoint) => checkpoint.kind),
        userActionKinds: (analyzed.userActionsRequired ?? []).map((action) => action.kind),
        researchSources: dedupe((analyzed.researchQueries ?? []).map((query) => query.source)),
        selectedStrategyPresent: Boolean(analyzed.selectedStrategyId),
        taskCategory: analyzed.goalFrame?.taskCategory,
        preferredSkills: dedupe(tasks.flatMap((task) => task.preferredSkills)),
        preferredTools: dedupe(tasks.flatMap((task) => task.preferredTools)),
        preferredWorkflow: tasks[0]?.preferredWorkflow,
        sessionFollowUpScope: analyzed.sessionIsolationPolicy?.followUpScope,
        memoryDefaultWriteScope: analyzed.memoryIsolationPolicy?.defaultWriteScope,
        tenantWorkspaceBoundaryMode: analyzed.tenantIsolationPolicy?.workspaceBoundaryMode,
    };
}

function buildFreezeActual(frozen: FrozenWorkRequest): ControlPlaneEvalFreezeActual {
    return {
        sourcesChecked: frozen.frozenResearchSummary?.sourcesChecked ?? [],
        researchStatusesBySource: Object.fromEntries(
            (frozen.researchQueries ?? []).map((query) => [query.source, query.status])
        ),
        blockingUnknownTopics: (frozen.uncertaintyRegistry ?? [])
            .filter((item) => item.status === 'blocking_unknown')
            .map((item) => item.topic),
        selectedStrategyPresent: Boolean(frozen.frozenResearchSummary?.selectedStrategyTitle),
        deliverablePaths: (frozen.deliverables ?? [])
            .map((deliverable) => deliverable.path)
            .filter((value): value is string => typeof value === 'string'),
    };
}

function buildPlanActual(plan: ExecutionPlan): ControlPlaneEvalPlanActual {
    const stepKinds = plan.steps.map((step) => step.kind);
    return {
        runMode: plan.runMode,
        stepKinds,
        blockedStepKinds: dedupe(plan.steps.filter((step) => step.status === 'blocked').map((step) => step.kind)),
        pendingStepKinds: dedupe(plan.steps.filter((step) => step.status === 'pending').map((step) => step.kind)),
        completedStepKinds: dedupe(plan.steps.filter((step) => step.status === 'completed').map((step) => step.kind)),
    };
}

function buildArtifactActual(
    frozen: FrozenWorkRequest,
    evidence: z.infer<typeof artifactEvidenceSchema>
): ControlPlaneEvalArtifactActual {
    const contract = buildArtifactContract(buildExecutionQuery(frozen), frozen.deliverables);
    const evaluation = evaluateArtifactContract(contract, evidence);
    const requirementKinds = dedupe(
        evaluation.failed
            .map((failed) => contract.requirements.find((requirement) => requirement.id === failed.requirementId)?.kind)
            .filter((value): value is ArtifactKind => Boolean(value))
    );

    return {
        passed: evaluation.passed,
        failedRequirementKinds: requirementKinds,
        warnings: evaluation.warnings,
    };
}

function buildBootstrapRuntimeContextCommand(input: { appDataDir: string; shell?: string }): string {
    return JSON.stringify({
        type: 'bootstrap_runtime_context',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {
            runtimeContext: {
                platform: process.platform,
                arch: process.arch,
                appDir: resolveSidecarPackageRoot(),
                appDataDir: input.appDataDir,
                shell: input.shell || process.env.SHELL || '/bin/zsh',
                python: { available: false },
                skillhub: { available: false },
                managedServices: [],
            },
        },
    });
}

function buildSendTaskMessageCommand(input: NonNullable<z.infer<typeof runtimeReplayStageSchema>['command']>): string {
    return JSON.stringify({
        type: 'send_task_message',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {
            taskId: input.taskId,
            content: input.content,
            config: {
                disabledTools: input.disabledTools ?? [],
            },
        },
    });
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function readTaskEventsFromJsonl(filePath: string, variables: Record<string, string>): TaskEvent[] {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Runtime replay event log not found: ${filePath}`);
    }

    const events: TaskEvent[] = [];
    const lines = fs.readFileSync(filePath, 'utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (const line of lines) {
        try {
            const parsed = JSON.parse(interpolateTemplate(line, variables));
            const result = TaskEventSchema.safeParse(parsed);
            if (result.success) {
                events.push(result.data);
            }
        } catch {
            // Ignore malformed lines to keep replay tolerant of mixed logs.
        }
    }

    return events;
}

function buildRuntimeReplayActualFromEvents(events: TaskEvent[], source: 'live_sidecar' | 'event_log'): ControlPlaneEvalRuntimeReplayActual {
    const eventTypes: string[] = events.map((event) => event.type);
    const reopenedEvent = [...events].reverse().find((event) => event.type === 'TASK_CONTRACT_REOPENED');
    const planReadyEvent = [...events].reverse().find((event) => event.type === 'TASK_PLAN_READY');
    const latestStatus = [...events].reverse().find((event) => event.type === 'TASK_STATUS');

    return {
        validatedEventCount: events.length,
        eventTypes,
        source,
        reopenTrigger:
            reopenedEvent && 'trigger' in reopenedEvent.payload
                ? String(reopenedEvent.payload.trigger)
                : undefined,
        reopenReason:
            reopenedEvent && 'reason' in reopenedEvent.payload
                ? String(reopenedEvent.payload.reason)
                : undefined,
        planReadyDeliverablePaths:
            planReadyEvent && 'deliverables' in planReadyEvent.payload
                ? ((planReadyEvent.payload.deliverables as Array<{ path?: string }>)
                    .map((deliverable) => deliverable.path)
                    .filter((value): value is string => typeof value === 'string'))
                : [],
        planReadySessionFollowUpScope:
            planReadyEvent && 'sessionIsolationPolicy' in planReadyEvent.payload
                ? (planReadyEvent.payload as { sessionIsolationPolicy?: { followUpScope?: string } }).sessionIsolationPolicy?.followUpScope
                : undefined,
        planReadyMemoryDefaultWriteScope:
            planReadyEvent && 'memoryIsolationPolicy' in planReadyEvent.payload
                ? (planReadyEvent.payload as { memoryIsolationPolicy?: { defaultWriteScope?: string } }).memoryIsolationPolicy?.defaultWriteScope
                : undefined,
        planReadyTenantWorkspaceBoundaryMode:
            planReadyEvent && 'tenantIsolationPolicy' in planReadyEvent.payload
                ? (planReadyEvent.payload as { tenantIsolationPolicy?: { workspaceBoundaryMode?: string } }).tenantIsolationPolicy?.workspaceBoundaryMode
                : undefined,
        finalStatus:
            latestStatus && 'status' in latestStatus.payload
                ? String(latestStatus.payload.status)
                : undefined,
    };
}

function includesOrderedSubsequence(actual: string[], expected: string[]): boolean {
    let cursor = 0;
    for (const value of actual) {
        if (value === expected[cursor]) {
            cursor += 1;
            if (cursor === expected.length) {
                return true;
            }
        }
    }
    return expected.length === 0;
}

async function executeRuntimeReplayStage(
    stage: z.infer<typeof runtimeReplayStageSchema>,
    context: EvalWorkspaceContext,
    variables: Record<string, string>
): Promise<ControlPlaneEvalRuntimeReplayActual> {
    if (stage.eventLogPath) {
        const events = readTaskEventsFromJsonl(stage.eventLogPath, variables);
        return buildRuntimeReplayActualFromEvents(events, 'event_log');
    }

    const appDataDir = path.join(context.rootDir, 'app-data');
    fs.mkdirSync(appDataDir, { recursive: true });
    fs.writeFileSync(
        path.join(appDataDir, 'task-runtime.json'),
        JSON.stringify(stage.persistedRuntimeRecords, null, 2),
        'utf-8'
    );

    const child = spawn('bun', ['run', 'src/main.ts'], {
        cwd: resolveSidecarPackageRoot(),
        env: {
            ...process.env,
            COWORKANY_APP_DATA_DIR: appDataDir,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    const events: TaskEvent[] = [];
    let stdoutBuffer = '';
    let stderrBuffer = '';

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.trim()) {
                continue;
            }
            try {
                const parsed = JSON.parse(line);
                const result = TaskEventSchema.safeParse(parsed);
                if (result.success) {
                    events.push(result.data);
                }
            } catch {
                // Ignore non-JSON or non-event output.
            }
        }
    });

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
        stderrBuffer += chunk;
    });

    const writeCommand = (command: string): void => {
        child.stdin.write(`${command}\n`);
    };

    try {
        await delay(stage.startupDelayMs ?? 5000);
        writeCommand(buildBootstrapRuntimeContextCommand({ appDataDir }));
        await delay(stage.postBootstrapDelayMs ?? 1000);
        if (!stage.command) {
            throw new Error('runtimeReplay live-sidecar mode requires command');
        }
        writeCommand(buildSendTaskMessageCommand(stage.command));

        const timeoutMs = stage.timeoutMs ?? 30000;
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const eventTypes: string[] = events.map((event) => event.type);
            const hasOrdered = !stage.expect.eventTypesInOrder || includesOrderedSubsequence(eventTypes, stage.expect.eventTypesInOrder);
            const hasIncluded = !stage.expect.eventTypesInclude || stage.expect.eventTypesInclude.every((type) => eventTypes.includes(type));
            const hasExcluded = !stage.expect.eventTypesExclude || stage.expect.eventTypesExclude.every((type) => !eventTypes.includes(type));
            const latestStatus = [...events]
                .reverse()
                .find((event) => event.type === 'TASK_STATUS')?.payload as { status?: string } | undefined;
            const hasFinalStatus = !stage.expect.finalStatus || latestStatus?.status === stage.expect.finalStatus;

            if (hasOrdered && hasIncluded && hasExcluded && hasFinalStatus) {
                break;
            }
            await delay(250);
        }

        const eventTypes: string[] = events.map((event) => event.type);

        if (
            stage.expect.eventTypesInclude &&
            !stage.expect.eventTypesInclude.every((type) => eventTypes.includes(type))
        ) {
            throw new Error(`Timed out waiting for runtime replay events. Saw ${JSON.stringify(eventTypes)}. stderr=${stderrBuffer.slice(-1000)}`);
        }

        return buildRuntimeReplayActualFromEvents(events, 'live_sidecar');
    } finally {
        child.kill();
        await delay(100);
    }
}

function compareEqual<T>(label: string, actual: T, expected: T, mismatches: string[]): void {
    if (actual !== expected) {
        mismatches.push(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
    }
}

function compareIncludes(label: string, actual: string[], expected: string[], mismatches: string[]): void {
    for (const value of expected) {
        if (!actual.includes(value)) {
            mismatches.push(`${label}: expected to include ${JSON.stringify(value)}, received ${JSON.stringify(actual)}`);
        }
    }
}

function compareExcludes(label: string, actual: string[], expected: string[], mismatches: string[]): void {
    for (const value of expected) {
        if (actual.includes(value)) {
            mismatches.push(`${label}: expected to exclude ${JSON.stringify(value)}, received ${JSON.stringify(actual)}`);
        }
    }
}

function compareWarnings(label: string, actual: string[], expected: string[], mismatches: string[]): void {
    for (const value of expected) {
        const matched = actual.some((warning) => warning.includes(value));
        if (!matched) {
            mismatches.push(`${label}: expected a warning including ${JSON.stringify(value)}, received ${JSON.stringify(actual)}`);
        }
    }
}

function evaluateAnalyzeStage(
    analyzed: NormalizedWorkRequest,
    expectation: z.infer<typeof analyzeExpectationSchema>
): ControlPlaneEvalStageResult<ControlPlaneEvalAnalyzeActual> {
    const actual = buildAnalyzeActual(analyzed);
    const mismatches: string[] = [];

    if (expectation.mode) compareEqual('mode', actual.mode, expectation.mode, mismatches);
    if (typeof expectation.clarificationRequired === 'boolean') {
        compareEqual('clarificationRequired', actual.clarificationRequired, expectation.clarificationRequired, mismatches);
    }
    if (expectation.missingFieldsInclude) {
        compareIncludes('missingFields', actual.missingFields, expectation.missingFieldsInclude, mismatches);
    }
    if (expectation.missingFieldsExclude) {
        compareExcludes('missingFields', actual.missingFields, expectation.missingFieldsExclude, mismatches);
    }
    if (expectation.deliverableTypesInclude) {
        compareIncludes('deliverableTypes', actual.deliverableTypes, expectation.deliverableTypesInclude, mismatches);
    }
    if (expectation.deliverablePathsInclude) {
        compareIncludes('deliverablePaths', actual.deliverablePaths, expectation.deliverablePathsInclude, mismatches);
    }
    if (expectation.deliverableFormatsInclude) {
        compareIncludes('deliverableFormats', actual.deliverableFormats, expectation.deliverableFormatsInclude, mismatches);
    }
    if (expectation.checkpointKindsInclude) {
        compareIncludes('checkpointKinds', actual.checkpointKinds, expectation.checkpointKindsInclude, mismatches);
    }
    if (expectation.userActionKindsInclude) {
        compareIncludes('userActionKinds', actual.userActionKinds, expectation.userActionKindsInclude, mismatches);
    }
    if (expectation.researchSourcesInclude) {
        compareIncludes('researchSources', actual.researchSources, expectation.researchSourcesInclude, mismatches);
    }
    if (typeof expectation.selectedStrategyRequired === 'boolean') {
        compareEqual('selectedStrategyPresent', actual.selectedStrategyPresent, expectation.selectedStrategyRequired, mismatches);
    }
    if (expectation.taskCategory) {
        compareEqual('taskCategory', actual.taskCategory, expectation.taskCategory, mismatches);
    }
    if (expectation.preferredSkillsInclude) {
        compareIncludes('preferredSkills', actual.preferredSkills, expectation.preferredSkillsInclude, mismatches);
    }
    if (expectation.preferredToolsInclude) {
        compareIncludes('preferredTools', actual.preferredTools, expectation.preferredToolsInclude, mismatches);
    }
    if (typeof expectation.preferredWorkflow === 'string') {
        compareEqual('preferredWorkflow', actual.preferredWorkflow, expectation.preferredWorkflow, mismatches);
    }
    if (typeof expectation.sessionFollowUpScope === 'string') {
        compareEqual('sessionFollowUpScope', actual.sessionFollowUpScope, expectation.sessionFollowUpScope, mismatches);
    }
    if (typeof expectation.memoryDefaultWriteScope === 'string') {
        compareEqual('memoryDefaultWriteScope', actual.memoryDefaultWriteScope, expectation.memoryDefaultWriteScope, mismatches);
    }
    if (typeof expectation.tenantWorkspaceBoundaryMode === 'string') {
        compareEqual('tenantWorkspaceBoundaryMode', actual.tenantWorkspaceBoundaryMode, expectation.tenantWorkspaceBoundaryMode, mismatches);
    }

    return {
        passed: mismatches.length === 0,
        mismatches,
        actual,
    };
}

function evaluateFreezeStage(
    frozen: FrozenWorkRequest,
    expectation: z.infer<typeof freezeExpectationSchema>
): ControlPlaneEvalStageResult<ControlPlaneEvalFreezeActual> {
    const actual = buildFreezeActual(frozen);
    const mismatches: string[] = [];

    if (expectation.sourcesCheckedInclude) {
        compareIncludes('sourcesChecked', actual.sourcesChecked, expectation.sourcesCheckedInclude, mismatches);
    }
    if (expectation.researchStatusesBySource) {
        for (const [source, status] of Object.entries(expectation.researchStatusesBySource)) {
            compareEqual(`researchStatusesBySource.${source}`, actual.researchStatusesBySource[source], status, mismatches);
        }
    }
    if (expectation.blockingUnknownTopicsInclude) {
        compareIncludes('blockingUnknownTopics', actual.blockingUnknownTopics, expectation.blockingUnknownTopicsInclude, mismatches);
    }
    if (expectation.blockingUnknownTopicsExclude) {
        compareExcludes('blockingUnknownTopics', actual.blockingUnknownTopics, expectation.blockingUnknownTopicsExclude, mismatches);
    }
    if (typeof expectation.selectedStrategyRequired === 'boolean') {
        compareEqual('selectedStrategyPresent', actual.selectedStrategyPresent, expectation.selectedStrategyRequired, mismatches);
    }
    if (expectation.deliverablePathsInclude) {
        compareIncludes('deliverablePaths', actual.deliverablePaths, expectation.deliverablePathsInclude, mismatches);
    }

    return {
        passed: mismatches.length === 0,
        mismatches,
        actual,
    };
}

function evaluatePlanStage(
    plan: ExecutionPlan,
    expectation: z.infer<typeof planExpectationSchema>
): ControlPlaneEvalStageResult<ControlPlaneEvalPlanActual> {
    const actual = buildPlanActual(plan);
    const mismatches: string[] = [];

    if (expectation.runMode) {
        compareEqual('runMode', actual.runMode, expectation.runMode, mismatches);
    }
    if (expectation.stepKindsExact) {
        compareEqual('stepKindsExact', JSON.stringify(actual.stepKinds), JSON.stringify(expectation.stepKindsExact), mismatches);
    }
    if (expectation.blockedStepKindsInclude) {
        compareIncludes('blockedStepKinds', actual.blockedStepKinds, expectation.blockedStepKindsInclude, mismatches);
    }
    if (expectation.pendingStepKindsInclude) {
        compareIncludes('pendingStepKinds', actual.pendingStepKinds, expectation.pendingStepKindsInclude, mismatches);
    }
    if (expectation.completedStepKindsInclude) {
        compareIncludes('completedStepKinds', actual.completedStepKinds, expectation.completedStepKindsInclude, mismatches);
    }

    return {
        passed: mismatches.length === 0,
        mismatches,
        actual,
    };
}

function evaluateArtifactStage(
    frozen: FrozenWorkRequest,
    stage: NonNullable<z.infer<typeof controlPlaneEvalCaseSchema>['stages']['artifact']>
): ControlPlaneEvalStageResult<ControlPlaneEvalArtifactActual> {
    const actual = buildArtifactActual(frozen, stage.evidence);
    const mismatches: string[] = [];

    if (typeof stage.expect.passed === 'boolean') {
        compareEqual('artifactPassed', actual.passed, stage.expect.passed, mismatches);
    }
    if (stage.expect.failedRequirementKindsInclude) {
        compareIncludes('failedRequirementKinds', actual.failedRequirementKinds, stage.expect.failedRequirementKindsInclude, mismatches);
    }
    if (stage.expect.warningsInclude) {
        compareWarnings('warnings', actual.warnings, stage.expect.warningsInclude, mismatches);
    }

    return {
        passed: mismatches.length === 0,
        mismatches,
        actual,
    };
}

function evaluateRuntimeReplayStage(
    actual: ControlPlaneEvalRuntimeReplayActual,
    expectation: z.infer<typeof runtimeReplayExpectationSchema>
): ControlPlaneEvalStageResult<ControlPlaneEvalRuntimeReplayActual> {
    const mismatches: string[] = [];

    if (expectation.eventTypesInOrder && !includesOrderedSubsequence(actual.eventTypes, expectation.eventTypesInOrder)) {
        mismatches.push(
            `runtimeReplay.eventTypesInOrder: expected subsequence ${JSON.stringify(expectation.eventTypesInOrder)}, received ${JSON.stringify(actual.eventTypes)}`
        );
    }
    if (expectation.eventTypesInclude) {
        compareIncludes('runtimeReplay.eventTypes', actual.eventTypes, expectation.eventTypesInclude, mismatches);
    }
    if (expectation.eventTypesExclude) {
        compareExcludes('runtimeReplay.eventTypes', actual.eventTypes, expectation.eventTypesExclude, mismatches);
    }
    if (expectation.reopenTrigger) {
        compareEqual('runtimeReplay.reopenTrigger', actual.reopenTrigger, expectation.reopenTrigger, mismatches);
    }
    if (typeof expectation.reopenReasonIncludes === 'string') {
        if (!actual.reopenReason || !actual.reopenReason.includes(expectation.reopenReasonIncludes)) {
            mismatches.push(
                `runtimeReplay.reopenReason: expected to include ${JSON.stringify(expectation.reopenReasonIncludes)}, received ${JSON.stringify(actual.reopenReason)}`
            );
        }
    }
    if (expectation.planReadyDeliverablePathsInclude) {
        compareIncludes(
            'runtimeReplay.planReadyDeliverablePaths',
            actual.planReadyDeliverablePaths,
            expectation.planReadyDeliverablePathsInclude,
            mismatches
        );
    }
    if (expectation.planReadySessionFollowUpScope) {
        compareEqual(
            'runtimeReplay.planReadySessionFollowUpScope',
            actual.planReadySessionFollowUpScope,
            expectation.planReadySessionFollowUpScope,
            mismatches
        );
    }
    if (expectation.planReadyMemoryDefaultWriteScope) {
        compareEqual(
            'runtimeReplay.planReadyMemoryDefaultWriteScope',
            actual.planReadyMemoryDefaultWriteScope,
            expectation.planReadyMemoryDefaultWriteScope,
            mismatches
        );
    }
    if (expectation.planReadyTenantWorkspaceBoundaryMode) {
        compareEqual(
            'runtimeReplay.planReadyTenantWorkspaceBoundaryMode',
            actual.planReadyTenantWorkspaceBoundaryMode,
            expectation.planReadyTenantWorkspaceBoundaryMode,
            mismatches
        );
    }
    if (expectation.finalStatus) {
        compareEqual('runtimeReplay.finalStatus', actual.finalStatus, expectation.finalStatus, mismatches);
    }

    return {
        passed: mismatches.length === 0,
        mismatches,
        actual,
    };
}

export async function runControlPlaneEvalCase(rawCase: ControlPlaneEvalCase): Promise<ControlPlaneEvalCaseResult> {
    const context = createEvalWorkspace(rawCase.id);
    const variables = {
        workspace: context.workspacePath,
        homeDir: context.homeDir,
        sidecarRoot: resolveSidecarPackageRoot(),
    };

    const evalCase = interpolateCaseValue(rawCase, variables);
    const resolvedWorkspacePath = evalCase.input.workspacePath ?? context.workspacePath;

    try {
        seedWorkspace(context.workspacePath, evalCase.workspace?.entries ?? []);
        if (resolvedWorkspacePath !== context.workspacePath) {
            fs.mkdirSync(resolvedWorkspacePath, { recursive: true });
        }

        const preparedCase: ControlPlaneEvalCase = {
            ...evalCase,
            input: {
                ...evalCase.input,
                workspacePath: resolvedWorkspacePath,
                systemContext: {
                    homeDir: evalCase.input.systemContext?.homeDir ?? context.homeDir,
                    platform: evalCase.input.systemContext?.platform,
                },
            },
        };

        const artifacts = await prepareControlPlaneArtifacts(preparedCase);
        const stages: ControlPlaneEvalCaseResult['stages'] = {};

        if (preparedCase.stages.analyze) {
            stages.analyze = evaluateAnalyzeStage(artifacts.analyzed, preparedCase.stages.analyze);
        }
        if (preparedCase.stages.freeze) {
            stages.freeze = evaluateFreezeStage(artifacts.frozen, preparedCase.stages.freeze);
        }
        if (preparedCase.stages.plan) {
            stages.plan = evaluatePlanStage(artifacts.plan, preparedCase.stages.plan);
        }
        if (preparedCase.stages.artifact) {
            stages.artifact = evaluateArtifactStage(artifacts.frozen, preparedCase.stages.artifact);
        }
        if (preparedCase.stages.runtimeReplay) {
            const runtimeActual = await executeRuntimeReplayStage(preparedCase.stages.runtimeReplay, context, variables);
            stages.runtimeReplay = evaluateRuntimeReplayStage(runtimeActual, preparedCase.stages.runtimeReplay.expect);
        }

        const passed = Object.values(stages).every((stage) => stage?.passed !== false);
        return {
            id: preparedCase.id,
            description: preparedCase.description,
            source: preparedCase.source,
            productionReplaySource: preparedCase.productionReplaySource,
            passed,
            stages,
        };
    } finally {
        context.cleanup();
    }
}

function countStagePasses(
    caseResults: ControlPlaneEvalCaseResult[],
    stageName: ControlPlaneEvalStageName
): { total: number; passed: number; failed: number } {
    const staged = caseResults
        .map((result) => result.stages[stageName])
        .filter((result): result is NonNullable<ControlPlaneEvalCaseResult['stages'][typeof stageName]> => Boolean(result));

    const passed = staged.filter((result) => result.passed).length;
    return {
        total: staged.length,
        passed,
        failed: staged.length - passed,
    };
}

function computeRate(numerator: number, denominator: number): number | null {
    if (denominator === 0) {
        return null;
    }
    return numerator / denominator;
}

function buildProductionReplayCoverage(caseResults: ControlPlaneEvalCaseResult[]): ControlPlaneEvalSummary['coverage'] {
    const productionReplaySources: ControlPlaneEvalSummary['coverage']['productionReplaySources'] = {};

    for (const result of caseResults) {
        if (result.source !== 'production_replay') {
            continue;
        }

        const sourceLabel = result.productionReplaySource ?? 'unspecified';
        const bucket = productionReplaySources[sourceLabel] ?? {
            totalCases: 0,
            passedCases: 0,
            failedCases: 0,
            runtimeReplayCases: 0,
            runtimeReplayPassedCases: 0,
        };

        bucket.totalCases += 1;
        if (result.passed) {
            bucket.passedCases += 1;
        } else {
            bucket.failedCases += 1;
        }
        if (result.stages.runtimeReplay) {
            bucket.runtimeReplayCases += 1;
            if (result.stages.runtimeReplay.passed) {
                bucket.runtimeReplayPassedCases += 1;
            }
        }
        productionReplaySources[sourceLabel] = bucket;
    }

    return {
        productionReplaySources: Object.fromEntries(
            Object.entries(productionReplaySources).sort(([left], [right]) => left.localeCompare(right))
        ),
    };
}

export async function runControlPlaneEvalSuite(inputs: string[] = [resolveDefaultDatasetDir()]): Promise<ControlPlaneEvalSummary> {
    const { datasetFiles, cases } = loadControlPlaneEvalCases(inputs);
    const caseResults: ControlPlaneEvalCaseResult[] = [];

    for (const evalCase of cases) {
        caseResults.push(await runControlPlaneEvalCase(evalCase));
    }

    const stages = {
        analyze: countStagePasses(caseResults, 'analyze'),
        freeze: countStagePasses(caseResults, 'freeze'),
        plan: countStagePasses(caseResults, 'plan'),
        artifact: countStagePasses(caseResults, 'artifact'),
        runtimeReplay: countStagePasses(caseResults, 'runtimeReplay'),
    };

    const passedCases = caseResults.filter((result) => result.passed).length;
    const analyzeCases = caseResults.filter((result) => result.stages.analyze);
    const clarificationCount = analyzeCases.filter((result) => result.stages.analyze?.actual.clarificationRequired).length;
    const expectedNonClarifyingCases = cases.filter((evalCase) => evalCase.stages.analyze?.clarificationRequired === false);
    const expectedNonClarifyingIds = new Set(expectedNonClarifyingCases.map((evalCase) => evalCase.id));
    const unnecessaryClarificationCount = caseResults.filter((result) =>
        expectedNonClarifyingIds.has(result.id) && result.stages.analyze?.actual.clarificationRequired
    ).length;
    const artifactCases = caseResults.filter((result) => result.stages.artifact);
    const artifactSatisfiedCount = artifactCases.filter((result) => result.stages.artifact?.actual.passed).length;
    const runtimeReplayCases = caseResults.filter((result) => result.stages.runtimeReplay);
    const coverage = buildProductionReplayCoverage(caseResults);

    const failures = caseResults.flatMap((result) => {
        return CONTROL_PLANE_STAGE_NAMES.flatMap((stageName) => {
            const stage = result.stages[stageName];
            if (!stage || stage.passed) {
                return [];
            }
            return [{
                caseId: result.id,
                stage: stageName,
                mismatches: stage.mismatches,
            }];
        });
    });

    return {
        datasetFiles,
        totals: {
            totalCases: caseResults.length,
            passedCases,
            failedCases: caseResults.length - passedCases,
        },
        stages,
        metrics: {
            clarificationRate: computeRate(clarificationCount, analyzeCases.length),
            unnecessaryClarificationRate: computeRate(unnecessaryClarificationCount, expectedNonClarifyingCases.length),
            contractFreezeExpectationPassRate: computeRate(stages.freeze.passed, stages.freeze.total),
            artifactExpectationPassRate: computeRate(stages.artifact.passed, stages.artifact.total),
            artifactSatisfactionRate: computeRate(artifactSatisfiedCount, artifactCases.length),
            runtimeReplayPassRate: computeRate(stages.runtimeReplay.passed, runtimeReplayCases.length),
        },
        coverage,
        failures,
        caseResults,
    };
}

function formatPercent(value: number | null): string {
    if (value === null) {
        return 'n/a';
    }
    return `${(value * 100).toFixed(1)}%`;
}

export function formatControlPlaneEvalSummary(summary: ControlPlaneEvalSummary): string {
    const lines = [
        'Control-plane eval summary',
        `Datasets: ${summary.datasetFiles.join(', ')}`,
        `Cases: ${summary.totals.passedCases}/${summary.totals.totalCases} passed`,
        `Clarification rate: ${formatPercent(summary.metrics.clarificationRate)}`,
        `Unnecessary clarification rate: ${formatPercent(summary.metrics.unnecessaryClarificationRate)}`,
        `Freeze expectation pass rate: ${formatPercent(summary.metrics.contractFreezeExpectationPassRate)}`,
        `Artifact expectation pass rate: ${formatPercent(summary.metrics.artifactExpectationPassRate)}`,
        `Artifact satisfaction rate: ${formatPercent(summary.metrics.artifactSatisfactionRate)}`,
        `Runtime replay pass rate: ${formatPercent(summary.metrics.runtimeReplayPassRate)}`,
        `Stage pass: analyze ${summary.stages.analyze.passed}/${summary.stages.analyze.total}, freeze ${summary.stages.freeze.passed}/${summary.stages.freeze.total}, plan ${summary.stages.plan.passed}/${summary.stages.plan.total}, artifact ${summary.stages.artifact.passed}/${summary.stages.artifact.total}, runtimeReplay ${summary.stages.runtimeReplay.passed}/${summary.stages.runtimeReplay.total}`,
    ];

    if (summary.failures.length > 0) {
        lines.push('Failures:');
        for (const failure of summary.failures) {
            lines.push(`- ${failure.caseId} [${failure.stage}] ${failure.mismatches.join(' | ')}`);
        }
    }

    const replaySources = Object.entries(summary.coverage.productionReplaySources);
    if (replaySources.length > 0) {
        lines.push('Production replay coverage:');
        for (const [sourceLabel, bucket] of replaySources) {
            lines.push(
                `- ${sourceLabel}: ${bucket.passedCases}/${bucket.totalCases} passed, ` +
                `runtimeReplay ${bucket.runtimeReplayPassedCases}/${bucket.runtimeReplayCases}`
            );
        }
    }

    return lines.join('\n');
}

function parseCliArgs(args: string[]): { inputs: string[]; outPath?: string } {
    const inputs: string[] = [];
    let outPath: string | undefined;

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--out') {
            outPath = args[index + 1];
            index += 1;
            continue;
        }
        inputs.push(arg);
    }

    return {
        inputs: inputs.length > 0 ? inputs : [resolveDefaultDatasetDir()],
        outPath,
    };
}

function isMainModule(): boolean {
    const entry = process.argv[1];
    if (!entry) {
        return false;
    }
    return path.resolve(entry) === fileURLToPath(import.meta.url);
}

async function main(): Promise<void> {
    const { inputs, outPath } = parseCliArgs(process.argv.slice(2));
    const summary = await runControlPlaneEvalSuite(inputs);
    const rendered = formatControlPlaneEvalSummary(summary);
    console.log(rendered);

    if (outPath) {
        const resolved = path.resolve(outPath);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, JSON.stringify(summary, null, 2), 'utf-8');
        console.log(`Wrote JSON summary to ${resolved}`);
    }

    if (summary.totals.failedCases > 0) {
        process.exitCode = 1;
    }
}

if (isMainModule()) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
