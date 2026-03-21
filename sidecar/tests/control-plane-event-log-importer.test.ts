import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    buildImportedRuntimeReplayBatchReport,
    collectEventLogFiles,
    detectWorkspacePathFromTaskEvents,
    deriveImportedRuntimeReplayCaseId,
    deriveImportedRuntimeReplayDescription,
    inferProductionReplaySourceFromPath,
    importControlPlaneEventLogBatch,
    importControlPlaneEventLog,
    loadTaskEventsFromJsonl,
    syncProductionReplayDataset,
    summarizeImportedRuntimeReplayCases,
    upsertImportedRuntimeReplayCase,
    upsertImportedRuntimeReplayCases,
} from '../src/evals/controlPlaneEventLogImporter';
import * as fs from 'fs';
import * as os from 'os';

function resolveFixturePath(): string {
    return path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../evals/control-plane/event-logs/runtime-followup-reopen.jsonl'
    );
}

describe('control-plane event log importer', () => {
    test('loads and validates task events from a jsonl fixture', () => {
        const events = loadTaskEventsFromJsonl(resolveFixturePath());
        expect(events.length).toBe(5);
        expect(events.map((event) => event.type)).toEqual([
            'TASK_STATUS',
            'TASK_CONTRACT_REOPENED',
            'TASK_RESEARCH_UPDATED',
            'TASK_PLAN_READY',
            'TASK_STATUS',
        ]);
    });

    test('imports a production replay case from event logs with path templating', () => {
        const fixturePath = resolveFixturePath();
        const events = loadTaskEventsFromJsonl(fixturePath);
        const detectedWorkspace = detectWorkspacePathFromTaskEvents(events);

        expect(detectedWorkspace).toBe('{{workspace}}');

        const imported = importControlPlaneEventLog({
            eventLogPath: fixturePath,
            caseId: 'imported-runtime-followup-reopen',
            description: 'Imported from saved event log',
            productionReplaySource: 'beta',
            workspacePath: '/tmp',
            sourceText: 'Actually, save it to /tmp/hello.ts instead.',
            sidecarRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
        });

        expect(imported).toMatchObject({
            id: 'imported-runtime-followup-reopen',
            source: 'production_replay',
            productionReplaySource: 'beta',
            input: {
                sourceText: 'Actually, save it to {{workspace}}/hello.ts instead.',
                workspacePath: '{{workspace}}',
            },
            stages: {
                runtimeReplay: {
                    eventLogPath: '{{sidecarRoot}}/evals/control-plane/event-logs/runtime-followup-reopen.jsonl',
                    expect: {
                        eventTypesInOrder: [
                            'TASK_STATUS',
                            'TASK_CONTRACT_REOPENED',
                            'TASK_RESEARCH_UPDATED',
                            'TASK_PLAN_READY',
                            'TASK_STATUS',
                        ],
                        eventTypesInclude: [
                            'TASK_STATUS',
                            'TASK_CONTRACT_REOPENED',
                            'TASK_RESEARCH_UPDATED',
                            'TASK_PLAN_READY',
                        ],
                        eventTypesExclude: ['TASK_CLARIFICATION_REQUIRED'],
                        reopenTrigger: 'contradictory_evidence',
                        planReadyDeliverablePathsInclude: ['{{workspace}}/hello.ts'],
                        finalStatus: 'idle',
                    },
                },
            },
        });
    });

    test('upserts imported replay cases by case id into a dataset file', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-importer-'));
        const datasetPath = path.join(root, 'dataset.jsonl');
        const fixturePath = resolveFixturePath();

        const imported = importControlPlaneEventLog({
            eventLogPath: fixturePath,
            caseId: 'imported-runtime-followup-reopen',
            description: 'Imported from saved event log',
            productionReplaySource: 'beta',
            workspacePath: '/tmp',
            sourceText: 'Actually, save it to /tmp/hello.ts instead.',
            sidecarRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
        });

        const inserted = upsertImportedRuntimeReplayCase(datasetPath, imported);
        expect(inserted).toEqual({ updated: false, totalCases: 1 });

        const updated = upsertImportedRuntimeReplayCase(datasetPath, {
            ...imported,
            description: 'Updated description',
        });
        expect(updated).toEqual({ updated: true, totalCases: 1 });

        const lines = fs.readFileSync(datasetPath, 'utf-8').trim().split('\n');
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0]).description).toBe('Updated description');
    });

    test('collects event log files from directories and derives stable case metadata', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-importer-batch-'));
        const nestedDir = path.join(root, 'nested');
        fs.mkdirSync(nestedDir, { recursive: true });
        const firstPath = path.join(root, 'runtime-followup-reopen.jsonl');
        const secondPath = path.join(nestedDir, 'beta-refreeze.jsonl');
        const fixture = fs.readFileSync(resolveFixturePath(), 'utf-8');
        fs.writeFileSync(firstPath, fixture, 'utf-8');
        fs.writeFileSync(secondPath, fixture, 'utf-8');

        expect(collectEventLogFiles([root])).toEqual([secondPath, firstPath]);
        expect(deriveImportedRuntimeReplayCaseId(secondPath, 'beta')).toBe('beta-beta-refreeze');
        expect(deriveImportedRuntimeReplayDescription(secondPath, 'Imported beta replay')).toBe('Imported beta replay: beta refreeze');
        expect(inferProductionReplaySourceFromPath(path.join(root, 'canary', 'runtime-followup-reopen.jsonl'))).toBe('canary');
        expect(inferProductionReplaySourceFromPath(path.join(root, 'misc', 'runtime-followup-reopen.jsonl'))).toBeUndefined();
    });

    test('imports and upserts a batch of production replay cases from an event-log directory', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-importer-batch-'));
        const logsDir = path.join(root, 'beta', 'logs');
        fs.mkdirSync(logsDir, { recursive: true });
        const firstPath = path.join(logsDir, 'runtime-followup-reopen.jsonl');
        const secondPath = path.join(logsDir, 'beta-refreeze.jsonl');
        const fixture = fs.readFileSync(resolveFixturePath(), 'utf-8');
        fs.writeFileSync(firstPath, fixture, 'utf-8');
        fs.writeFileSync(secondPath, fixture, 'utf-8');

        const importedCases = importControlPlaneEventLogBatch({
            inputPaths: [logsDir],
            caseIdPrefix: 'beta',
            descriptionPrefix: 'Imported beta replay',
            workspacePath: '/tmp',
            sidecarRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
        });

        expect(importedCases).toHaveLength(2);
        expect(importedCases.map((entry) => entry.id)).toEqual([
            'beta-beta-refreeze',
            'beta-runtime-followup-reopen',
        ]);
        expect(importedCases.every((entry) => entry.productionReplaySource === 'beta')).toBe(true);
        expect(summarizeImportedRuntimeReplayCases(importedCases)).toEqual({
            totalCases: 2,
            bySource: {
                beta: 2,
            },
        });
        const datasetPath = path.join(root, 'dataset.jsonl');
        expect(buildImportedRuntimeReplayBatchReport({
            importedCases,
            datasetPath,
            insertedCases: 2,
            updatedCases: 0,
            totalDatasetCases: 2,
            generatedAt: '2026-03-21T00:00:00.000Z',
        })).toEqual({
            totalCases: 2,
            bySource: {
                beta: 2,
            },
            generatedAt: '2026-03-21T00:00:00.000Z',
            caseIds: [
                'beta-beta-refreeze',
                'beta-runtime-followup-reopen',
            ],
            eventLogPaths: [
                importedCases[0]!.stages.runtimeReplay.eventLogPath,
                importedCases[1]!.stages.runtimeReplay.eventLogPath,
            ].sort(),
            datasetPath,
            insertedCases: 2,
            updatedCases: 0,
            totalDatasetCases: 2,
        });
        const inserted = upsertImportedRuntimeReplayCases(datasetPath, importedCases);
        expect(inserted).toEqual({ inserted: 2, updated: 0, totalCases: 2 });

        const updated = upsertImportedRuntimeReplayCases(datasetPath, [{
            ...importedCases[0]!,
            description: 'Updated batch description',
        }]);
        expect(updated).toEqual({ inserted: 0, updated: 1, totalCases: 2 });

        const lines = fs.readFileSync(datasetPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
        expect(lines).toHaveLength(2);
        expect(lines.find((entry) => entry.id === 'beta-beta-refreeze')?.description).toBe('Updated batch description');
    });

    test('does not template unrelated absolute event-log paths when workspace path is only a shared prefix', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-importer-prefix-'));
        const eventLogPath = path.join(root, 'runtime-followup-reopen.jsonl');
        fs.writeFileSync(eventLogPath, fs.readFileSync(resolveFixturePath(), 'utf-8'), 'utf-8');

        const imported = importControlPlaneEventLog({
            eventLogPath,
            caseId: 'prefix-safety',
            description: 'Prefix safety',
            productionReplaySource: 'beta',
            workspacePath: '/tmp',
            sidecarRoot: '/Users/beihuang/Documents/github/coworkany/sidecar',
        });

        expect(imported.stages.runtimeReplay.eventLogPath).toBe(eventLogPath);
        expect(imported.stages.runtimeReplay.eventLogPath.includes('{{workspace}}')).toBe(false);
    });

    test('syncs production replay dataset from rollout source directories', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-sync-replays-'));
        const canaryDir = path.join(root, 'canary');
        const betaDir = path.join(root, 'beta');
        fs.mkdirSync(canaryDir, { recursive: true });
        fs.mkdirSync(betaDir, { recursive: true });
        const fixture = fs.readFileSync(resolveFixturePath(), 'utf-8');
        fs.writeFileSync(path.join(canaryDir, 'runtime-followup-reopen.jsonl'), fixture, 'utf-8');
        fs.writeFileSync(path.join(betaDir, 'beta-refreeze.jsonl'), fixture, 'utf-8');

        const datasetPath = path.join(root, 'production-replay.jsonl');
        const report = syncProductionReplayDataset({
            inputPaths: [canaryDir, betaDir, path.join(root, 'missing')],
            datasetPath,
            workspacePath: '/tmp',
            sidecarRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
            generatedAt: '2026-03-21T00:00:00.000Z',
        });

        expect(report).toMatchObject({
            totalCases: 2,
            bySource: {
                beta: 1,
                canary: 1,
            },
            insertedCases: 2,
            updatedCases: 0,
            totalDatasetCases: 2,
            generatedAt: '2026-03-21T00:00:00.000Z',
        });
        expect(report.inputPaths).toEqual([
            path.resolve(canaryDir),
            path.resolve(betaDir),
        ]);

        const lines = fs.readFileSync(datasetPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
        expect(lines).toHaveLength(2);
        expect(lines.map((entry) => entry.productionReplaySource).sort()).toEqual(['beta', 'canary']);
    });

    test('sync production replay dataset tolerates missing rollout directories', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-sync-replays-empty-'));
        const datasetPath = path.join(root, 'production-replay.jsonl');

        const report = syncProductionReplayDataset({
            inputPaths: [path.join(root, 'canary'), path.join(root, 'beta')],
            datasetPath,
            generatedAt: '2026-03-21T00:00:00.000Z',
        });

        expect(report).toEqual({
            totalCases: 0,
            bySource: {},
            generatedAt: '2026-03-21T00:00:00.000Z',
            caseIds: [],
            eventLogPaths: [],
            datasetPath: path.resolve(datasetPath),
            insertedCases: 0,
            updatedCases: 0,
            totalDatasetCases: 0,
            inputPaths: [],
        });
    });
});
