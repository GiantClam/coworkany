import * as fs from 'fs';
import * as path from 'path';

export type ImportedRuntimeReplayEvent = {
    id?: string;
    taskId?: string;
    timestamp?: string;
    sequence?: number;
    type: string;
    payload?: Record<string, any>;
};

export type ImportControlPlaneEventLogOptions = {
    eventLogPath: string;
    caseId: string;
    description: string;
    productionReplaySource?: string;
    sourceText?: string;
    workspacePath?: string;
    sidecarRoot?: string;
};

export type ImportedRuntimeReplayCase = {
    id: string;
    description: string;
    source: 'production_replay';
    productionReplaySource?: string;
    input: {
        sourceText: string;
        workspacePath: string;
    };
    stages: {
        runtimeReplay: {
            eventLogPath: string;
            expect: Record<string, any>;
        };
    };
};

export type ImportedRuntimeReplayBatchReport = {
    totalCases: number;
    bySource: Record<string, number>;
    generatedAt: string;
    caseIds: string[];
    eventLogPaths: string[];
    datasetPath?: string;
    insertedCases?: number;
    updatedCases?: number;
    totalDatasetCases?: number;
    inputPaths?: string[];
};

function readJsonl(filePath: string): any[] {
    return fs.readFileSync(filePath, 'utf-8')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function normalizeSlug(value: string): string {
    return value
        .replace(/\.[^.]+$/u, '')
        .replace(/[^a-zA-Z0-9]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .toLowerCase();
}

function normalizeAbsolute(inputPath: string): string {
    return path.resolve(inputPath);
}

function templatePath(input: string, workspacePath?: string, sidecarRoot?: string): string {
    let output = input;
    if (sidecarRoot) {
        const resolvedRoot = path.resolve(sidecarRoot);
        const resolvedInput = path.resolve(input);
        if (resolvedInput === resolvedRoot || resolvedInput.startsWith(`${resolvedRoot}${path.sep}`)) {
            output = `{{sidecarRoot}}${resolvedInput.slice(resolvedRoot.length)}`;
        }
    }
    if (workspacePath) {
        const resolvedWorkspace = path.resolve(workspacePath);
        const resolvedInput = path.resolve(input);
        if (resolvedInput === resolvedWorkspace || resolvedInput.startsWith(`${resolvedWorkspace}${path.sep}`)) {
            output = `{{workspace}}${resolvedInput.slice(resolvedWorkspace.length)}`;
        }
    }
    return output;
}

function templateText(input: string, workspacePath?: string): string {
    if (!workspacePath) {
        return input;
    }
    return input.split(path.resolve(workspacePath)).join('{{workspace}}');
}

function untmpl(input: string, workspacePath = '/tmp', sidecarRoot = process.cwd()): string {
    return input
        .replace(/\{\{workspace\}\}/gu, workspacePath)
        .replace(/\{\{sidecarRoot\}\}/gu, sidecarRoot);
}

export function loadTaskEventsFromJsonl(eventLogPath: string): ImportedRuntimeReplayEvent[] {
    return readJsonl(eventLogPath) as ImportedRuntimeReplayEvent[];
}

export function detectWorkspacePathFromTaskEvents(events: ImportedRuntimeReplayEvent[]): string | undefined {
    const serialized = JSON.stringify(events);
    if (serialized.includes('{{workspace}}')) {
        return '{{workspace}}';
    }
    const match = serialized.match(/(\/[^"\s]+\/workspace)(?:\/[^"\s]+)?/u);
    return match?.[1];
}

export function deriveImportedRuntimeReplayCaseId(eventLogPath: string, prefix?: string): string {
    const slug = normalizeSlug(path.basename(eventLogPath));
    return prefix ? `${normalizeSlug(prefix)}-${slug}` : slug;
}

export function deriveImportedRuntimeReplayDescription(eventLogPath: string, prefix?: string): string {
    const words = normalizeSlug(path.basename(eventLogPath)).replace(/-/gu, ' ');
    return prefix ? `${prefix}: ${words}` : words;
}

export function inferProductionReplaySourceFromPath(inputPath: string): string | undefined {
    const parts = path.resolve(inputPath).split(path.sep);
    for (const part of parts) {
        if (/^(canary|beta|prod|production|staging)$/iu.test(part)) {
            return part.toLowerCase();
        }
    }
    return undefined;
}

function buildRuntimeReplayExpect(events: ImportedRuntimeReplayEvent[]): Record<string, any> {
    const eventTypes = events.map((event) => event.type);
    const reopened = events.find((event) => event.type === 'TASK_CONTRACT_REOPENED');
    const planReady = events.find((event) => event.type === 'TASK_PLAN_READY');
    const finalStatus = [...events].reverse().find((event) => event.type === 'TASK_STATUS')?.payload?.status;
    const deliverables = Array.isArray(planReady?.payload?.deliverables) ? planReady?.payload?.deliverables : [];

    return {
        eventTypesInOrder: eventTypes,
        eventTypesInclude: eventTypes.filter((type, index) => eventTypes.indexOf(type) === index),
        eventTypesExclude: ['TASK_CLARIFICATION_REQUIRED'],
        reopenTrigger: reopened?.payload?.trigger,
        ...(typeof reopened?.payload?.reason === 'string' ? { reopenReasonIncludes: reopened.payload.reason } : {}),
        planReadyDeliverablePathsInclude: deliverables
            .map((deliverable: any) => deliverable?.path)
            .filter((value: unknown): value is string => typeof value === 'string'),
        finalStatus,
    };
}

export function importControlPlaneEventLog(options: ImportControlPlaneEventLogOptions): ImportedRuntimeReplayCase {
    const events = loadTaskEventsFromJsonl(options.eventLogPath);
    const expect = buildRuntimeReplayExpect(events);
    const planReady = events.find((event) => event.type === 'TASK_PLAN_READY');
    const payload = planReady?.payload ?? {};

    if (payload.sessionIsolationPolicy?.followUpScope) {
        expect.planReadySessionFollowUpScope = payload.sessionIsolationPolicy.followUpScope;
    }
    if (payload.memoryIsolationPolicy?.defaultWriteScope) {
        expect.planReadyMemoryDefaultWriteScope = payload.memoryIsolationPolicy.defaultWriteScope;
    }
    if (payload.tenantIsolationPolicy?.workspaceBoundaryMode) {
        expect.planReadyTenantWorkspaceBoundaryMode = payload.tenantIsolationPolicy.workspaceBoundaryMode;
    }

    return {
        id: options.caseId,
        description: options.description,
        source: 'production_replay',
        productionReplaySource: options.productionReplaySource,
        input: {
            sourceText: templateText(options.sourceText ?? '', options.workspacePath),
            workspacePath: options.workspacePath ? '{{workspace}}' : (detectWorkspacePathFromTaskEvents(events) ?? '{{workspace}}'),
        },
        stages: {
            runtimeReplay: {
                eventLogPath: templatePath(options.eventLogPath, undefined, options.sidecarRoot),
                expect,
            },
        },
    };
}

export function collectEventLogFiles(inputPaths: string[]): string[] {
    const collected: string[] = [];
    const visit = (entryPath: string): void => {
        if (!fs.existsSync(entryPath)) {
            return;
        }
        const stat = fs.statSync(entryPath);
        if (stat.isDirectory()) {
            for (const child of fs.readdirSync(entryPath)) {
                visit(path.join(entryPath, child));
            }
            return;
        }
        if (entryPath.endsWith('.jsonl')) {
            collected.push(path.resolve(entryPath));
        }
    };
    for (const inputPath of inputPaths) {
        visit(inputPath);
    }
    return collected.sort();
}

export function importControlPlaneEventLogBatch(input: {
    inputPaths: string[];
    caseIdPrefix?: string;
    descriptionPrefix?: string;
    productionReplaySource?: string;
    workspacePath?: string;
    sourceText?: string;
    sidecarRoot?: string;
}): ImportedRuntimeReplayCase[] {
    const files = collectEventLogFiles(input.inputPaths);
    return files.map((eventLogPath) => {
        const source = input.productionReplaySource ?? inferProductionReplaySourceFromPath(eventLogPath);
        return importControlPlaneEventLog({
            eventLogPath,
            caseId: deriveImportedRuntimeReplayCaseId(eventLogPath, input.caseIdPrefix ?? source),
            description: deriveImportedRuntimeReplayDescription(eventLogPath, input.descriptionPrefix ?? 'Imported production replay'),
            productionReplaySource: source,
            workspacePath: input.workspacePath,
            sourceText: input.sourceText,
            sidecarRoot: input.sidecarRoot,
        });
    });
}

export function summarizeImportedRuntimeReplayCases(importedCases: ImportedRuntimeReplayCase[]): { totalCases: number; bySource: Record<string, number> } {
    const bySource: Record<string, number> = {};
    for (const importedCase of importedCases) {
        const source = importedCase.productionReplaySource ?? 'unknown';
        bySource[source] = (bySource[source] ?? 0) + 1;
    }
    return { totalCases: importedCases.length, bySource };
}

export function buildImportedRuntimeReplayBatchReport(input: {
    importedCases: ImportedRuntimeReplayCase[];
    datasetPath?: string;
    insertedCases?: number;
    updatedCases?: number;
    totalDatasetCases?: number;
    generatedAt?: string;
    inputPaths?: string[];
}): ImportedRuntimeReplayBatchReport {
    const summary = summarizeImportedRuntimeReplayCases(input.importedCases);
    return {
        ...summary,
        generatedAt: input.generatedAt ?? new Date().toISOString(),
        caseIds: input.importedCases.map((entry) => entry.id).sort(),
        eventLogPaths: input.importedCases.map((entry) => entry.stages.runtimeReplay.eventLogPath).sort(),
        datasetPath: input.datasetPath,
        insertedCases: input.insertedCases,
        updatedCases: input.updatedCases,
        totalDatasetCases: input.totalDatasetCases,
        inputPaths: input.inputPaths,
    };
}

function readDataset(datasetPath: string): ImportedRuntimeReplayCase[] {
    if (!fs.existsSync(datasetPath) || fs.readFileSync(datasetPath, 'utf-8').trim().length === 0) {
        return [];
    }
    return readJsonl(datasetPath) as ImportedRuntimeReplayCase[];
}

function writeDataset(datasetPath: string, cases: ImportedRuntimeReplayCase[]): void {
    fs.mkdirSync(path.dirname(datasetPath), { recursive: true });
    const payload = cases.map((entry) => JSON.stringify(entry)).join('\n');
    fs.writeFileSync(datasetPath, payload ? `${payload}\n` : '', 'utf-8');
}

export function upsertImportedRuntimeReplayCase(datasetPath: string, importedCase: ImportedRuntimeReplayCase): { updated: boolean; totalCases: number } {
    const resolved = path.resolve(datasetPath);
    const cases = readDataset(resolved);
    const index = cases.findIndex((entry) => entry.id === importedCase.id);
    const updated = index >= 0;
    if (updated) {
        cases[index] = importedCase;
    } else {
        cases.push(importedCase);
    }
    writeDataset(resolved, cases);
    return { updated, totalCases: cases.length };
}

export function upsertImportedRuntimeReplayCases(datasetPath: string, importedCases: ImportedRuntimeReplayCase[]): { inserted: number; updated: number; totalCases: number } {
    let inserted = 0;
    let updated = 0;
    for (const importedCase of importedCases) {
        const result = upsertImportedRuntimeReplayCase(datasetPath, importedCase);
        if (result.updated) {
            updated += 1;
        } else {
            inserted += 1;
        }
    }
    return { inserted, updated, totalCases: readDataset(path.resolve(datasetPath)).length };
}

export function syncProductionReplayDataset(input: {
    inputPaths: string[];
    datasetPath: string;
    workspacePath?: string;
    sourceText?: string;
    sidecarRoot?: string;
    generatedAt?: string;
}): ImportedRuntimeReplayBatchReport {
    const existingInputPaths = input.inputPaths
        .map((inputPath) => path.resolve(inputPath))
        .filter((inputPath) => fs.existsSync(inputPath));
    const importedCases = importControlPlaneEventLogBatch({
        inputPaths: existingInputPaths,
        workspacePath: input.workspacePath,
        sourceText: input.sourceText,
        sidecarRoot: input.sidecarRoot,
    });
    const result = upsertImportedRuntimeReplayCases(input.datasetPath, importedCases);
    return buildImportedRuntimeReplayBatchReport({
        importedCases,
        datasetPath: path.resolve(input.datasetPath),
        insertedCases: result.inserted,
        updatedCases: result.updated,
        totalDatasetCases: result.totalCases,
        generatedAt: input.generatedAt,
        inputPaths: existingInputPaths,
    });
}

export const __private = { untmpl };
