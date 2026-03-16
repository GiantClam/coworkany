import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type TaskRuntimeDiagnosticKind =
    | 'task_finished'
    | 'task_failed'
    | 'task_resumed';

export type TaskRuntimeDiagnosticSeverity = 'info' | 'warn' | 'error';

export type TaskRuntimeDiagnosticEntry = {
    id: string;
    timestamp: string;
    taskId: string;
    kind: TaskRuntimeDiagnosticKind;
    severity: TaskRuntimeDiagnosticSeverity;
    summary: string;
    errorCode?: string;
    recoverable?: boolean;
};

export function getTaskRuntimeDiagnosticsPath(workspacePath: string): string {
    return path.join(workspacePath, '.coworkany', 'runtime', 'task-diagnostics.jsonl');
}

export function appendTaskRuntimeDiagnostic(
    workspacePath: string,
    entry: Omit<TaskRuntimeDiagnosticEntry, 'id' | 'timestamp'> &
        Partial<Pick<TaskRuntimeDiagnosticEntry, 'id' | 'timestamp'>>,
): TaskRuntimeDiagnosticEntry {
    const normalized: TaskRuntimeDiagnosticEntry = {
        id: entry.id ?? randomUUID(),
        timestamp: entry.timestamp ?? new Date().toISOString(),
        taskId: entry.taskId,
        kind: entry.kind,
        severity: entry.severity,
        summary: entry.summary,
        errorCode: entry.errorCode,
        recoverable: entry.recoverable,
    };

    const diagnosticsPath = getTaskRuntimeDiagnosticsPath(workspacePath);
    fs.mkdirSync(path.dirname(diagnosticsPath), { recursive: true });
    fs.appendFileSync(diagnosticsPath, `${JSON.stringify(normalized)}\n`, 'utf-8');
    return normalized;
}
