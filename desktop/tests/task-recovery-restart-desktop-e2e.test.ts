/**
 * Desktop GUI E2E: sidecar crash/restart task recovery
 *
 * Verifies that a running task survives a sidecar crash by:
 * - persisting a recoverable task snapshot
 * - letting the watchdog restart the packaged sidecar
 * - auto-resuming the interrupted task
 * - surfacing a real terminal result instead of hanging indefinitely
 *
 * Run:
 *   cd desktop && npx playwright test tests/task-recovery-restart-desktop-e2e.test.ts --reporter=line
 */

import { test, expect, type Locator } from './tauriFixtureRelease';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

process.env.COWORKANY_TASK_STALL_TIMEOUT_MS ??= '15000';

const TEST_TIMEOUT_MS = 6 * 60 * 1000;
const RELEASE_WORKSPACE_ROOT = path.join(process.cwd(), 'src-tauri', 'target', 'release', 'sidecar', 'workspace');
const INPUT_SELECTORS = [
    '.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    'input[placeholder*="鎸囦护"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

type Workspace = {
    id: string;
    name: string;
    path: string;
    createdAt?: string;
    lastUsedAt?: string;
};

type TaskSnapshot = {
    taskId: string;
    status: 'running' | 'finished' | 'failed' | 'recoverable_interrupted';
    workspacePath: string;
    updatedAt: string;
    lastSummary?: string;
    lastError?: string;
};

type TaskRuntimeDiagnosticEntry = {
    id: string;
    timestamp: string;
    taskId: string;
    kind: 'task_finished' | 'task_failed' | 'task_resumed';
    severity: 'info' | 'warn' | 'error';
    summary: string;
    errorCode?: string;
    recoverable?: boolean;
};

type MockProviderState = {
    baseUrl: string;
    close: () => Promise<void>;
    waitForInitialStream: () => Promise<void>;
    sawResumeRequest: () => boolean;
};

try {
    fs.rmSync(RELEASE_WORKSPACE_ROOT, { recursive: true, force: true });
} catch {
    // Ignore test workspace cleanup failures.
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tauriInvoke<TPayload>(
    page: any,
    command: string,
    args?: Record<string, unknown>
): Promise<TPayload> {
    return page.evaluate(async ({ commandName, commandArgs }) => {
        const tauriWindow = window as typeof window & {
            __TAURI_INTERNALS__?: {
                invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
            };
            __TAURI__?: {
                core?: {
                    invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
                };
            };
        };
        const invokeFn =
            tauriWindow.__TAURI_INTERNALS__?.invoke ??
            tauriWindow.__TAURI__?.core?.invoke;
        if (typeof invokeFn !== 'function') {
            throw new Error('Tauri invoke is unavailable in the desktop runtime.');
        }
        return invokeFn(commandName, commandArgs);
    }, {
        commandName: command,
        commandArgs: args,
    }) as Promise<TPayload>;
}

async function findChatInput(page: any, timeoutMs = 45_000): Promise<Locator | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const selector of INPUT_SELECTORS) {
            const candidate = page.locator(selector).first();
            const visible = await candidate.isVisible({ timeout: 800 }).catch(() => false);
            const enabled = await candidate.isEnabled().catch(() => false);
            if (visible && enabled) {
                return candidate;
            }
        }
        await sleep(400);
    }
    return null;
}

async function submitMessage(page: any, text: string): Promise<void> {
    const input = await findChatInput(page);
    expect(input, 'desktop UI should expose chat input').not.toBeNull();
    await input!.fill(text);
    await input!.press('Enter');
    await page.waitForTimeout(1500);
}

async function startFreshSession(page: any): Promise<void> {
    const newSessionButton = page.locator('.chat-header-new-session').first();
    const visible = await newSessionButton.isVisible({ timeout: 10_000 }).catch(() => false);
    expect(visible, 'new session button should be visible').toBe(true);
    await newSessionButton.click({ force: true });
    await page.waitForTimeout(1000);
}

