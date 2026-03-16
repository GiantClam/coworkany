import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
    appendTaskRuntimeDiagnostic,
    getTaskRuntimeDiagnosticsPath,
} from '../src/agent/taskRuntimeDiagnostics';

describe('task runtime diagnostics', () => {
    test('appends diagnostics to the workspace runtime log', () => {
        const workspacePath = path.join(os.tmpdir(), `coworkany-diagnostics-${randomUUID()}`);
        const entry = appendTaskRuntimeDiagnostic(workspacePath, {
            taskId: '330f06be-1f4e-4e3a-976c-89cb29c9a9d4',
            kind: 'task_failed',
            severity: 'warn',
            summary: 'Task stalled without producing a terminal result.',
            errorCode: 'TASK_TERMINAL_TIMEOUT',
            recoverable: true,
        });

        const diagnosticsPath = getTaskRuntimeDiagnosticsPath(workspacePath);
        expect(fs.existsSync(diagnosticsPath)).toBe(true);

        const lines = fs.readFileSync(diagnosticsPath, 'utf-8').trim().split(/\r?\n/);
        expect(lines).toHaveLength(1);

        const parsed = JSON.parse(lines[0]) as typeof entry;
        expect(parsed.taskId).toBe(entry.taskId);
        expect(parsed.kind).toBe('task_failed');
        expect(parsed.errorCode).toBe('TASK_TERMINAL_TIMEOUT');

        fs.rmSync(workspacePath, { recursive: true, force: true });
    });
});
