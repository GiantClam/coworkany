import { test, expect } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);
const REPO_ROOT = path.resolve(__dirname_local, '..', '..');
const SIDECAR_ROOT = path.join(REPO_ROOT, 'sidecar');
const WORKSPACES_CONFIG = path.join(SIDECAR_ROOT, 'workspaces.json');

const TEST_TIMEOUT_MS = 4 * 60 * 1000;

type WorkspaceRecord = {
    id: string;
    name: string;
    path: string;
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureMainShell(page: any): Promise<void> {
    const workspaceAddButton = page.locator('.workspace-add-btn').first();
    const shellVisible = await workspaceAddButton.isVisible({ timeout: 6000 }).catch(() => false);
    if (shellVisible) {
        return;
    }

    await page.evaluate(() => {
        localStorage.setItem('coworkany:setupCompleted', JSON.stringify(true));
        window.location.reload();
    });

    await page.waitForLoadState('domcontentloaded');
    await expect(workspaceAddButton).toBeVisible({ timeout: 25000 });
}

function loadWorkspaceConfig(): { workspaces?: WorkspaceRecord[] } {
    if (!fs.existsSync(WORKSPACES_CONFIG)) {
        return {};
    }

    try {
        return JSON.parse(fs.readFileSync(WORKSPACES_CONFIG, 'utf-8')) as { workspaces?: WorkspaceRecord[] };
    } catch {
        return {};
    }
}

async function waitForWorkspaceRecord(name: string, timeoutMs = 20000): Promise<WorkspaceRecord> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const config = loadWorkspaceConfig();
        const workspace = config.workspaces?.find((item) => item.name === name);
        if (workspace) {
            return workspace;
        }
        await sleep(500);
    }

    throw new Error(`Workspace "${name}" was not persisted to ${WORKSPACES_CONFIG}`);
}

async function waitForFirstWorkspaceRecord(timeoutMs = 20000): Promise<WorkspaceRecord> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const config = loadWorkspaceConfig();
        const workspace = config.workspaces?.[0];
        if (workspace) {
            return workspace;
        }
        await sleep(500);
    }

    throw new Error(`No workspace was found in ${WORKSPACES_CONFIG}`);
}

async function waitForWorkspaceRecords(timeoutMs = 20000): Promise<WorkspaceRecord[]> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const config = loadWorkspaceConfig();
        if (Array.isArray(config.workspaces) && config.workspaces.length > 0) {
            return config.workspaces;
        }
        await sleep(500);
    }

    throw new Error(`No workspace was found in ${WORKSPACES_CONFIG}`);
}

function extractWorkspaceRecordsFromLogs(rawLogs: string): WorkspaceRecord[] {
    const records: WorkspaceRecord[] = [];
    for (const line of rawLogs.split(/\r?\n/)) {
        if (!line.includes('list_workspaces_response') || !line.includes('Received from sidecar:')) {
            continue;
        }

        const jsonStart = line.indexOf('{');
        if (jsonStart < 0) {
            continue;
        }

        try {
            const parsed = JSON.parse(line.slice(jsonStart)) as {
                payload?: { workspaces?: WorkspaceRecord[] };
            };
            const workspaces = parsed.payload?.workspaces;
            if (Array.isArray(workspaces)) {
                for (const workspace of workspaces) {
                    if (workspace && typeof workspace.path === 'string' && workspace.path.length > 0) {
                        records.push(workspace);
                    }
                }
            }
        } catch {
            // Ignore malformed log lines.
        }
    }

    return records;
}

async function waitForWorkspaceRecordsFromLogs(tauriLogs: { getRaw: () => string }, timeoutMs = 20000): Promise<WorkspaceRecord[]> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const workspaces = extractWorkspaceRecordsFromLogs(tauriLogs.getRaw());
        if (workspaces.length > 0) {
            return workspaces;
        }
        await sleep(500);
    }

    throw new Error('No workspace records were observed in tauri logs');
}

