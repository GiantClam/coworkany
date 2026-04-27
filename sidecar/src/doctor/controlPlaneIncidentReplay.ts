import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { formatControlPlaneEvalSummary, runControlPlaneEvalSuite, type ControlPlaneEvalSummary } from '../evals/controlPlaneEvalRunner';
import { importControlPlaneEventLog, type ImportedRuntimeReplayCase } from '../evals/controlPlaneEventLogImporter';

export type ReplayControlPlaneIncidentOptions = {
    eventLogPath: string;
    caseId: string;
    description: string;
    productionReplaySource?: string;
    sourceText?: string;
    workspacePath?: string;
    sidecarRoot?: string;
    outputDir?: string;
};

export type ReplayControlPlaneIncidentResult = {
    case: ImportedRuntimeReplayCase;
    summary: ControlPlaneEvalSummary;
    renderedSummary: string;
    outputPaths?: {
        caseJsonPath: string;
        summaryJsonPath: string;
        datasetJsonlPath: string;
    };
};

function defaultSourceText(): string {
    return 'Actually, save it to {{workspace}}/hello.ts instead.';
}

function inferSidecarRoot(eventLogPath: string): string {
    let current = path.resolve(path.dirname(eventLogPath));
    for (let index = 0; index < 8; index += 1) {
        if (fs.existsSync(path.join(current, 'evals', 'control-plane'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return process.cwd();
}

export async function replayControlPlaneIncident(options: ReplayControlPlaneIncidentOptions): Promise<ReplayControlPlaneIncidentResult> {
    const sidecarRoot = options.sidecarRoot ?? inferSidecarRoot(options.eventLogPath);
    const importedCase = importControlPlaneEventLog({
        eventLogPath: options.eventLogPath,
        caseId: options.caseId,
        description: options.description,
        productionReplaySource: options.productionReplaySource,
        sourceText: options.sourceText ?? defaultSourceText(),
        workspacePath: options.workspacePath ?? os.tmpdir(),
        sidecarRoot,
    });

    const outputDir = options.outputDir ? path.resolve(options.outputDir) : undefined;
    const datasetJsonlPath = outputDir ? path.join(outputDir, 'incident-case.jsonl') : path.join(os.tmpdir(), `coworkany-${options.caseId}.jsonl`);
    fs.mkdirSync(path.dirname(datasetJsonlPath), { recursive: true });
    fs.writeFileSync(datasetJsonlPath, `${JSON.stringify(importedCase)}\n`, 'utf-8');

    const summary = await runControlPlaneEvalSuite([datasetJsonlPath]);
    const renderedSummary = formatControlPlaneEvalSummary(summary);

    if (!outputDir) {
        return { case: importedCase, summary, renderedSummary };
    }

    const caseJsonPath = path.join(outputDir, 'incident-case.json');
    const summaryJsonPath = path.join(outputDir, 'incident-eval-summary.json');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(caseJsonPath, JSON.stringify(importedCase, null, 2), 'utf-8');
    fs.writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2), 'utf-8');

    return {
        case: importedCase,
        summary,
        renderedSummary,
        outputPaths: {
            caseJsonPath,
            summaryJsonPath,
            datasetJsonlPath,
        },
    };
}
