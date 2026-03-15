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

const TEST_TIMEOUT_MS = 6 * 60 * 1000;
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

type MockProviderState = {
    baseUrl: string;
    close: () => Promise<void>;
    waitForInitialStream: () => Promise<void>;
    sawResumeRequest: () => boolean;
};

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

            await expect(page.getByText(/Task resumed/i)).toBeVisible({ timeout: 30_000 });
            await expect(page.getByText('Recovery succeeded. Final result: RECOVERY_OK')).toBeVisible({ timeout: 30_000 });

            const finalSnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as TaskSnapshot;
            expect(finalSnapshot.status, 'final snapshot should record a terminal finished state').toBe('finished');
            expect(finalSnapshot.lastSummary ?? '', 'final snapshot summary should contain the real result').toContain('RECOVERY_OK');

            await page.screenshot({
                path: path.join(resultsDir, 'task-recovery-restart-desktop-e2e-final.png'),
            }).catch(() => {});
        } finally {
            await mockProvider.close();
        }
    });
});