function seedTaskFiles(workspacePath: string): void {
    const now = new Date().toISOString();
    const jarvisDir = path.join(workspacePath, '.coworkany', 'jarvis');
    const triggersFile = path.join(workspacePath, '.coworkany', 'triggers.json');
    fs.mkdirSync(jarvisDir, { recursive: true });

    const regularTaskId = 'desktop-e2e-regular-task';
    const tasksPayload = {
        [regularTaskId]: {
            id: regularTaskId,
            title: 'Desktop E2E regular task',
            description: 'Seeded regular task should be visible in task board',
            priority: 'high',
            status: 'pending',
            createdAt: now,
            updatedAt: now,
            dueDate: now,
            tags: ['desktop-e2e', 'manual'],
            dependencies: [],
        },
    };

    const triggersPayload = {
        triggers: [
            {
                id: 'desktop-e2e-scheduled-task',
                name: 'Desktop E2E scheduled task',
                description: 'Seeded scheduled task should be visible in task board',
                type: 'interval',
                config: {
                    intervalMs: 60 * 60 * 1000,
                },
                action: {
                    type: 'execute_task',
                    taskQuery: 'Run hourly desktop task list verification',
                    workspacePath,
                },
                enabled: true,
                createdAt: now,
                triggerCount: 0,
            },
        ],
    };

    fs.writeFileSync(path.join(jarvisDir, 'tasks.json'), JSON.stringify(tasksPayload, null, 2));
    fs.writeFileSync(triggersFile, JSON.stringify(triggersPayload, null, 2));
}

function cleanupSeedTaskFiles(workspacePath: string): void {
    const jarvisTasksFile = path.join(workspacePath, '.coworkany', 'jarvis', 'tasks.json');
    const triggersFile = path.join(workspacePath, '.coworkany', 'triggers.json');

    if (fs.existsSync(jarvisTasksFile)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(jarvisTasksFile, 'utf-8')) as Record<string, unknown>;
            delete parsed['desktop-e2e-regular-task'];
            if (Object.keys(parsed).length === 0) {
                fs.rmSync(jarvisTasksFile, { force: true });
            } else {
                fs.writeFileSync(jarvisTasksFile, JSON.stringify(parsed, null, 2));
            }
        } catch {
            // Ignore cleanup failure.
        }
    }

    if (fs.existsSync(triggersFile)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(triggersFile, 'utf-8')) as { triggers?: Array<{ id?: string }> };
            const triggers = Array.isArray(parsed.triggers) ? parsed.triggers : [];
            const filtered = triggers.filter((trigger) => trigger?.id !== 'desktop-e2e-scheduled-task');
            if (filtered.length === 0) {
                fs.rmSync(triggersFile, { force: true });
            } else {
                fs.writeFileSync(triggersFile, JSON.stringify({ triggers: filtered }, null, 2));
            }
        } catch {
            // Ignore cleanup failure.
        }
    }
}

async function openTaskBoard(page: any): Promise<void> {
    await page.locator('.nav-item-collapsed').nth(1).click();
    await expect(page.locator('.task-list-empty-shell, .task-list-view').first()).toBeVisible({ timeout: 15000 });
}

async function waitForTaskBoardReady(page: any): Promise<void> {
    const taskView = page.locator('.task-list-view');
    const errorCard = page.locator('.task-list-error-card');
    const spinner = page.locator('.task-list-spinner');

    await expect.poll(
        async () => {
            if (await errorCard.isVisible().catch(() => false)) {
                return 'error';
            }
            if (await taskView.isVisible().catch(() => false)) {
                return 'ready';
            }
            if (await spinner.isVisible().catch(() => false)) {
                return 'loading';
            }
            return 'unknown';
        },
        {
            timeout: 30000,
            intervals: [500, 1000, 2000],
            message: 'Task board never reached a ready state',
        }
    ).toBe('ready');
}

test.describe('Desktop GUI E2E - task board visibility', () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    test('shows regular tasks and scheduled tasks for the active workspace', async ({ page, tauriLogs }) => {
        await page.waitForLoadState('domcontentloaded');
        await ensureMainShell(page);

        const workspaces = await waitForWorkspaceRecordsFromLogs(tauriLogs);
        const workspace = workspaces[0];
        cleanupSeedTaskFiles(workspace.path);
        seedTaskFiles(workspace.path);

        try {
            await page.locator('.workspace-item').first().click();

            await openTaskBoard(page);
            await waitForTaskBoardReady(page);
            await page.locator('.task-list-refresh-icon').click();

            await expect(page.locator('.task-card-title', { hasText: 'Desktop E2E regular task' })).toBeVisible({ timeout: 15000 });
            await expect(page.locator('.task-card-title', { hasText: 'Desktop E2E scheduled task' })).toBeVisible({ timeout: 15000 });

            const taskCards = page.locator('.task-card');
            await expect(taskCards).toHaveCount(2, { timeout: 15000 });
            await expect(page.locator('.task-tag-pill', { hasText: '#scheduled' })).toBeVisible({ timeout: 15000 });
        } finally {
            cleanupSeedTaskFiles(workspace.path);
        }
    });
});
