/**
 * Desktop GUI E2E: system tool scenarios (STANDARD_TOOLS matrix)
 *
 * Goal:
 * 1) Trigger each standard system tool from desktop chat input
 * 2) Verify the tool is actually called (TOOL_CALL)
 * 3) Verify the tool execution returns success (TOOL_RESULT with isError=false)
 * 4) Verify scenario outcome matches user expectation (filesystem/content checks)
 *
 * Run:
 *   cd desktop && npx playwright test tests/system-tools-desktop-e2e.test.ts --workers=1
 */

import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const TASK_TIMEOUT_MS = 3 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;

const INPUT_SELECTORS = [
    '.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    'input[placeholder*="指令"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

type ToolCallEvent = {
    type: 'TOOL_CALL';
    payload?: {
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
    };
};

type ToolResultEvent = {
    type: 'TOOL_RESULT';
    payload?: {
        name?: string;
        isError?: boolean;
        result?: unknown;
    };
};

type TaskFailedEvent = {
    type: 'TASK_FAILED';
    payload?: {
        error?: string;
    };
};

type ParsedEvent = ToolCallEvent | ToolResultEvent | TaskFailedEvent | {
    type: string;
    payload?: Record<string, unknown>;
};

type Scenario = {
    id: string;
    toolName: string;
    args: Record<string, unknown>;
    marker: string;
    bypassDeterministicWorkflow?: boolean;
    bypassCommand?: string;
    verifyExpected: (ctx: {
        rootDir: string;
        logs: string;
    }) => boolean;
    expectedSummary: string;
    prepare: (rootDir: string) => void;
};

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeText(filePath: string, content: string): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf-8');
}

function parseSidecarEvents(rawLogs: string): ParsedEvent[] {
    const events: ParsedEvent[] = [];
    const marker = 'Received from sidecar: ';

    for (const line of rawLogs.split(/\r?\n/)) {
        const idx = line.indexOf(marker);
        if (idx < 0) continue;
        const jsonPart = line.slice(idx + marker.length).trim();
        if (!jsonPart.startsWith('{')) continue;
        try {
            const event = JSON.parse(jsonPart) as ParsedEvent;
            if (event && typeof event.type === 'string') {
                events.push(event);
            }
        } catch {
            // Ignore malformed lines.
        }
    }

    return events;
}

async function findChatInput(page: any): Promise<Locator | null> {
    for (const selector of INPUT_SELECTORS) {
        const candidate = page.locator(selector).first();
        const visible = await candidate.isVisible({ timeout: 1200 }).catch(() => false);
        if (visible) {
            return candidate;
        }
    }
    return null;
}

async function submitQuery(page: any, tauriLogs: any, query: string): Promise<void> {
    const input = await findChatInput(page);
    expect(input, 'desktop UI should expose chat input').not.toBeNull();

    tauriLogs.setBaseline();
    await input!.fill(query);
    await input!.press('Enter');
    await page.waitForTimeout(1800);

    if (!tauriLogs.containsSinceBaseline('send_task_message command received')) {
        const submitButton = page.locator('button[type="submit"], .send-button').first();
        const canClick = await submitButton.isVisible({ timeout: 1000 }).catch(() => false);
        if (canClick) {
            await submitButton.click({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(1500);
        }
    }
}

function buildToolQuery(scenario: Scenario): string {
    const lines = [
        '背景：你正在执行“图片去重任务”的工具级回归验证，本次只验证一个系统工具调用是否准确。',
        `执行一个系统工具验证任务，目标工具是 ${scenario.toolName}`,
        `工具参数对象: ${JSON.stringify(scenario.args)}`,
        '硬性要求：',
        `1) 必须调用工具 ${scenario.toolName} 执行操作`,
        '2) 不要调用 marketplace 或 skill 安装工具',
        '3) 不要生成任何文件产物报告（例如 .json/.md），只执行工具并用一句话确认',
        `4) 操作完成后回复标记 ${scenario.marker}`,
        `5) 预期结果：${scenario.expectedSummary}`,
    ];

    if (scenario.toolName !== 'list_dir') {
        lines.push('6) 如果参数是文件路径（不是目录），禁止对该文件路径调用 list_dir 做预检查。');
    }

    if (scenario.bypassDeterministicWorkflow && scenario.bypassCommand) {
        lines.splice(
            2,
            0,
            `先执行这条命令再继续后续步骤：${scenario.bypassCommand}`,
            '该命令只用于进入执行阶段，不代表任务完成。',
        );
    }

    return lines.join('\n');
}

function sha256(content: string): string {
    const hash = createHash('sha256');
    hash.update(Buffer.from(content, 'utf-8'));
    return hash.digest('hex');
}

function buildScenarios(rootDir: string): Scenario[] {
    const listDirPath = path.join(rootDir, 'case-list-dir');
    const viewFilePath = path.join(rootDir, 'case-view-file', 'note.txt');
    const writeFilePath = path.join(rootDir, 'case-write-file', 'output.txt');
    const replaceFilePath = path.join(rootDir, 'case-replace-file', 'replace.txt');
    const createDirPath = path.join(rootDir, 'case-create-directory', 'new-folder');
    const hashFilePath = path.join(rootDir, 'case-compute-hash', 'hash.txt');
    const moveSrcPath = path.join(rootDir, 'case-move-file', 'src', 'to-move.txt');
    const moveDstPath = path.join(rootDir, 'case-move-file', 'dst', 'moved.txt');
    const deletePathFile = path.join(rootDir, 'case-delete-path', 'delete-me.txt');
    const batchMoveSrcA = path.join(rootDir, 'case-batch-move', 'src', 'a.txt');
    const batchMoveSrcB = path.join(rootDir, 'case-batch-move', 'src', 'b.txt');
    const batchMoveDstA = path.join(rootDir, 'case-batch-move', 'dst', 'a.txt');
    const batchMoveDstB = path.join(rootDir, 'case-batch-move', 'dst', 'b.txt');
    const batchDeleteA = path.join(rootDir, 'case-batch-delete', 'a.tmp');
    const batchDeleteB = path.join(rootDir, 'case-batch-delete', 'b.tmp');

    const hashSource = 'hash-source-content-v1';
    const expectedHash = sha256(hashSource);

    return [
        {
            id: 'list-dir',
            toolName: 'list_dir',
            marker: 'LIST_DIR_SCENARIO_DONE',
            args: {
                path: listDirPath,
                recursive: false,
            },
            expectedSummary: '返回目录下的 alpha.txt、beta.log 和子目录 child',
            prepare: () => {
                ensureDir(path.join(listDirPath, 'child'));
                writeText(path.join(listDirPath, 'alpha.txt'), 'alpha');
                writeText(path.join(listDirPath, 'beta.log'), 'beta');
            },
            verifyExpected: ({ logs }) =>
                logs.includes('alpha.txt') && logs.includes('beta.log') && logs.includes('child'),
        },
        {
            id: 'view-file',
            toolName: 'view_file',
            marker: 'VIEW_FILE_SCENARIO_DONE',
            bypassDeterministicWorkflow: true,
            bypassCommand: "python3 -c \"print('VIEW_FILE_BYPASS')\"",
            args: {
                path: viewFilePath,
            },
            expectedSummary: '返回文件中的唯一标记 VIEW_FILE_UNIQUE_MARKER',
            prepare: () => {
                writeText(viewFilePath, 'VIEW_FILE_UNIQUE_MARKER\nline-2');
            },
            verifyExpected: ({ logs }) => logs.includes('VIEW_FILE_UNIQUE_MARKER'),
        },
        {
            id: 'write-to-file',
            toolName: 'write_to_file',
            marker: 'WRITE_FILE_SCENARIO_DONE',
            bypassDeterministicWorkflow: true,
            bypassCommand: "python3 -c \"print('WRITE_FILE_BYPASS')\"",
            args: {
                path: writeFilePath,
                content: 'WRITE_FILE_MARKER_OK',
            },
            expectedSummary: '创建 output.txt 并写入 WRITE_FILE_MARKER_OK',
            prepare: () => {
                ensureDir(path.dirname(writeFilePath));
            },
            verifyExpected: () =>
                fs.existsSync(writeFilePath) && fs.readFileSync(writeFilePath, 'utf-8') === 'WRITE_FILE_MARKER_OK',
        },
        {
            id: 'replace-file-content',
            toolName: 'replace_file_content',
            marker: 'REPLACE_FILE_SCENARIO_DONE',
            bypassDeterministicWorkflow: true,
            bypassCommand: "python3 -c \"print('REPLACE_FILE_BYPASS')\"",
            args: {
                path: replaceFilePath,
                target_content: 'before-token',
                replacement_content: 'after-token',
            },
            expectedSummary: '把 before-token 替换为 after-token',
            prepare: () => {
                writeText(replaceFilePath, 'line-before\nbefore-token\nline-after');
            },
            verifyExpected: () => {
                if (!fs.existsSync(replaceFilePath)) return false;
                const content = fs.readFileSync(replaceFilePath, 'utf-8');
                return content.includes('after-token') && !content.includes('before-token');
            },
        },
        {
            id: 'create-directory',
            toolName: 'create_directory',
            marker: 'CREATE_DIRECTORY_SCENARIO_DONE',
            args: {
                path: createDirPath,
            },
            expectedSummary: '创建 new-folder 目录',
            prepare: () => {
                ensureDir(path.dirname(createDirPath));
            },
            verifyExpected: () => fs.existsSync(createDirPath) && fs.statSync(createDirPath).isDirectory(),
        },
        {
            id: 'compute-file-hash',
            toolName: 'compute_file_hash',
            marker: 'COMPUTE_HASH_SCENARIO_DONE',
            bypassDeterministicWorkflow: true,
            bypassCommand: "python3 -c \"print('COMPUTE_HASH_BYPASS')\"",
            args: {
                path: hashFilePath,
                algorithm: 'sha256',
            },
            expectedSummary: `返回 sha256=${expectedHash}`,
            prepare: () => {
                writeText(hashFilePath, hashSource);
            },
            verifyExpected: ({ logs }) => logs.includes(expectedHash),
        },
        {
            id: 'move-file',
            toolName: 'move_file',
            marker: 'MOVE_FILE_SCENARIO_DONE',
            bypassDeterministicWorkflow: true,
            bypassCommand: "python3 -c \"print('MOVE_FILE_BYPASS')\"",
            args: {
                source_path: moveSrcPath,
                destination_path: moveDstPath,
            },
            expectedSummary: '把 src/to-move.txt 移动到 dst/moved.txt',
            prepare: () => {
                writeText(moveSrcPath, 'MOVE_ME');
                ensureDir(path.dirname(moveDstPath));
            },
            verifyExpected: () => !fs.existsSync(moveSrcPath) && fs.existsSync(moveDstPath),
        },
        {
            id: 'delete-path',
            toolName: 'delete_path',
            marker: 'DELETE_PATH_SCENARIO_DONE',
            bypassDeterministicWorkflow: true,
            bypassCommand: "python3 -c \"print('DELETE_PATH_BYPASS')\"",
            args: {
                path: deletePathFile,
            },
            expectedSummary: '删除 delete-me.txt',
            prepare: () => {
                writeText(deletePathFile, 'DELETE_ME');
            },
            verifyExpected: () => !fs.existsSync(deletePathFile),
        },
        {
            id: 'batch-move-files',
            toolName: 'batch_move_files',
            marker: 'BATCH_MOVE_SCENARIO_DONE',
            bypassDeterministicWorkflow: true,
            bypassCommand: "python3 -c \"print('BATCH_MOVE_BYPASS')\"",
            args: {
                moves: [
                    { source_path: batchMoveSrcA, destination_path: batchMoveDstA },
                    { source_path: batchMoveSrcB, destination_path: batchMoveDstB },
                ],
            },
            expectedSummary: '把 src/a.txt 和 src/b.txt 批量移动到 dst/',
            prepare: () => {
                writeText(batchMoveSrcA, 'A');
                writeText(batchMoveSrcB, 'B');
            },
            verifyExpected: () =>
                fs.existsSync(batchMoveDstA) &&
                fs.existsSync(batchMoveDstB) &&
                !fs.existsSync(batchMoveSrcA) &&
                !fs.existsSync(batchMoveSrcB),
        },
        {
            id: 'batch-delete-paths',
            toolName: 'batch_delete_paths',
            marker: 'BATCH_DELETE_SCENARIO_DONE',
            bypassDeterministicWorkflow: true,
            bypassCommand: "python3 -c \"print('BATCH_DELETE_BYPASS')\"",
            args: {
                deletes: [
                    { path: batchDeleteA },
                    { path: batchDeleteB },
                ],
            },
            expectedSummary: '批量删除 a.tmp 和 b.tmp',
            prepare: () => {
                writeText(batchDeleteA, 'A');
                writeText(batchDeleteB, 'B');
            },
            verifyExpected: () => !fs.existsSync(batchDeleteA) && !fs.existsSync(batchDeleteB),
        },
        {
            id: 'run-command',
            toolName: 'run_command',
            marker: 'RUN_COMMAND_SCENARIO_DONE',
            args: {
                command: 'echo RUN_COMMAND_OK_MARKER',
                timeout_ms: 20000,
            },
            expectedSummary: '命令 stdout 包含 RUN_COMMAND_OK_MARKER',
            prepare: () => {
                ensureDir(rootDir);
            },
            verifyExpected: ({ logs }) => logs.includes('RUN_COMMAND_OK_MARKER'),
        },
    ];
}

test.describe('Desktop GUI E2E - system tool scenarios', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 240_000);

    const workspaceRoot = path.resolve(
        process.cwd(),
        '..',
        'sidecar',
        '.coworkany',
        'test-workspace',
    );
    const scenarioRootBase = path.join(workspaceRoot, `desktop-system-tools-${Date.now()}`);

    for (const scenarioName of [
        'list-dir',
        'view-file',
        'write-to-file',
        'replace-file-content',
        'create-directory',
        'compute-file-hash',
        'move-file',
        'delete-path',
        'batch-move-files',
        'batch-delete-paths',
        'run-command',
    ]) {
        test(`tool scenario: ${scenarioName}`, async ({ page, tauriLogs }) => {
            const testResultsDir = path.join(process.cwd(), '..', 'artifacts', 'system-tools-desktop');
            ensureDir(testResultsDir);

            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(10_000);

            const scenarioRoot = path.join(scenarioRootBase, scenarioName);
            ensureDir(scenarioRoot);
            const scenario = buildScenarios(scenarioRoot).find((item) => item.id === scenarioName);
            expect(scenario, `scenario must exist: ${scenarioName}`).toBeDefined();
            scenario!.prepare(scenarioRoot);

            const query = buildToolQuery(scenario!);
            await submitQuery(page, tauriLogs, query);

            let submitted = false;
            let called = false;
            let successfulResult = false;
            let markerSeen = false;
            let taskFailed = false;
            let taskFailedError = '';
            let expectedSatisfied = false;

            const start = Date.now();
            while (Date.now() - start < TASK_TIMEOUT_MS) {
                await page.waitForTimeout(POLL_INTERVAL_MS);

                const logs = tauriLogs.getRawSinceBaseline();
                const lower = logs.toLowerCase();
                const events = parseSidecarEvents(logs);
                const toolCalls = events.filter((event) => event.type === 'TOOL_CALL') as ToolCallEvent[];
                const toolResults = events.filter((event) => event.type === 'TOOL_RESULT') as ToolResultEvent[];
                const taskFailedEvent = events.find((event) => event.type === 'TASK_FAILED') as TaskFailedEvent | undefined;

                submitted =
                    submitted ||
                    lower.includes('send_task_message command received') ||
                    lower.includes('start_task command received') ||
                    lower.includes('"type":"start_task"');

                called = called || toolCalls.some((event) => event.payload?.name === scenario!.toolName);
                successfulResult =
                    successfulResult ||
                    toolResults.some(
                        (event) => event.payload?.name === scenario!.toolName && event.payload?.isError !== true,
                    );
                markerSeen = markerSeen || logs.includes(scenario!.marker);
                expectedSatisfied = scenario!.verifyExpected({ rootDir: scenarioRoot, logs });

                if (taskFailedEvent) {
                    taskFailed = true;
                    taskFailedError = String(taskFailedEvent.payload?.error ?? '');
                    break;
                }

                if (called && successfulResult && expectedSatisfied) {
                    break;
                }
            }

            if (!taskFailed && (!called || !successfulResult)) {
                const retryQuery = [
                    `上一轮没有正确命中工具 ${scenario!.toolName}。`,
                    ...(scenario!.bypassDeterministicWorkflow && scenario!.bypassCommand
                        ? [
                            `先执行这条命令再继续后续步骤：${scenario!.bypassCommand}`,
                            '该命令只用于进入执行阶段，不代表任务完成。',
                        ]
                        : []),
                    `现在仅执行一次工具调用：${scenario!.toolName}`,
                    `参数对象: ${JSON.stringify(scenario!.args)}`,
                    '不要生成任何文件产物报告（例如 .json/.md）',
                    ...(scenario!.toolName !== 'list_dir'
                        ? ['如果参数是文件路径（不是目录），禁止对该文件路径调用 list_dir 做预检查。']
                        : []),
                    `完成后回复标记 ${scenario!.marker}`,
                ].join('\n');

                await submitQuery(page, tauriLogs, retryQuery);

                const retryStart = Date.now();
                while (Date.now() - retryStart < 60_000) {
                    await page.waitForTimeout(2000);
                    const logs = tauriLogs.getRawSinceBaseline();
                    const events = parseSidecarEvents(logs);
                    const toolCalls = events.filter((event) => event.type === 'TOOL_CALL') as ToolCallEvent[];
                    const toolResults = events.filter((event) => event.type === 'TOOL_RESULT') as ToolResultEvent[];
                    const taskFailedEvent = events.find((event) => event.type === 'TASK_FAILED') as TaskFailedEvent | undefined;

                    called = called || toolCalls.some((event) => event.payload?.name === scenario!.toolName);
                    successfulResult =
                        successfulResult ||
                        toolResults.some(
                            (event) => event.payload?.name === scenario!.toolName && event.payload?.isError !== true,
                        );
                    markerSeen = markerSeen || logs.includes(scenario!.marker);
                    expectedSatisfied = expectedSatisfied || scenario!.verifyExpected({ rootDir: scenarioRoot, logs });

                    if (taskFailedEvent) {
                        taskFailed = true;
                        taskFailedError = String(taskFailedEvent.payload?.error ?? '');
                        break;
                    }

                    if (called && successfulResult && expectedSatisfied) {
                        break;
                    }
                }
            }

            const finalLogs = tauriLogs.getRawSinceBaseline();
            const summary = {
                scenario: scenario!.id,
                toolName: scenario!.toolName,
                submitted,
                called,
                successfulResult,
                markerSeen,
                expectedSatisfied,
                taskFailed,
                taskFailedError,
            };

            fs.writeFileSync(
                path.join(testResultsDir, `system-tool-${scenario!.id}-summary.json`),
                JSON.stringify(summary, null, 2),
                'utf-8',
            );
            fs.writeFileSync(
                path.join(testResultsDir, `system-tool-${scenario!.id}-logs.txt`),
                finalLogs,
                'utf-8',
            );
            await page.screenshot({
                path: path.join(testResultsDir, `system-tool-${scenario!.id}-final.png`),
            }).catch(() => {});

            expect(submitted, 'desktop chat message should be submitted').toBe(true);
            expect(taskFailed, `task should not fail: ${taskFailedError}`).toBe(false);
            expect(called, `expected tool call not observed: ${scenario!.toolName}`).toBe(true);
            expect(successfulResult, `expected successful TOOL_RESULT for ${scenario!.toolName}`).toBe(true);
            expect(expectedSatisfied, `scenario expectation failed: ${scenario!.expectedSummary}`).toBe(true);
        });
    }
});