async function openTaskInspector(page: any): Promise<void> {
    const button = page.locator('button[aria-label="Task inspector"]').first();
    await expect(button).toBeVisible({ timeout: 15_000 });
    await button.click({ force: true });
    await expect(page.locator('.modal-dialog-content .task-panel')).toBeVisible({ timeout: 15_000 });
}

function parsePowershellJson<T>(output: string): T[] {
    const trimmed = output.trim();
    if (!trimmed) {
        return [];
    }
    const parsed = JSON.parse(trimmed) as T | T[];
    return Array.isArray(parsed) ? parsed : [parsed];
}

function resolveSidecarPid(parentPid: number): number {
    const script = `$parentPid = ${parentPid}; Get-CimInstance Win32_Process -Filter "ParentProcessId = $parentPid" | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress`;

    const output = childProcess.execFileSync(
        'powershell',
        ['-NoProfile', '-Command', script],
        { encoding: 'utf-8' }
    );

    const processes = parsePowershellJson<{ ProcessId: number; Name?: string; CommandLine?: string }>(output);
    const sidecar = processes.find((process) => {
        const name = (process.Name ?? '').toLowerCase();
        const commandLine = (process.CommandLine ?? '').toLowerCase();
        return (
            name.includes('coworkany-sidecar') ||
            commandLine.includes('coworkany-sidecar') ||
            commandLine.includes('sidecar/src/main.ts')
        );
    });

    if (!sidecar?.ProcessId) {
        throw new Error(`Failed to locate sidecar child process under desktop PID ${parentPid}. Raw output: ${output}`);
    }

    return sidecar.ProcessId;
}

function killProcess(pid: number): void {
    childProcess.execFileSync('taskkill', ['/PID', String(pid), '/F'], {
        stdio: 'ignore',
    });
}

async function startMockProvider(): Promise<MockProviderState> {
    let sawResumeRequest = false;
    let resolveInitialStream!: () => void;
    const initialStreamPromise = new Promise<void>((resolve) => {
        resolveInitialStream = resolve;
    });
    const sockets = new Set<import('net').Socket>();

    const server = http.createServer(async (req, res) => {
        if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
            res.statusCode = 404;
            res.end('not_found');
            return;
        }

        const rawBody = await new Promise<string>((resolve, reject) => {
            let body = '';
            req.setEncoding('utf-8');
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => resolve(body));
            req.on('error', reject);
        });

        const payload = JSON.parse(rawBody) as {
            stream?: boolean;
            model?: string;
            messages?: Array<{ role?: string; content?: unknown }>;
        };

        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        const lastUser = [...messages].reverse().find((message) => message.role === 'user');
        const lastUserText = typeof lastUser?.content === 'string'
            ? lastUser.content
            : JSON.stringify(lastUser?.content ?? '');
        const isResumeRequest = /previous model connection dropped and the sidecar process restarted/i.test(lastUserText);

        if (!payload.stream) {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                id: 'mock-chat-validation',
                object: 'chat.completion',
                model: payload.model ?? 'mock-recovery-model',
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: {
                        role: 'assistant',
                        content: 'pong',
                    },
                }],
                usage: {
                    prompt_tokens: 1,
                    completion_tokens: 1,
                    total_tokens: 2,
                },
            }));
            return;
        }

        res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
        });

        if (isResumeRequest) {
            sawResumeRequest = true;
            const finalText = 'Recovery succeeded. Final result: RECOVERY_OK';
            res.write(`data: ${JSON.stringify({
                id: 'mock-chat-resume',
                object: 'chat.completion.chunk',
                model: payload.model ?? 'mock-recovery-model',
                choices: [{
                    index: 0,
                    delta: { content: finalText },
                    finish_reason: null,
                }],
            })}\n\n`);
            res.write(`data: ${JSON.stringify({
                id: 'mock-chat-resume',
                object: 'chat.completion.chunk',
                model: payload.model ?? 'mock-recovery-model',
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: 'stop',
                }],
                usage: {
                    prompt_tokens: 24,
                    completion_tokens: 9,
                    total_tokens: 33,
                },
            })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
        }

        resolveInitialStream();
        res.write(`data: ${JSON.stringify({
            id: 'mock-chat-initial',
            object: 'chat.completion.chunk',
            model: payload.model ?? 'mock-recovery-model',
            choices: [{
                index: 0,
                delta: { content: 'Starting recovery acceptance test. ' },
                finish_reason: null,
            }],
        })}\n\n`);

        const heartbeat = setInterval(() => {
            try {
                res.write(': keep-alive\n\n');
            } catch {
                clearInterval(heartbeat);
            }
        }, 1000);

        const cleanup = () => clearInterval(heartbeat);
        req.on('close', cleanup);
        res.on('close', cleanup);
    });
    server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => {
            sockets.delete(socket);
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Mock provider failed to allocate a TCP port.');
    }

    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1/chat/completions`,
        close: () => new Promise<void>((resolve, reject) => {
            for (const socket of sockets) {
                socket.destroy();
            }
            server.close((error) => (error ? reject(error) : resolve()));
        }),
        waitForInitialStream: () => initialStreamPromise,
        sawResumeRequest: () => sawResumeRequest,
    };
}

