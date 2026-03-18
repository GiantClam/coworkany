import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    createDefaultCanaryChecklist,
    inspectObservability,
    renderReleaseReadinessMarkdown,
} from '../src/release/readiness';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-release-readiness-'));
}

describe('release readiness helpers', () => {
    test('inspects startup metrics and artifact telemetry summaries', () => {
        const root = makeTempDir();
        const appDataDir = path.join(root, 'app-data');
        const startupDir = path.join(appDataDir, 'startup-metrics');
        const artifactDir = path.join(root, '.coworkany', 'self-learning');
        fs.mkdirSync(startupDir, { recursive: true });
        fs.mkdirSync(artifactDir, { recursive: true });

        fs.writeFileSync(
            path.join(startupDir, 'default.jsonl'),
            `${JSON.stringify({ mark: 'frontend_ready', timestampEpochMs: Date.parse('2026-03-18T10:00:00.000Z') })}\n`,
            'utf-8',
        );
        fs.writeFileSync(
            path.join(artifactDir, 'artifact-contract-telemetry.jsonl'),
            `${JSON.stringify({ createdAt: '2026-03-18T10:10:00.000Z', artifactsCreated: ['/tmp/out.md'] })}\n`,
            'utf-8',
        );

        const summary = inspectObservability({
            repositoryRoot: root,
            appDataDir,
            startupProfile: 'default',
        });

        expect(summary.startupMetrics.files).toHaveLength(1);
        expect(summary.startupMetrics.files[0]?.entries).toBe(1);
        expect(summary.startupMetrics.warnings).toHaveLength(0);
        expect(summary.artifactTelemetry.entries).toBe(1);
        expect(summary.artifactTelemetry.warnings).toHaveLength(0);
    });

    test('renders markdown report with checklist and observability warnings', () => {
        const markdown = renderReleaseReadinessMarkdown({
            generatedAt: '2026-03-18T12:00:00.000Z',
            repositoryRoot: '/tmp/repo',
            requestedOptions: {
                buildDesktop: true,
                realE2E: false,
                appDataDir: undefined,
                startupProfile: undefined,
            },
            stages: [
                {
                    id: 'stage-1',
                    label: 'Example',
                    command: 'npm test',
                    cwd: '/tmp/repo/desktop',
                    durationMs: 1234,
                    status: 'passed',
                    exitCode: 0,
                },
            ],
            observability: {
                startupMetrics: {
                    inspected: false,
                    files: [],
                    warnings: ['No appDataDir provided; startup metrics inspection skipped.'],
                },
                artifactTelemetry: {
                    path: '/tmp/repo/.coworkany/self-learning/artifact-contract-telemetry.jsonl',
                    exists: false,
                    entries: 0,
                    warnings: ['Artifact telemetry file not found.'],
                },
            },
            checklist: createDefaultCanaryChecklist(),
        });

        expect(markdown).toContain('# Release Readiness Report');
        expect(markdown).toContain('## Canary Checklist');
        expect(markdown).toContain('Observability');
        expect(markdown).toContain('No appDataDir provided');
    });
});
