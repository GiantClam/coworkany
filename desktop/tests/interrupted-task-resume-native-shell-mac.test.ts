import { test, expect } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TauriLogCollector } from './tauriFixture';

const __filenameLocal = fileURLToPath(import.meta.url);
const __dirnameLocal = path.dirname(__filenameLocal);
const DESKTOP_DIR = path.resolve(__dirnameLocal, '..');
const APP_IDENTIFIER = 'com.coworkany.desktop';
const TASK_ID = '33333333-3333-4333-8333-333333333333';

type PersistedTaskRuntimeRecord = {
    taskId: string;
    status: string;
    [key: string]: unknown;
};

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonFile(filePath: string, payload: unknown): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
    fn: () => T | Promise<T>,
    predicate: (value: T) => boolean,
    timeoutMs: number,
    description: string,
): Promise<T> {
    const start = Date.now();
    let lastValue: T | undefined;

    while (Date.now() - start < timeoutMs) {
        lastValue = await fn();
        if (predicate(lastValue)) {
            return lastValue;
        }
        await wait(500);
    }

    throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}`);
}

function appDataDirForHome(homeDir: string): string {
    return path.join(homeDir, 'Library', 'Application Support', APP_IDENTIFIER);
}

function seedAppData(appDataDir: string): void {
    const now = new Date().toISOString();

    writeJsonFile(path.join(appDataDir, 'settings.json'), {
        setupCompleted: true,
    });

    writeJsonFile(path.join(appDataDir, 'sessions.json'), {
        sessions: [
            {
                taskId: TASK_ID,
                status: 'running',
                title: 'Native shell resume task',
                planSteps: [],
                toolCalls: [],
                effects: [],
                patches: [],
                messages: [],
                events: [],
                createdAt: now,
                updatedAt: now,
                workspacePath: DESKTOP_DIR,
            },
        ],
        activeTaskId: TASK_ID,
    });

    writeJsonFile(path.join(appDataDir, 'task-runtime.json'), [
        {
            taskId: TASK_ID,
            title: 'Native shell resume task',
            workspacePath: DESKTOP_DIR,
            createdAt: now,
            updatedAt: now,
            status: 'interrupted',
            conversation: [
                {
                    role: 'user',
                    content: 'Continue the saved native shell recovery task from the existing context.',
                },
                {
                    role: 'assistant',
                    content: 'Saved context is available.',
                },
            ],
            config: {
                workspacePath: DESKTOP_DIR,
                enabledToolpacks: [],
                enabledClaudeSkills: [],
                enabledSkills: [],
            },
            historyLimit: 50,
            artifactsCreated: [],
        },
    ]);
}

function readRuntimeRecords(appDataDir: string): PersistedTaskRuntimeRecord[] {
    const runtimePath = path.join(appDataDir, 'task-runtime.json');
    const raw = fs.readFileSync(runtimePath, 'utf-8');
    return JSON.parse(raw) as PersistedTaskRuntimeRecord[];
}

async function runNativeShellContinueTask(
    waitTimeoutSeconds: number,
    desktopPid: number,
): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(
            'node',
            [
                path.join(DESKTOP_DIR, 'tests', 'run-native-shell-macos.mjs'),
                '--no-launch',
                '--click-continue-task',
                '--pid',
                String(desktopPid),
                '--wait-timeout',
                String(waitTimeoutSeconds),
            ],
            {
                cwd: DESKTOP_DIR,
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );

        let stderr = '';
        child.stdout?.on('data', (chunk: Buffer) => {
            process.stderr.write(`[native-shell] ${chunk.toString()}`);
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            stderr += text;
            process.stderr.write(`[native-shell-err] ${text}`);
        });

        child.on('exit', (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`Native shell runner failed (code=${code}, signal=${signal}). ${stderr}`));
        });
        child.on('error', reject);
    });
}

function findDesktopBinaryPid(rootPid: number): number | null {
    const result = spawnSync('ps', ['-axo', 'pid=,command='], {
        encoding: 'utf-8',
    });
    const treeResult = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], {
        encoding: 'utf-8',
    });
    if (result.status !== 0 || !result.stdout || treeResult.status !== 0 || !treeResult.stdout) {
        return null;
    }

    const treeEntries = treeResult.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
            if (!match) {
                return null;
            }
            return {
                pid: Number(match[1]),
                ppid: Number(match[2]),
                command: match[3],
            };
        })
        .filter((entry): entry is { pid: number; ppid: number; command: string } => Boolean(entry));

    const descendants = new Set<number>();
    const queue = [rootPid];
    while (queue.length > 0) {
        const current = queue.shift()!;
        for (const entry of treeEntries) {
            if (entry.ppid !== current || descendants.has(entry.pid)) {
                continue;
            }
            descendants.add(entry.pid);
            queue.push(entry.pid);
        }
    }

    const candidates = treeEntries
        .filter((entry) => descendants.has(entry.pid))
        .filter((entry) => entry.command.includes('target/debug/coworkany-desktop'));

    if (candidates.length === 0) {
        return null;
    }

    return candidates[candidates.length - 1]?.pid ?? null;
}

async function terminateProcessTree(processRef: ChildProcess | null): Promise<void> {
    if (!processRef?.pid) return;

    try {
        processRef.kill('SIGTERM');
    } catch {
        return;
    }

    await wait(1500);
    if (processRef.exitCode !== null) {
        return;
    }

    spawnSync('kill', ['-9', String(processRef.pid)], { stdio: 'ignore' });
}

function cleanupExistingDesktopDevProcesses(): void {
    const result = spawnSync('ps', ['-axo', 'pid=,command='], {
        encoding: 'utf-8',
    });
    if (result.status !== 0 || !result.stdout) {
        return;
    }

    const candidates = result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const match = line.match(/^(\d+)\s+(.*)$/);
            if (!match) {
                return null;
            }
            return {
                pid: Number(match[1]),
                command: match[2],
            };
        })
        .filter((entry): entry is { pid: number; command: string } => Boolean(entry))
        .filter((entry) =>
            entry.command.includes('/Users/beihuang/Documents/github/coworkany/desktop')
            || entry.command.includes('target/debug/coworkany-desktop')
            || entry.command.includes('sidecar/node_modules/tsx/dist/cli.mjs')
        )
        .filter((entry) =>
            entry.command.includes('node_modules/.bin/tauri dev')
            || entry.command.includes('target/debug/coworkany-desktop')
            || entry.command.includes('node_modules/vite/bin/vite.js')
            || entry.command.includes('scripts/start-tauri-dev-server.mjs')
            || entry.command.includes('sidecar/node_modules/tsx/dist/cli.mjs')
        );

    for (const entry of candidates) {
        try {
            process.kill(entry.pid, 'SIGTERM');
        } catch {
            // ignore stale process entries
        }
    }
}

test.describe('native macOS interrupted-task recovery', () => {
    test.skip(process.platform !== 'darwin', 'macOS-only native shell regression');

    test('real Tauri shell restores interrupted task and resumes it through Continue task', async () => {
        test.setTimeout(10 * 60 * 1000);

        const tempHome = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'coworkany-native-shell-home-'));
        const appDataDir = appDataDirForHome(tempHome);
        seedAppData(appDataDir);
        const originalHome = process.env.HOME ?? os.homedir();
        const rustupHome = process.env.RUSTUP_HOME ?? path.join(originalHome, '.rustup');
        const cargoHome = process.env.CARGO_HOME ?? path.join(originalHome, '.cargo');
        cleanupExistingDesktopDevProcesses();
        await wait(1500);

        const tauriLogs = new TauriLogCollector();
        const tauriProc = spawn(
            process.platform === 'win32' ? 'npx.cmd' : 'npx',
            ['tauri', 'dev'],
            {
                cwd: DESKTOP_DIR,
                shell: true,
                env: {
                    ...process.env,
                    HOME: tempHome,
                    RUSTUP_HOME: rustupHome,
                    CARGO_HOME: cargoHome,
                    COWORKANY_APP_DATA_DIR: appDataDir,
                    COWORKANY_DISABLE_BROWSER_CDP: 'true',
                    COWORKANY_FORCE_DEVELOPMENT_SIDECAR: '1',
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );

        tauriProc.stdout?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            tauriLogs.push(text);
            process.stderr.write(`[tauri-stdout] ${text}`);
        });
        tauriProc.stderr?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            tauriLogs.push(text);
            process.stderr.write(`[tauri] ${text}`);
        });

        try {
            await waitFor(
                () => tauriLogs.contains('Sidecar IPC started') || tauriLogs.contains('Reading commands from stdin'),
                Boolean,
                180_000,
                'real Tauri sidecar startup',
            );

            const desktopPid = await waitFor(
                () => (tauriProc.pid ? findDesktopBinaryPid(tauriProc.pid) : null),
                (value) => typeof value === 'number' && value > 0,
                30_000,
                'real coworkany-desktop pid',
            );

            await runNativeShellContinueTask(180, desktopPid);

            const runtimeRecords = await waitFor(
                () => readRuntimeRecords(appDataDir),
                (records) => records.some((record) => record.taskId === TASK_ID && record.status === 'running'),
                30_000,
                'task-runtime.json to switch interrupted task back to running',
            );

            await waitFor(
                () => tauriLogs.getRaw(),
                (raw) =>
                    raw.includes(`resume_interrupted_task command received: task_id=${TASK_ID}`)
                    || raw.includes('"type":"task_resumed"')
                    || raw.includes('"type":"task_status","payload":{"status":"running"}'),
                30_000,
                'resume command log acknowledgement',
            );

            const resumedRecord = runtimeRecords.find((record) => record.taskId === TASK_ID);
            expect(resumedRecord?.status).toBe('running');
        } finally {
            await terminateProcessTree(tauriProc);
            cleanupExistingDesktopDevProcesses();
            fs.rmSync(tempHome, { recursive: true, force: true });
        }
    });
});