async function startMockStalledProvider(): Promise<MockProviderState> {
    let sawResumeRequest = false;
    let resolveInitialStream!: () => void;
    const initialStreamPromise = new Promise<void>((resolve) => {
        resolveInitialStream = resolve;
    });
    const sockets = new Set<import('net').Socket>();

    const server = http.createServer(async (req, res) => {
        if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
            res.statusCode = 404;
            res.end('not_found');
            return;
        }

        const rawBody = await new Promise<string>((resolve, reject) => {
            let body = '';
            req.setEncoding('utf-8');
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => resolve(body));
            req.on('error', reject);
        });

        const payload = JSON.parse(rawBody) as {
            stream?: boolean;
            model?: string;
            messages?: Array<{ role?: string; content?: unknown }>;
        };

        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        const lastUser = [...messages].reverse().find((message) => message.role === 'user');
        const lastUserText = typeof lastUser?.content === 'string'
            ? lastUser.content
            : JSON.stringify(lastUser?.content ?? '');
        sawResumeRequest = /previous model connection dropped and the sidecar process restarted/i.test(lastUserText);

        if (!payload.stream) {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                id: 'mock-chat-validation',
                object: 'chat.completion',
                model: payload.model ?? 'mock-stalled-model',
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: {
                        role: 'assistant',
                        content: 'pong',
                    },
                }],
                usage: {
                    prompt_tokens: 1,
                    completion_tokens: 1,
                    total_tokens: 2,
                },
            }));
            return;
        }

        res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
        });

        resolveInitialStream();
        res.write(`data: ${JSON.stringify({
            id: 'mock-chat-stalled',
            object: 'chat.completion.chunk',
            model: payload.model ?? 'mock-stalled-model',
            choices: [{
                index: 0,
                delta: { content: 'Stalled response started. ' },
                finish_reason: null,
            }],
        })}\n\n`);

        const heartbeat = setInterval(() => {
            try {
                res.write(': keep-alive\n\n');
            } catch {
                clearInterval(heartbeat);
            }
        }, 1000);

        const cleanup = () => clearInterval(heartbeat);
        req.on('close', cleanup);
        res.on('close', cleanup);
    });
    server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => {
            sockets.delete(socket);
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Mock stalled provider failed to allocate a TCP port.');
    }

    return {
        baseUrl: `http://127.0.0.1:${address.port}/v1/chat/completions`,
        close: () => new Promise<void>((resolve, reject) => {
            for (const socket of sockets) {
                socket.destroy();
            }
            server.close((error) => (error ? reject(error) : resolve()));
        }),
        waitForInitialStream: () => initialStreamPromise,
        sawResumeRequest: () => sawResumeRequest,
    };
}

