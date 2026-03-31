import { test, expect } from './tauriFixtureSandboxedUi';
import * as fs from 'fs';
import * as path from 'path';

function writeJsonFile(filePath: string, payload: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function buildStuckThinkingSnapshot() {
    const taskId = 'assistant-ui-thinking-to-response-task';
    const finalResponse = '任务已完成，结果：系统返回最终摘要。';

    return {
        taskId,
        finalResponse,
        snapshot: {
            sessions: [
                {
                    taskId,
                    title: 'thinking to response regression',
                    status: 'running',
                    taskMode: 'immediate_task',
                    createdAt: '2026-03-31T11:00:00.000Z',
                    updatedAt: '2026-03-31T11:00:02.000Z',
                    planSteps: [],
                    toolCalls: [],
                    effects: [],
                    patches: [],
                    messages: [
                        {
                            id: 'msg-user',
                            role: 'user',
                            content: '请完成这个任务',
                            timestamp: '2026-03-31T11:00:00.000Z',
                        },
                    ],
                    events: [
                        {
                            id: 'event-user',
                            taskId,
                            sequence: 1,
                            type: 'CHAT_MESSAGE',
                            timestamp: '2026-03-31T11:00:00.000Z',
                            payload: {
                                role: 'user',
                                content: '请完成这个任务',
                            },
                        },
                        {
                            id: 'event-system-final',
                            taskId,
                            sequence: 2,
                            type: 'CHAT_MESSAGE',
                            timestamp: '2026-03-31T11:00:02.000Z',
                            payload: {
                                role: 'system',
                                content: finalResponse,
                            },
                        },
                    ],
                },
            ],
            activeTaskId: taskId,
        },
    };
}

async function seedMirrorBrowserState(page: any, snapshot: ReturnType<typeof buildStuckThinkingSnapshot>['snapshot']): Promise<void> {
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

test.describe('assistant-ui thinking -> response regression', () => {
    test.setTimeout(120_000);

    test('renders response text and does not stay on pending thinking label', async ({ page, appDataDir }: any) => {
        const { finalResponse, snapshot } = buildStuckThinkingSnapshot();

        if (process.platform === 'darwin') {
            await seedMirrorBrowserState(page, snapshot);
        } else {
            writeJsonFile(path.join(appDataDir, 'sessions.json'), snapshot);
            await page.reload({ waitUntil: 'domcontentloaded' });
        }

        await expect(page.getByText(finalResponse)).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(/等待模型响应|Waiting for model response/)).toHaveCount(0);
    });
});
