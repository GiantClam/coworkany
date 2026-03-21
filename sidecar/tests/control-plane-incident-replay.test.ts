import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { replayControlPlaneIncident } from '../src/doctor/controlPlaneIncidentReplay';

describe('control-plane incident replay', () => {
    test('replays a saved event log as a single incident eval bundle', async () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-incident-replay-output-'));
        const eventLogPath = '/Users/beihuang/Documents/github/coworkany/sidecar/evals/control-plane/event-logs/runtime-followup-reopen.jsonl';

        const result = await replayControlPlaneIncident({
            eventLogPath,
            caseId: 'incident-followup-reopen',
            description: 'Replay saved follow-up reopen incident',
            productionReplaySource: 'canary',
            outputDir,
        });

        expect(result.summary.totals.totalCases).toBe(1);
        expect(result.summary.totals.passedCases).toBe(1);
        expect(result.summary.coverage.productionReplaySources.canary?.totalCases).toBe(1);
        expect(result.outputPaths?.caseJsonPath).toBe(path.join(outputDir, 'incident-case.json'));
        expect(result.outputPaths?.summaryJsonPath).toBe(path.join(outputDir, 'incident-eval-summary.json'));
        expect(fs.existsSync(path.join(outputDir, 'incident-case.json'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'incident-eval-summary.json'))).toBe(true);
        expect(result.renderedSummary).toContain('Cases: 1/1 passed');
    });
});