async function waitForTaskSnapshot(page: any, sinceMs: number, timeoutMs = 45_000): Promise<{ workspace: Workspace; snapshotPath: string; snapshot: TaskSnapshot }> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const result = await tauriInvoke<{ success: boolean; payload: unknown }>(page, 'list_workspaces');
        const payload = result?.payload as { workspaces?: Workspace[]; payload?: { workspaces?: Workspace[] } } | undefined;
        const workspaces = payload?.workspaces ?? payload?.payload?.workspaces ?? [];

        for (const workspace of workspaces) {
            if (!workspace?.path || !fs.existsSync(workspace.path)) {
                continue;
            }

            const snapshotDir = path.join(workspace.path, '.coworkany', 'runtime', 'tasks');
            if (!fs.existsSync(snapshotDir)) {
                continue;
            }

            for (const entry of fs.readdirSync(snapshotDir)) {
                if (!entry.endsWith('.json')) {
                    continue;
                }
                const snapshotPath = path.join(snapshotDir, entry);
                const stats = fs.statSync(snapshotPath);
                if (stats.mtimeMs < sinceMs) {
                    continue;
                }
                const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as TaskSnapshot;
                return { workspace, snapshotPath, snapshot };
            }
        }

        await sleep(1000);
    }

    throw new Error('Timed out waiting for a fresh task runtime snapshot.');
}

async function waitForRecoveryLogs(tauriLogs: any, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let rawLogs = '';

    while (Date.now() < deadline) {
        await sleep(2000);
        rawLogs = tauriLogs.getRawSinceBaseline();
        const hasResumeCommand = rawLogs.includes('resume_recoverable_tasks_response');
        const hasResumed = rawLogs.includes('"type":"TASK_RESUMED"');
        const hasFinished = rawLogs.includes('"type":"TASK_FINISHED"');
        const hasResult = rawLogs.includes('RECOVERY_OK');
        const hasFailed = rawLogs.includes('"type":"TASK_FAILED"');

        if (hasFailed) {
            throw new Error(`Task recovery flow failed.\n${rawLogs}`);
        }

        if (hasResumeCommand && hasResumed && hasFinished && hasResult) {
            return rawLogs;
        }
    }

    throw new Error(`Timed out waiting for recovery completion.\n${rawLogs}`);
}

async function waitForTerminalTimeoutLogs(tauriLogs: any, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let rawLogs = '';

    while (Date.now() < deadline) {
        await sleep(1500);
        rawLogs = tauriLogs.getRawSinceBaseline();
        const hasTimeoutFailure = rawLogs.includes('"type":"TASK_FAILED"') &&
            rawLogs.includes('TASK_TERMINAL_TIMEOUT') &&
            rawLogs.includes('Task stalled without producing a terminal result.');

        if (hasTimeoutFailure) {
            return rawLogs;
        }
    }

    throw new Error(`Timed out waiting for terminal-timeout watchdog failure.\n${rawLogs}`);
}

