import * as fs from 'fs';
import * as path from 'path';
import {
    buildImportedRuntimeReplayBatchReport,
    collectEventLogFiles,
    deriveImportedRuntimeReplayCaseId,
    deriveImportedRuntimeReplayDescription,
    importControlPlaneEventLogBatch,
    importControlPlaneEventLog,
    summarizeImportedRuntimeReplayCases,
    upsertImportedRuntimeReplayCases,
    type ImportControlPlaneEventLogOptions,
    upsertImportedRuntimeReplayCase,
} from '../src/evals/controlPlaneEventLogImporter';

type CliOptions = ImportControlPlaneEventLogOptions & {
    inputDir?: string;
    caseIdPrefix?: string;
    descriptionPrefix?: string;
    outputPath?: string;
    append?: boolean;
    datasetPath?: string;
    summaryOutPath?: string;
};

function parseArgs(argv: string[]): CliOptions {
    const options: Partial<CliOptions> = {};

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
            case '--input':
                options.eventLogPath = argv[index + 1];
                index += 1;
                break;
            case '--case-id':
                options.caseId = argv[index + 1];
                index += 1;
                break;
            case '--case-id-prefix':
                options.caseIdPrefix = argv[index + 1];
                index += 1;
                break;
            case '--description':
                options.description = argv[index + 1];
                index += 1;
                break;
            case '--description-prefix':
                options.descriptionPrefix = argv[index + 1];
                index += 1;
                break;
            case '--production-replay-source':
                options.productionReplaySource = argv[index + 1];
                index += 1;
                break;
            case '--input-dir':
                options.inputDir = argv[index + 1];
                index += 1;
                break;
            case '--source-text':
                options.sourceText = argv[index + 1];
                index += 1;
                break;
            case '--workspace-path':
                options.workspacePath = argv[index + 1];
                index += 1;
                break;
            case '--sidecar-root':
                options.sidecarRoot = argv[index + 1];
                index += 1;
                break;
            case '--output':
                options.outputPath = argv[index + 1];
                index += 1;
                break;
            case '--append':
                options.append = true;
                break;
            case '--dataset':
                options.datasetPath = argv[index + 1];
                index += 1;
                break;
            case '--summary-out':
                options.summaryOutPath = argv[index + 1];
                index += 1;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!options.eventLogPath && !options.inputDir) {
        throw new Error('Usage: --input <path> | --input-dir <path>');
    }

    if (options.inputDir && options.eventLogPath) {
        throw new Error('Use either --input or --input-dir, not both.');
    }

    if (!options.inputDir && (!options.caseId || !options.description)) {
        throw new Error('Single-log usage requires --case-id <id> and --description <text>.');
    }

    return options as CliOptions;
}

function maybeWriteSummaryReport(summaryOutPath: string | undefined, report: ReturnType<typeof buildImportedRuntimeReplayBatchReport>): void {
    if (!summaryOutPath) {
        return;
    }

    const resolved = path.resolve(summaryOutPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`Wrote import summary to ${resolved}`);
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (options.inputDir) {
        const eventLogPaths = collectEventLogFiles([options.inputDir]);
        const importedCases = importControlPlaneEventLogBatch({
            inputPaths: eventLogPaths,
            caseIdPrefix: options.caseIdPrefix,
            descriptionPrefix: options.descriptionPrefix,
            productionReplaySource: options.productionReplaySource,
            workspacePath: options.workspacePath,
            sourceText: options.sourceText,
            sidecarRoot: options.sidecarRoot,
        });
        const summary = summarizeImportedRuntimeReplayCases(importedCases);
        const sourceSummary = Object.entries(summary.bySource)
            .map(([source, count]) => `${source}=${count}`)
            .join(', ');

        if (options.datasetPath) {
            const result = upsertImportedRuntimeReplayCases(options.datasetPath, importedCases);
            const report = buildImportedRuntimeReplayBatchReport({
                importedCases,
                datasetPath: path.resolve(options.datasetPath),
                insertedCases: result.inserted,
                updatedCases: result.updated,
                totalDatasetCases: result.totalCases,
            });
            console.log(
                `Batch imported ${importedCases.length} replay case(s) into ${path.resolve(options.datasetPath)} ` +
                `(${result.inserted} inserted, ${result.updated} updated, ${result.totalCases} total)`
            );
            console.log(`Replay sources: ${sourceSummary || 'none'}`);
            maybeWriteSummaryReport(options.summaryOutPath, report);
            return;
        }

        const lines = importedCases.map((importedCase) => JSON.stringify(importedCase)).join('\n');
        if (!options.outputPath) {
            console.log(lines);
            return;
        }

        const outputPath = path.resolve(options.outputPath);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        const payload = `${lines}\n`;
        if (options.append) {
            fs.appendFileSync(outputPath, payload, 'utf-8');
        } else {
            fs.writeFileSync(outputPath, payload, 'utf-8');
        }
        console.log(`Wrote ${importedCases.length} imported control-plane replay case(s) to ${outputPath}`);
        console.log(`Replay sources: ${sourceSummary || 'none'}`);
        maybeWriteSummaryReport(options.summaryOutPath, buildImportedRuntimeReplayBatchReport({
            importedCases,
        }));
        return;
    }

    const imported = importControlPlaneEventLog(options);
    const line = JSON.stringify(imported);

    if (options.datasetPath) {
        const result = upsertImportedRuntimeReplayCase(options.datasetPath, imported);
        console.log(`${result.updated ? 'Updated' : 'Inserted'} replay case ${imported.id} in ${path.resolve(options.datasetPath)} (${result.totalCases} total case(s))`);
        maybeWriteSummaryReport(options.summaryOutPath, buildImportedRuntimeReplayBatchReport({
            importedCases: [imported],
            datasetPath: path.resolve(options.datasetPath),
            insertedCases: result.updated ? 0 : 1,
            updatedCases: result.updated ? 1 : 0,
            totalDatasetCases: result.totalCases,
        }));
        return;
    }

    if (!options.outputPath) {
        console.log(line);
        maybeWriteSummaryReport(options.summaryOutPath, buildImportedRuntimeReplayBatchReport({
            importedCases: [imported],
        }));
        return;
    }

    const outputPath = path.resolve(options.outputPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (options.append) {
        fs.appendFileSync(outputPath, `${line}\n`, 'utf-8');
    } else {
        fs.writeFileSync(outputPath, `${line}\n`, 'utf-8');
    }
    console.log(`Wrote imported control-plane replay case to ${outputPath}`);
    maybeWriteSummaryReport(options.summaryOutPath, buildImportedRuntimeReplayBatchReport({
        importedCases: [imported],
    }));
}

main().catch((error) => {
    console.error('[import-control-plane-event-log] fatal:', error);
    process.exitCode = 1;
});
