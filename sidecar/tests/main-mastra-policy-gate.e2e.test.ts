import { afterEach, describe, expect, test } from 'bun:test';
import { spawn, type Subprocess } from 'bun';
import * as fs from 'fs';
import * as path from 'path';

type JsonMessage = Record<string, unknown>;

function resolveSidecarCwd(): string {
    const nested = path.join(process.cwd(), 'sidecar', 'src', 'main.ts');
    if (fs.existsSync(nested)) {
        return path.join(process.cwd(), 'sidecar');
    }
    return process.cwd();
}

function toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

class MastraStdioSession {
    private proc: Subprocess | null = null;
    private stdoutBuffer = '';
    private stderrBuffer = '';
    readonly messages: JsonMessage[] = [];
    private readonly cwd: string;
    private readonly env: NodeJS.ProcessEnv;

    constructor(options?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
        this.cwd = options?.cwd ?? resolveSidecarCwd();
        this.env = {
            ...process.env,
            ...(options?.env ?? {}),
        };
    }

    async start(): Promise<void> {
        this.proc = spawn({
            cmd: ['bun', 'run', 'src/main.ts'],
            cwd: this.cwd,
            env: this.env,
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
        });
        this.readStdout();
        this.readStderr();
        await this.waitFor(
            (message) => message.type === 'ready' && message.runtime === 'mastra',
            20_000,
        );
    }

    private readStdout(): void {
        if (!this.proc) {
            return;
        }
        const stdoutStream = this.proc.stdout;
        (async () => {
            try {
                for await (const chunk of stdoutStream) {
                    this.stdoutBuffer += new TextDecoder().decode(chunk);
                    const lines = this.stdoutBuffer.split('\n');
                    this.stdoutBuffer = lines.pop() ?? '';
                    for (const line of lines) {
                        if (!line.trim()) {
                            continue;
                        }
                        try {
                            const parsed = JSON.parse(line) as unknown;
                            this.messages.push(toRecord(parsed));
                        } catch {
                            // ignore non-json lines
                        }
                    }
                }
            } catch {
                // stream closed
            }
        })();
    }

    private readStderr(): void {
        if (!this.proc) {
            return;
        }
        const stderrStream = this.proc.stderr;
        (async () => {
            try {
                for await (const chunk of stderrStream) {
                    this.stderrBuffer += new TextDecoder().decode(chunk);
                }
            } catch {
                // stream closed
            }
        })();
    }

    send(message: JsonMessage): void {
        if (!this.proc?.stdin) {
            throw new Error('sidecar stdin unavailable');
        }
        this.proc.stdin.write(`${JSON.stringify(message)}\n`);
        this.proc.stdin.flush();
    }

    closeStdin(): void {
        const stdin = this.proc?.stdin as unknown as { end?: () => void; close?: () => void } | undefined;
        if (stdin?.end) {
            stdin.end();
            return;
        }
        if (stdin?.close) {
            stdin.close();
        }
    }

    async waitFor(
        predicate: (message: JsonMessage) => boolean,
        timeoutMs: number,
    ): Promise<JsonMessage> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const hit = this.messages.find((message) => predicate(message));
            if (hit) {
                return hit;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const recent = this.messages.slice(-8);
        throw new Error(
            `waitFor timed out after ${timeoutMs}ms. recent=${JSON.stringify(recent)} stderr=${this.stderrBuffer.slice(-400)}`,
        );
    }

    stop(): void {
        if (this.proc) {
            this.proc.kill();
            this.proc = null;
        }
    }
}

let session: MastraStdioSession | null = null;

afterEach(() => {
    session?.stop();
    session = null;
});

