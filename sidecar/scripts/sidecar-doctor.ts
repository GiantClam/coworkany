import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { formatSidecarDoctorReport, runSidecarDoctor } from '../src/doctor/sidecarDoctor';

type CliOptions = {
    repositoryRoot: string;
    appDataDir?: string;
    startupProfile?: string;
    artifactTelemetryPath?: string;
    incidentLogPaths: string[];
    readinessReportPath?: string;
    controlPlaneThresholdsPath?: string;
    controlPlaneThresholdProfile?: string;
    outputDir?: string;
};

function parseArgs(argv: string[], repositoryRoot: string): CliOptions {
    const options: CliOptions = {
        repositoryRoot,
        outputDir: path.join(repositoryRoot, 'artifacts', 'doctor'),
        incidentLogPaths: [],
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
            case '--app-data-dir':
                options.appDataDir = path.resolve(argv[index + 1]);
                index += 1;
                break;
            case '--startup-profile':
                options.startupProfile = argv[index + 1];
                index += 1;
                break;
            case '--artifact-telemetry':
                options.artifactTelemetryPath = path.resolve(argv[index + 1]);
                index += 1;
                break;
            case '--incident-log':
            case '--incident-log-root':
                options.incidentLogPaths.push(path.resolve(argv[index + 1]));
                index += 1;
                break;
            case '--readiness-report':
                options.readinessReportPath = path.resolve(argv[index + 1]);
                index += 1;
                break;
            case '--control-plane-thresholds':
                options.controlPlaneThresholdsPath = path.resolve(argv[index + 1]);
                index += 1;
                break;
            case '--control-plane-threshold-profile':
                options.controlPlaneThresholdProfile = argv[index + 1];
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

    return options;
}

async function main(): Promise<void> {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const sidecarDir = path.resolve(scriptDir, '..');
    const repositoryRoot = path.resolve(sidecarDir, '..');
    const options = parseArgs(process.argv.slice(2), repositoryRoot);
    const report = runSidecarDoctor({
        repositoryRoot: options.repositoryRoot,
        appDataDir: options.appDataDir,
        startupProfile: options.startupProfile,
        artifactTelemetryPath: options.artifactTelemetryPath,
        incidentLogPaths: options.incidentLogPaths,
        readinessReportPath: options.readinessReportPath,
        controlPlaneThresholdsPath: options.controlPlaneThresholdsPath,
        controlPlaneThresholdProfile: options.controlPlaneThresholdProfile,
    });
    const rendered = formatSidecarDoctorReport(report);

    if (options.outputDir) {
        fs.mkdirSync(options.outputDir, { recursive: true });
        const jsonPath = path.join(options.outputDir, 'report.json');
        const markdownPath = path.join(options.outputDir, 'report.md');
        fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
        fs.writeFileSync(markdownPath, rendered, 'utf-8');
        console.log(rendered.trimEnd());
        console.log(`\n[sidecar-doctor] report: ${jsonPath}`);
        console.log(`[sidecar-doctor] markdown: ${markdownPath}`);
    } else {
        process.stdout.write(rendered);
    }

    if (report.overallStatus === 'blocked') {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error('[sidecar-doctor] fatal:', error);
    process.exitCode = 1;
});
