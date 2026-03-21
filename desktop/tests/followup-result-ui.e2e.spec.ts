import { test, expect } from './tauriFixtureSandboxedUi';
import * as fs from 'fs';
import * as path from 'path';

function writeJsonFile(filePath: string, payload: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function buildSessionsSnapshot() {
    const finalSummary = '已从 skillhub 安装并启用技能 `skill-vetter`。';
    const latestFollowUp = '从 skillhub 中安装 skill-vetter';
    const taskId = '30d4087f-1e2f-4251-ad96-1938fe614bd4';

    return {
        finalSummary,
        latestFollowUp,
        taskId,
        snapshot: {
            sessions: [
                {
                    taskId,
                    title: '[Scheduled] 检索最新的 Reddit 内容',
                    status: 'finished',
                    summary: finalSummary,
                    workspacePath: '/Users/beihuang/Documents/github/coworkany/sidecar',
                    createdAt: '2026-03-19T08:16:02.573Z',
                    updatedAt: '2026-03-21T03:54:27.623Z',
                    planSteps: [],
                    toolCalls: [],
                    effects: [],
                    patches: [],
                    messages: [
                        {
                            id: 'user-old',
                            role: 'user',
                            content: '1 分钟后，检索最新的 Reddit 内容',
                            timestamp: '2026-03-19T08:15:01.650Z',
                        },
                        {
                            id: 'assistant-old',
                            role: 'assistant',
                            content: '已安排定时任务。',
                            timestamp: '2026-03-19T08:15:01.687Z',
                        },
                        {
                            id: 'user-new',
                            role: 'user',
                            content: latestFollowUp,
                            timestamp: '2026-03-21T03:54:25.238Z',
                        },
                        {
                            id: 'system-noise',
                            role: 'system',
                            content: 'Tool result: Tool failed',
                            timestamp: '2026-03-21T03:54:27.611Z',
                        },
                    ],
                    events: [
                        {
                            id: 'event-user-old',
                            taskId,
                            sequence: 1,
                            type: 'CHAT_MESSAGE',
                            timestamp: '2026-03-19T08:15:01.650Z',
                            payload: {
                                role: 'user',
                                content: '1 分钟后，检索最新的 Reddit 内容',
                            },
                        },
                        {
                            id: 'event-user-new',
                            taskId,
                            sequence: 2,
                            type: 'CHAT_MESSAGE',
                            timestamp: '2026-03-21T03:54:25.238Z',
                            payload: {
                                role: 'user',
                                content: latestFollowUp,
                            },
                        },
                        {
                            id: 'event-tool-result',
                            taskId,
                            sequence: 3,
                            type: 'TOOL_RESULT',
                            timestamp: '2026-03-21T03:54:27.611Z',
                            payload: {
                                toolId: 'tool-1',
                                success: false,
                                error: 'temporary fallback',
                            },
                        },
                        {
                            id: 'event-finished',
                            taskId,
                            sequence: 4,
                            type: 'TASK_FINISHED',
                            timestamp: '2026-03-21T03:54:27.612Z',
                            payload: {
                                summary: finalSummary,
                                duration: 2351,
                                artifactsCreated: [],
                            },
                        },
                    ],
                },
            ],
            activeTaskId: taskId,
        },
    };
}

async function seedMirrorBrowserState(page: any, snapshot: ReturnType<typeof buildSessionsSnapshot>['snapshot']): Promise<void> {
    await page.evaluate(() => {
        localStorage.setItem('coworkany:setupCompleted', JSON.stringify(true));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.evaluate(async (payload) => {
        const tauriWindow = window as Window & {
            __TAURI_INTERNALS__?: Record<string, unknown>;
            __TAURI_EVENT_PLUGIN_INTERNALS__?: Record<string, unknown>;
        };
        const callbacks = new Map<number, (data: unknown) => void>();
        let nextCallbackId = 1;

        tauriWindow.__TAURI_INTERNALS__ = tauriWindow.__TAURI_INTERNALS__ ?? {};
        tauriWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = tauriWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ ?? {};

        tauriWindow.__TAURI_INTERNALS__.transformCallback = (callback?: (data: unknown) => void) => {
            const id = nextCallbackId++;
            if (callback) {
                callbacks.set(id, callback);
            }
            return id;
        };
        tauriWindow.__TAURI_INTERNALS__.unregisterCallback = (id: number) => {
            callbacks.delete(id);
        };
        tauriWindow.__TAURI_INTERNALS__.runCallback = (id: number, data: unknown) => {
            callbacks.get(id)?.(data);
        };
        tauriWindow.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener = () => undefined;
        tauriWindow.__TAURI_INTERNALS__.invoke = async (cmd: string, args?: Record<string, unknown>) => {
            switch (cmd) {
                case 'load_sessions':
                    return { success: true, payload };
                case 'get_llm_settings':
                    return { success: true, payload: {} };
                case 'plugin:event|listen':
                    return args?.handler ?? nextCallbackId++;
                case 'plugin:event|unlisten':
                case 'plugin:event|emit':
                    return null;
                default:
                    return { success: true };
            }
        };

        const storeModule = await import('/src/stores/taskEvents/index.ts');
        storeModule.useTaskEventStore.getState().hydrate(payload);
    }, snapshot);
}

test.describe('Follow-up Result UI Regression', () => {
    test.setTimeout(120_000);

    test('shows the latest follow-up title and final result instead of stale task metadata', async ({ page, appDataDir }: any) => {
        const { finalSummary, latestFollowUp, snapshot } = buildSessionsSnapshot();

        if (process.platform === 'darwin') {
            await seedMirrorBrowserState(page, snapshot);
        } else {
            writeJsonFile(path.join(appDataDir, 'sessions.json'), snapshot);
            await page.reload({ waitUntil: 'domcontentloaded' });
        }

        await expect.poll(async () => {
            return await page.locator('.chat-title').getAttribute('title');
        }, {
            timeout: 30_000,
            message: 'chat header should retitle the session to the latest follow-up request',
        }).toBe(latestFollowUp);

        await expect(page.getByText('已从 skillhub 安装并启用技能')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('skill-vetter', { exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('Tool result: Tool failed')).toHaveCount(0);

        await page.getByRole('button', { name: /Task Board|任务清单/ }).click();

        await expect(page.locator('.task-card-title').filter({ hasText: latestFollowUp })).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.task-card-result-text').filter({ hasText: '已从 skillhub 安装并启用技能' })).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.task-card-result-text').filter({ hasText: 'Tool result: Tool failed' })).toHaveCount(0);
    });
});