describe('main-mastra policy-gate stdio e2e', () => {
    test('retries read_file forwarding on timeout and succeeds on second desktop response', async () => {
        session = new MastraStdioSession({
            env: {
                COWORKANY_POLICY_GATE_FORWARD_TIMEOUT_MS: '30',
                COWORKANY_POLICY_GATE_TIMEOUT_RETRY_COUNT: '1',
            },
        });
        await session.start();

        const commandId = 'cmd-read-file-retry-e2e';
        session.send({
            id: commandId,
            timestamp: new Date().toISOString(),
            type: 'read_file',
            payload: {
                path: '/tmp/retry-e2e.txt',
            },
        });

        const firstForward = await session.waitFor(
            (message) =>
                message.type === 'read_file'
                && typeof message.id === 'string'
                && toRecord(message.payload).path === '/tmp/retry-e2e.txt',
            5_000,
        );
        const firstForwardId = String(firstForward.id);

        const secondForward = await session.waitFor(
            (message) =>
                message.type === 'read_file'
                && typeof message.id === 'string'
                && String(message.id) !== firstForwardId
                && toRecord(message.payload).path === '/tmp/retry-e2e.txt',
            5_000,
        );
        const secondForwardId = String(secondForward.id);

        session.send({
            type: 'read_file_response',
            commandId: secondForwardId,
            timestamp: new Date().toISOString(),
            payload: {
                success: true,
                content: 'retry-e2e-ok',
            },
        });

        const finalResponse = await session.waitFor(
            (message) =>
                message.type === 'read_file_response'
                && message.commandId === commandId,
            5_000,
        );
        const payload = toRecord(finalResponse.payload);
        expect(payload.success).toBe(true);
        expect(payload.content).toBe('retry-e2e-ok');

        const forwardedCount = session.messages.filter((message) =>
            message.type === 'read_file'
            && toRecord(message.payload).path === '/tmp/retry-e2e.txt',
        ).length;
        expect(forwardedCount).toBeGreaterThanOrEqual(2);
    }, 30_000);

    test('closing stdin fails pending read_file forwarding quickly with stdin_closed marker', async () => {
        session = new MastraStdioSession({
            env: {
                COWORKANY_POLICY_GATE_FORWARD_TIMEOUT_MS: '30000',
                COWORKANY_POLICY_GATE_TIMEOUT_RETRY_COUNT: '1',
            },
        });
        await session.start();

        const commandId = 'cmd-read-file-close-e2e';
        session.send({
            id: commandId,
            timestamp: new Date().toISOString(),
            type: 'read_file',
            payload: {
                path: '/tmp/close-e2e.txt',
            },
        });

        await session.waitFor(
            (message) =>
                message.type === 'read_file'
                && typeof message.id === 'string'
                && toRecord(message.payload).path === '/tmp/close-e2e.txt',
            5_000,
        );

        session.closeStdin();

        const response = await session.waitFor(
            (message) =>
                message.type === 'read_file_response'
                && message.commandId === commandId,
            8_000,
        );
        const payload = toRecord(response.payload);
        expect(payload.success).toBe(false);
        expect(String(payload.error ?? '')).toContain('policy_gate_unavailable:stdin_closed');
    }, 30_000);

    test('forwards exec_shell and maps desktop response payload end-to-end', async () => {
        session = new MastraStdioSession();
        await session.start();

        const commandId = 'cmd-exec-shell-e2e';
        session.send({
            id: commandId,
            timestamp: new Date().toISOString(),
            type: 'exec_shell',
            payload: {
                command: 'echo policy-gate-e2e',
            },
        });

        const forwarded = await session.waitFor(
            (message) =>
                message.type === 'exec_shell'
                && typeof message.id === 'string'
                && toRecord(message.payload).command === 'echo policy-gate-e2e',
            5_000,
        );
        const forwardedId = String(forwarded.id);

        session.send({
            type: 'exec_shell_response',
            commandId: forwardedId,
            timestamp: new Date().toISOString(),
            payload: {
                success: true,
                stdout: 'policy-gate-e2e\n',
                stderr: '',
                exitCode: 0,
            },
        });

        const response = await session.waitFor(
            (message) =>
                message.type === 'exec_shell_response'
                && message.commandId === commandId,
            5_000,
        );
        const payload = toRecord(response.payload);
        expect(payload.success).toBe(true);
        expect(payload.stdout).toBe('policy-gate-e2e\n');
        expect(payload.exitCode).toBe(0);
    }, 30_000);

    test('forwards propose_patch and reject_patch with stable response mapping end-to-end', async () => {
        session = new MastraStdioSession();
        await session.start();

        const patchId = 'patch-e2e-1';
        const proposeCommandId = 'cmd-propose-patch-e2e';
        session.send({
            id: proposeCommandId,
            timestamp: new Date().toISOString(),
            type: 'propose_patch',
            payload: {
                patchId,
                title: 'demo patch',
                diff: '*** Begin Patch\n*** End Patch\n',
            },
        });
        const proposeForward = await session.waitFor(
            (message) =>
                message.type === 'propose_patch'
                && typeof message.id === 'string'
                && toRecord(message.payload).patchId === patchId,
            5_000,
        );
        session.send({
            type: 'propose_patch_response',
            commandId: String(proposeForward.id),
            timestamp: new Date().toISOString(),
            payload: {
                success: true,
                patchId,
            },
        });
        const proposeResponse = await session.waitFor(
            (message) =>
                message.type === 'propose_patch_response'
                && message.commandId === proposeCommandId,
            5_000,
        );
        expect(toRecord(proposeResponse.payload).success).toBe(true);
        expect(toRecord(proposeResponse.payload).patchId).toBe(patchId);

        const rejectCommandId = 'cmd-reject-patch-e2e';
        session.send({
            id: rejectCommandId,
            timestamp: new Date().toISOString(),
            type: 'reject_patch',
            payload: {
                patchId,
                reason: 'not needed',
            },
        });
        const rejectForward = await session.waitFor(
            (message) =>
                message.type === 'reject_patch'
                && typeof message.id === 'string'
                && toRecord(message.payload).patchId === patchId,
            5_000,
        );
        session.send({
            type: 'reject_patch_response',
            commandId: String(rejectForward.id),
            timestamp: new Date().toISOString(),
            payload: {
                success: true,
                patchId,
            },
        });
        const rejectResponse = await session.waitFor(
            (message) =>
                message.type === 'reject_patch_response'
                && message.commandId === rejectCommandId,
            5_000,
        );
        expect(toRecord(rejectResponse.payload).success).toBe(true);
        expect(toRecord(rejectResponse.payload).patchId).toBe(patchId);
    }, 30_000);

    test('returns policy_gate_invalid_response when desktop returns mismatched response type', async () => {
        session = new MastraStdioSession();
        await session.start();

        const commandId = 'cmd-list-dir-invalid-e2e';
        session.send({
            id: commandId,
            timestamp: new Date().toISOString(),
            type: 'list_dir',
            payload: {
                path: '/tmp',
            },
        });
        const forwarded = await session.waitFor(
            (message) =>
                message.type === 'list_dir'
                && typeof message.id === 'string'
                && toRecord(message.payload).path === '/tmp',
            5_000,
        );
        session.send({
            type: 'read_file_response',
            commandId: String(forwarded.id),
            timestamp: new Date().toISOString(),
            payload: {
                success: true,
                content: 'unexpected',
            },
        });

        const response = await session.waitFor(
            (message) =>
                message.type === 'list_dir_response'
                && message.commandId === commandId,
            5_000,
        );
        const payload = toRecord(response.payload);
        expect(payload.success).toBe(false);
        expect(payload.error).toBe('policy_gate_invalid_response:read_file_response');
    }, 30_000);

    test('policy-gate bridge snapshot captures duplicate/orphan forwarded responses', async () => {
        session = new MastraStdioSession();
        await session.start();

        const commandId = 'cmd-policy-gate-stats-e2e';
        session.send({
            id: commandId,
            timestamp: new Date().toISOString(),
            type: 'read_file',
            payload: {
                path: '/tmp/policy-gate-stats-e2e.txt',
            },
        });
        const forwarded = await session.waitFor(
            (message) =>
                message.type === 'read_file'
                && typeof message.id === 'string'
                && toRecord(message.payload).path === '/tmp/policy-gate-stats-e2e.txt',
            5_000,
        );
        const forwardedId = String(forwarded.id);

        session.send({
            type: 'read_file_response',
            commandId: forwardedId,
            timestamp: new Date().toISOString(),
            payload: {
                success: true,
                content: 'first',
            },
        });
        await session.waitFor(
            (message) =>
                message.type === 'read_file_response'
                && message.commandId === commandId,
            5_000,
        );

        session.send({
            type: 'read_file_response',
            commandId: forwardedId,
            timestamp: new Date().toISOString(),
            payload: {
                success: true,
                content: 'duplicate',
            },
        });
        session.send({
            type: 'read_file_response',
            commandId: 'orphan-forward-id-e2e',
            timestamp: new Date().toISOString(),
            payload: {
                success: true,
                content: 'orphan',
            },
        });

        const snapshotId = 'cmd-policy-gate-stats-snapshot-e2e';
        session.send({
            id: snapshotId,
            timestamp: new Date().toISOString(),
            type: 'get_runtime_snapshot',
            payload: {},
        });
        const snapshotResponse = await session.waitFor(
            (message) =>
                message.type === 'get_runtime_snapshot_response'
                && message.commandId === snapshotId,
            5_000,
        );
        const snapshot = toRecord(toRecord(snapshotResponse.payload).snapshot);
        const bridge = toRecord(snapshot.policyGateBridge);
        expect(Number(bridge.forwardedRequests)).toBeGreaterThanOrEqual(1);
        expect(Number(bridge.successfulResponses)).toBeGreaterThanOrEqual(1);
        expect(Number(bridge.duplicateResponses)).toBeGreaterThanOrEqual(1);
        expect(Number(bridge.orphanResponses)).toBeGreaterThanOrEqual(1);
    }, 30_000);

    test('apply_patch maps stdin_closed to io_error when policy-gate transport closes', async () => {
        session = new MastraStdioSession({
            env: {
                COWORKANY_POLICY_GATE_FORWARD_TIMEOUT_MS: '30000',
                COWORKANY_POLICY_GATE_TIMEOUT_RETRY_COUNT: '0',
            },
        });
        await session.start();

        const commandId = 'cmd-apply-patch-close-e2e';
        session.send({
            id: commandId,
            timestamp: new Date().toISOString(),
            type: 'apply_patch',
            payload: {
                patchId: 'patch-apply-close-e2e',
                diff: '*** Begin Patch\n*** End Patch\n',
            },
        });
        await session.waitFor(
            (message) =>
                message.type === 'apply_patch'
                && typeof message.id === 'string'
                && toRecord(message.payload).patchId === 'patch-apply-close-e2e',
            5_000,
        );

        session.closeStdin();

        const response = await session.waitFor(
            (message) =>
                message.type === 'apply_patch_response'
                && message.commandId === commandId,
            8_000,
        );
        const payload = toRecord(response.payload);
        expect(payload.patchId).toBe('patch-apply-close-e2e');
        expect(payload.success).toBe(false);
        expect(payload.errorCode).toBe('io_error');
        expect(String(payload.error ?? '')).toContain('policy_gate_unavailable:stdin_closed');
    }, 30_000);
});
