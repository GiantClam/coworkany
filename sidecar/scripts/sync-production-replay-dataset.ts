import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { syncProductionReplayDataset } from '../src/evals/controlPlaneEventLogImporter';

type CliOptions = {
    inputPaths: string[];
    datasetPath: string;
    summaryOutPath: string;
    caseIdPrefix?: string;
    descriptionPrefix?: string;
    productionReplaySource?: string;
    workspacePath?: string;
    sourceText?: string;
    sidecarRoot?: string;
};

function resolveDefaults(): {
    sidecarRoot: string;
    evalDir: string;
} {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const sidecarRoot = path.resolve(scriptDir, '..');
    return {
        sidecarRoot,
        evalDir: path.join(sidecarRoot, 'evals', 'control-plane'),
    };
}

function parseArgs(argv: string[]): CliOptions {
    const defaults = resolveDefaults();
    const options: CliOptions = {
        inputPaths: [
            path.join(defaults.evalDir, 'import-sources', 'canary'),
            path.join(defaults.evalDir, 'import-sources', 'beta'),
            path.join(defaults.evalDir, 'import-sources', 'ga'),
        ],
        datasetPath: path.join(defaults.evalDir, 'production-replay.jsonl'),
        summaryOutPath: path.join(defaults.evalDir, 'import-reports', 'latest.json'),
        sidecarRoot: defaults.sidecarRoot,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
            case '--input-root':
                options.inputPaths.push(argv[index + 1]);
                index += 1;
                break;
            case '--replace-input-roots':
                options.inputPaths = [];
                break;
            case '--dataset':
                options.datasetPath = argv[index + 1];
                index += 1;
                break;
            case '--summary-out':
                options.summaryOutPath = argv[index + 1];
                index += 1;
                break;
            case '--case-id-prefix':
                options.caseIdPrefix = argv[index + 1];
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
            case '--workspace-path':
                options.workspacePath = argv[index + 1];
                index += 1;
                break;
            case '--source-text':
                options.sourceText = argv[index + 1];
                index += 1;
                break;
            case '--sidecar-root':
                options.sidecarRoot = argv[index + 1];
                index += 1;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return options;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const report = syncProductionReplayDataset({
        inputPaths: options.inputPaths,
        datasetPath: options.datasetPath,
        caseIdPrefix: options.caseIdPrefix,
        descriptionPrefix: options.descriptionPrefix,
        productionReplaySource: options.productionReplaySource,
        workspacePath: options.workspacePath,
        sourceText: options.sourceText,
        sidecarRoot: options.sidecarRoot,
    });

    const resolvedSummaryOut = path.resolve(options.summaryOutPath);
    fs.mkdirSync(path.dirname(resolvedSummaryOut), { recursive: true });
    fs.writeFileSync(resolvedSummaryOut, JSON.stringify(report, null, 2), 'utf-8');

    console.log(`Synced ${report.totalCases} replay case(s) into ${path.resolve(options.datasetPath)}`);
    console.log(`Input roots: ${report.inputPaths.join(', ') || 'none'}`);
    console.log(
        `Replay sources: ${
            Object.entries(report.bySource).map(([source, count]) => `${source}=${count}`).join(', ') || 'none'
        }`
    );
    console.log(`Inserted: ${report.insertedCases ?? 0}, updated: ${report.updatedCases ?? 0}, dataset total: ${report.totalDatasetCases ?? 0}`);
    console.log(`Summary: ${resolvedSummaryOut}`);
}

main().catch((error) => {
    console.error('[sync-production-replay-dataset] fatal:', error);
    process.exitCode = 1;
});