test.describe('Desktop GUI E2E - sidecar restart task recovery', () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    test('restores an interrupted task after the packaged sidecar crashes', async ({ page, tauriLogs, tauriProcess }) => {
        test.skip(process.platform !== 'win32', 'Tauri WebView2 E2E runs on Windows.');

        const mockProvider = await startMockProvider();
        const resultsDir = path.join(process.cwd(), 'test-results');
        fs.mkdirSync(resultsDir, { recursive: true });

        try {
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(10_000);
            await startFreshSession(page);
            const chatWorkspaceMain = page.locator('.chat-workspace-main');
            const taskPanel = page.locator('.modal-dialog-content .task-panel');

            await tauriInvoke(page, 'save_llm_settings', {
                input: {
                    provider: 'custom',
                    activeProfileId: 'recovery-e2e',
                    profiles: [{
                        id: 'recovery-e2e',
                        name: 'Recovery E2E',
                        provider: 'custom',
                        verified: true,
                        custom: {
                            apiKey: 'mock-recovery-key',
                            baseUrl: mockProvider.baseUrl,
                            model: 'mock-recovery-model',
                            apiFormat: 'openai',
                        },
                    }],
                },
            });

            await page.waitForTimeout(2500);
            tauriLogs.setBaseline();

            await submitMessage(
                page,
                'Run the restart recovery acceptance task. Finish with the exact text RECOVERY_OK after you recover.'
            );

            await mockProvider.waitForInitialStream();

            const { snapshotPath, snapshot } = await waitForTaskSnapshot(page, Date.now() - 30_000);
            expect(snapshot.status, 'pre-crash snapshot should mark the task as running').toBe('running');
            expect(snapshot.workspacePath, 'snapshot should record a real workspace path').toBeTruthy();
            expect(fs.existsSync(snapshot.workspacePath), 'snapshot workspace path should exist on disk').toBe(true);
            expect(fs.existsSync(snapshotPath), 'runtime snapshot should exist before the sidecar crashes').toBe(true);

            const sidecarPid = resolveSidecarPid(tauriProcess.pid!);
            killProcess(sidecarPid);

            const rawLogs = await waitForRecoveryLogs(tauriLogs, 90_000);
            expect(mockProvider.sawResumeRequest(), 'restarted sidecar should issue a resumed LLM request').toBe(true);
            expect(rawLogs).toContain('"type":"TASK_RESUMED"');
            expect(rawLogs).toContain('"type":"TASK_FINISHED"');
            expect(rawLogs).toContain('RECOVERY_OK');

            await expect(chatWorkspaceMain.getByText(/Task resumed/i).first()).toBeVisible({ timeout: 30_000 });
            await expect(chatWorkspaceMain.getByText('Recovery succeeded. Final result: RECOVERY_OK', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
            await openTaskInspector(page);
            await expect(taskPanel.getByText('Diagnostics', { exact: true })).toBeVisible({ timeout: 30_000 });
            await expect(taskPanel.getByText(/Recovered: Recovered after sidecar restart/i).first()).toBeVisible({ timeout: 30_000 });
            await expect(taskPanel.getByText(/Completed: Recovery succeeded\. Final result: RECOVERY_OK/i).first()).toBeVisible({ timeout: 30_000 });

            const finalSnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as TaskSnapshot;
            expect(finalSnapshot.status, 'final snapshot should record a terminal finished state').toBe('finished');
            expect(finalSnapshot.lastSummary ?? '', 'final snapshot summary should contain the real result').toContain('RECOVERY_OK');

            const diagnosticsPath = path.join(snapshot.workspacePath, '.coworkany', 'runtime', 'task-diagnostics.jsonl');
            expect(fs.existsSync(diagnosticsPath), 'task diagnostics log should exist after recovery').toBe(true);
            const diagnosticsEntries = fs.readFileSync(diagnosticsPath, 'utf-8')
                .trim()
                .split(/\r?\n/)
                .filter(Boolean)
                .map((line) => JSON.parse(line) as TaskRuntimeDiagnosticEntry)
                .filter((entry) => entry.taskId === snapshot.taskId);
            expect(diagnosticsEntries.some((entry) => entry.kind === 'task_resumed')).toBe(true);
            expect(diagnosticsEntries.some((entry) => entry.kind === 'task_finished' && /RECOVERY_OK/.test(entry.summary))).toBe(true);

            await page.screenshot({
                path: path.join(resultsDir, 'task-recovery-restart-desktop-e2e-final.png'),
            }).catch(() => {});
        } finally {
            await mockProvider.close();
        }
    });

    test('fails a stalled task with a runtime timeout and surfaces diagnostics', async ({ page, tauriLogs }) => {
        test.skip(process.platform !== 'win32', 'Tauri WebView2 E2E runs on Windows.');

        const mockProvider = await startMockStalledProvider();
        const resultsDir = path.join(process.cwd(), 'test-results');
        fs.mkdirSync(resultsDir, { recursive: true });

        try {
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(10_000);
            await startFreshSession(page);
            const taskPanel = page.locator('.modal-dialog-content .task-panel');

            await tauriInvoke(page, 'save_llm_settings', {
                input: {
                    provider: 'custom',
                    activeProfileId: 'stall-watchdog-e2e',
                    profiles: [{
                        id: 'stall-watchdog-e2e',
                        name: 'Stall Watchdog E2E',
                        provider: 'custom',
                        verified: true,
                        custom: {
                            apiKey: 'mock-stalled-key',
                            baseUrl: mockProvider.baseUrl,
                            model: 'mock-stalled-model',
                            apiFormat: 'openai',
                        },
                    }],
                },
            });

            await page.waitForTimeout(2500);
            tauriLogs.setBaseline();

            await submitMessage(
                page,
                'Start a task that stalls forever after the first token. Do not finish it.'
            );

            await mockProvider.waitForInitialStream();
            const { snapshotPath, snapshot } = await waitForTaskSnapshot(page, Date.now() - 30_000);
            expect(snapshot.status, 'stalled task should still snapshot as running before watchdog fires').toBe('running');

            const rawLogs = await waitForTerminalTimeoutLogs(tauriLogs, 30_000);
            expect(rawLogs).toContain('"type":"TASK_FAILED"');
            expect(rawLogs).toContain('TASK_TERMINAL_TIMEOUT');
            expect(rawLogs).toContain('Task stalled without producing a terminal result.');
            expect(mockProvider.sawResumeRequest(), 'stall watchdog scenario should not trigger recovery continuation').toBe(false);

            await openTaskInspector(page);
            await expect(taskPanel.getByText('Diagnostics', { exact: true })).toBeVisible({ timeout: 30_000 });
            await expect(taskPanel.getByText(/Task stalled without producing a terminal result\./i).first()).toBeVisible({ timeout: 30_000 });
            await expect(taskPanel.getByText(/TASK_TERMINAL_TIMEOUT/i).first()).toBeVisible({ timeout: 30_000 });

            const finalSnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as TaskSnapshot;
            expect(finalSnapshot.status, 'stalled task snapshot should become recoverable_interrupted after watchdog failure').toBe('recoverable_interrupted');
            expect(finalSnapshot.lastError ?? '', 'stalled task snapshot should record the watchdog error').toContain('Task stalled without producing a terminal result.');

            const diagnosticsPath = path.join(snapshot.workspacePath, '.coworkany', 'runtime', 'task-diagnostics.jsonl');
            expect(fs.existsSync(diagnosticsPath), 'task diagnostics log should exist after stall watchdog failure').toBe(true);
            const diagnosticsEntries = fs.readFileSync(diagnosticsPath, 'utf-8')
                .trim()
                .split(/\r?\n/)
                .filter(Boolean)
                .map((line) => JSON.parse(line) as TaskRuntimeDiagnosticEntry)
                .filter((entry) => entry.taskId === snapshot.taskId);
            expect(diagnosticsEntries.some((entry) =>
                entry.kind === 'task_failed' &&
                entry.errorCode === 'TASK_TERMINAL_TIMEOUT' &&
                /Task stalled without producing a terminal result\./.test(entry.summary)
            )).toBe(true);

            await page.screenshot({
                path: path.join(resultsDir, 'task-stall-timeout-desktop-e2e-final.png'),
            }).catch(() => {});
        } finally {
            await mockProvider.close();
        }
    });
});
