import * as path from 'path';
import { replayControlPlaneIncident } from '../src/doctor/controlPlaneIncidentReplay';

type CliOptions = {
    eventLogPath: string;
    caseId?: string;
    description?: string;
    productionReplaySource?: string;
    sourceText?: string;
    workspacePath?: string;
    sidecarRoot?: string;
    outputDir?: string;
};

function parseArgs(argv: string[]): CliOptions {
    const options: CliOptions = {
        eventLogPath: '',
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
            case '--event-log':
                options.eventLogPath = path.resolve(argv[index + 1]);
                index += 1;
                break;
            case '--case-id':
                options.caseId = argv[index + 1];
                index += 1;
                break;
            case '--description':
                options.description = argv[index + 1];
                index += 1;
                break;
            case '--production-replay-source':
                options.productionReplaySource = argv[index + 1];
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
            case '--output-dir':
                options.outputDir = path.resolve(argv[index + 1]);
                index += 1;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!options.eventLogPath) {
        throw new Error('Missing required argument: --event-log <path>');
    }
    if (!options.caseId) {
        options.caseId = `incident-${path.basename(options.eventLogPath, path.extname(options.eventLogPath))}`;
    }
    if (!options.description) {
        options.description = `Incident replay: ${path.basename(options.eventLogPath, path.extname(options.eventLogPath))}`;
    }

    return options;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const result = await replayControlPlaneIncident({
        eventLogPath: options.eventLogPath,
        caseId: options.caseId!,
        description: options.description!,
        productionReplaySource: options.productionReplaySource,
        sourceText: options.sourceText,
        workspacePath: options.workspacePath,
        sidecarRoot: options.sidecarRoot,
        outputDir: options.outputDir,
    });

    console.log(result.renderedSummary);
    if (result.outputPaths) {
        console.log(`Wrote incident replay artifacts to ${options.outputDir}`);
    }

    if (result.summary.totals.failedCases > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error('[replay-control-plane-incident] fatal:', error);
    process.exitCode = 1;
});
