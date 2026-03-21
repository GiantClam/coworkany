import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    importControlPlaneEventLog,
    type ImportControlPlaneEventLogOptions,
    type ImportedRuntimeReplayCase,
} from '../evals/controlPlaneEventLogImporter';
import {
    formatControlPlaneEvalSummary,
    runControlPlaneEvalSuite,
    type ControlPlaneEvalSummary,
} from '../evals/controlPlaneEvalRunner';

export type ReplayControlPlaneIncidentOptions = ImportControlPlaneEventLogOptions & {
    outputDir?: string;
};

export type ReplayControlPlaneIncidentResult = {
    importedCase: ImportedRuntimeReplayCase;
    summary: ControlPlaneEvalSummary;
    renderedSummary: string;
    outputPaths?: {
        caseJsonPath: string;
        caseJsonlPath: string;
        summaryJsonPath: string;
        summaryTextPath: string;
    };
};

export async function replayControlPlaneIncident(
    options: ReplayControlPlaneIncidentOptions,
): Promise<ReplayControlPlaneIncidentResult> {
    const importedCase = importControlPlaneEventLog(options);
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-incident-replay-'));
    const datasetPath = path.join(tempRoot, 'incident-case.jsonl');

    try {
        fs.writeFileSync(datasetPath, `${JSON.stringify(importedCase)}\n`, 'utf-8');
        const summary = await runControlPlaneEvalSuite([datasetPath]);
        const renderedSummary = formatControlPlaneEvalSummary(summary);

        let outputPaths: ReplayControlPlaneIncidentResult['outputPaths'];
        if (options.outputDir) {
            const resolvedOutputDir = path.resolve(options.outputDir);
            fs.mkdirSync(resolvedOutputDir, { recursive: true });
            outputPaths = {
                caseJsonPath: path.join(resolvedOutputDir, 'incident-case.json'),
                caseJsonlPath: path.join(resolvedOutputDir, 'incident-case.jsonl'),
                summaryJsonPath: path.join(resolvedOutputDir, 'incident-eval-summary.json'),
                summaryTextPath: path.join(resolvedOutputDir, 'incident-eval-summary.txt'),
            };
            fs.writeFileSync(outputPaths.caseJsonPath, `${JSON.stringify(importedCase, null, 2)}\n`, 'utf-8');
            fs.writeFileSync(outputPaths.caseJsonlPath, `${JSON.stringify(importedCase)}\n`, 'utf-8');
            fs.writeFileSync(outputPaths.summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
            fs.writeFileSync(outputPaths.summaryTextPath, renderedSummary, 'utf-8');
        }

        return {
            importedCase,
            summary,
            renderedSummary,
            outputPaths,
        };
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}
