import type { Agent } from '@mastra/core/agent';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import type {
    ExecutionPlan,
    FrozenWorkRequest,
} from '../../../orchestration/workRequestSchema';
import { normalizeResolvedAttachmentsMessage } from '../../capabilityRegistry';
import { deriveDefaultResourceId } from '../../runtimeIdentity';
import { createTaskRequestContext } from '../../requestContext';
import { createTelemetryRunContext } from '../../telemetry';
export interface ExecuteTaskInput {
    frozen: FrozenWorkRequest;
    executionPlan: ExecutionPlan;
    executionQuery: string;
    originalMessage?: string;
    requiredCapabilities?: string[];
}

export interface ExecuteTaskToolEvidence {
    toolCallCount: number;
    commandToolCallCount: number;
    toolNames: string[];
    satisfiedCapabilities: string[];
    missingCapabilities: string[];
}
export interface ExecuteTaskOutput {
    result: string;
    completed: boolean;
    toolEvidence: ExecuteTaskToolEvidence;
}

const COMMAND_EXECUTION_CAPABILITY = 'command_execution';
const COMMAND_EXECUTION_TOOL_PATTERN = /\b(mastra_workspace_execute_command|run_command|bash|bash_approval|shell(?:[_\s-]?command)?|terminal(?:[_\s-]?command)?)\b/i;
const WEB_RESEARCH_TOOL_PATTERN = /\b(search_web|websearch|crawl_url|get_news|check_weather|finance|quote|ticker|stock|market|weather|forecast|browser_search|web[_-]?research)\b/i;
const BROWSER_AUTOMATION_TOOL_PATTERN = /\b(browser_[a-z_]+|playwright|navigate|screenshot|click|fill|browser_navigate|browser_screenshot|browser_click|browser_fill)\b/i;
const VOICE_OUTPUT_TOOL_PATTERN = /\b(voice_speak|tts|text[-_]?to[-_]?speech|speak|read[_-]?aloud)\b/i;
const ARTIFACT_WRITE_TOOL_PATTERN = /\b(write_to_file|replace_file_content|append_to_file|move_file|delete_path|apply_patch|mastra_workspace_write_file|mastra_workspace_replace_in_file|mastra_workspace_rename_file|mastra_workspace_delete_file)\b/i;
const FILESYSTEM_READ_TOOL_PATTERN = /\b(list_dir|view_file|read_file|mastra_workspace_list_files|mastra_workspace_read_file|mastra_workspace_file_stat|file_stat)\b/i;
const WORKSPACE_EXECUTE_COMMAND_TOOL = 'mastra_workspace_execute_command';
const MAX_TOOL_EVIDENCE_SCAN_DEPTH = 8;
const MAX_TOOL_EVIDENCE_SCAN_ITEMS = 512;
const RESOLVED_ATTACHMENTS_HEADER_PATTERN = /^\s*\[Resolved attachments\]\s*$/iu;
const RESOLVED_ATTACHMENT_LIST_ITEM_PATTERN = /^\s*-\s+(.+)$/u;
const ATTACHMENT_VIDEO_MERGE_INTENT_PATTERN = /(?:合并|合成|拼接|弄成|merge|concat(?:enate)?|slideshow|montage).*(?:视频|video|短片)|(?:视频|video).*(?:合并|合成|merge|concat|slideshow)/iu;
const PER_IMAGE_DURATION_PATTERN = /每(?:张|个|帧).{0,8}?(\d+(?:\.\d+)?)\s*(?:秒|s|sec|secs|second|seconds)/iu;
const DEFAULT_PER_IMAGE_DURATION_SECONDS = 5;
const MIN_PER_IMAGE_DURATION_SECONDS = 1;
const MAX_PER_IMAGE_DURATION_SECONDS = 60;
const MAX_COMMAND_OUTPUT_CAPTURE = 16_384;
const ATTACHMENT_SUSPICIOUS_MAX_BYTES = 512;
const STAGED_ALIAS_FILE_PATTERN = /^-(.+)$/u;
const STAGED_ATTACHMENTS_DIR_PATTERN = /(?:^|[\\/])\.coworkany[\\/]attachments[\\/]staged$/u;

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function normalizeRequiredCapabilities(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0);
}

function extractToolNameFromUnknown(value: unknown): string | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }
    const directCandidates = [
        record.toolName,
        record.tool_name,
        record.tool,
        record.name,
    ];
    for (const candidate of directCandidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
            return candidate.trim();
        }
    }
    const functionRecord = toRecord(record.function);
    if (functionRecord && typeof functionRecord.name === 'string' && functionRecord.name.trim().length > 0) {
        return functionRecord.name.trim();
    }
    return null;
}

function collectToolNamesFromUnknown(input: {
    value: unknown;
    target: Set<string>;
}): void {
    const queue: Array<{ value: unknown; depth: number }> = [{
        value: input.value,
        depth: 0,
    }];
    const seen = new Set<object>();
    let scanned = 0;

    while (queue.length > 0 && scanned < MAX_TOOL_EVIDENCE_SCAN_ITEMS) {
        const current = queue.shift();
        if (!current) {
            continue;
        }
        if (current.depth > MAX_TOOL_EVIDENCE_SCAN_DEPTH) {
            continue;
        }
        scanned += 1;

        if (Array.isArray(current.value)) {
            for (const item of current.value) {
                queue.push({
                    value: item,
                    depth: current.depth + 1,
                });
            }
            continue;
        }

        const record = toRecord(current.value);
        if (!record) {
            continue;
        }
        if (seen.has(record)) {
            continue;
        }
        seen.add(record);

        const toolName = extractToolNameFromUnknown(record);
        if (toolName) {
            input.target.add(toolName);
        }
        for (const key of ['toolCalls', 'tool_calls', 'toolCall', 'tool_call', 'steps', 'messages', 'response', 'output']) {
            if (key in record) {
                queue.push({
                    value: record[key],
                    depth: current.depth + 1,
                });
            }
        }
    }
}

function buildToolEvidence(toolNames: Set<string>): ExecuteTaskToolEvidence {
    const normalized = Array.from(new Set(
        [...toolNames]
            .map((name) => name.trim())
            .filter((name) => name.length > 0),
    ));
    const commandToolCallCount = normalized.filter((name) => COMMAND_EXECUTION_TOOL_PATTERN.test(name)).length;
    return {
        toolCallCount: normalized.length,
        commandToolCallCount,
        toolNames: normalized,
        satisfiedCapabilities: [],
        missingCapabilities: [],
    };
}

function toolNameSatisfiesCapability(toolName: string, capability: string): boolean {
    if (capability === COMMAND_EXECUTION_CAPABILITY) {
        return COMMAND_EXECUTION_TOOL_PATTERN.test(toolName);
    }
    if (capability === 'web_research') {
        return WEB_RESEARCH_TOOL_PATTERN.test(toolName);
    }
    if (capability === 'browser_automation') {
        return BROWSER_AUTOMATION_TOOL_PATTERN.test(toolName);
    }
    if (capability === 'voice_output') {
        return VOICE_OUTPUT_TOOL_PATTERN.test(toolName);
    }
    if (capability === 'artifact_write') {
        return ARTIFACT_WRITE_TOOL_PATTERN.test(toolName);
    }
    if (capability === 'filesystem_read') {
        return FILESYSTEM_READ_TOOL_PATTERN.test(toolName);
    }
    return false;
}

function annotateCapabilityCoverage(input: {
    toolEvidence: ExecuteTaskToolEvidence;
    requiredCapabilities: Set<string>;
}): ExecuteTaskToolEvidence {
    if (input.requiredCapabilities.size === 0) {
        return {
            ...input.toolEvidence,
            satisfiedCapabilities: [],
            missingCapabilities: [],
        };
    }
    const satisfiedCapabilities = [...input.requiredCapabilities]
        .filter((capability) => input.toolEvidence.toolNames.some((toolName) => (
            toolNameSatisfiesCapability(toolName, capability)
        )));
    const missingCapabilities = [...input.requiredCapabilities]
        .filter((capability) => !satisfiedCapabilities.includes(capability));
    return {
        ...input.toolEvidence,
        satisfiedCapabilities,
        missingCapabilities,
    };
}

function readBoundedInt(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    const parsed = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendLimitedOutput(current: string, chunk: string): string {
    if (!chunk) {
        return current;
    }
    const next = `${current}${chunk}`;
    if (next.length <= MAX_COMMAND_OUTPUT_CAPTURE) {
        return next;
    }
    return next.slice(next.length - MAX_COMMAND_OUTPUT_CAPTURE);
}

function parseAttachmentPathsFromExecutionQuery(executionQuery: string): string[] {
    const normalized = normalizeResolvedAttachmentsMessage(executionQuery);
    const lines = normalized.split(/\r?\n/u);
    const paths = new Set<string>();
    let inAttachmentBlock = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (RESOLVED_ATTACHMENTS_HEADER_PATTERN.test(trimmed)) {
            inAttachmentBlock = true;
            continue;
        }
        if (!inAttachmentBlock) {
            continue;
        }
        if (!trimmed) {
            continue;
        }
        const match = RESOLVED_ATTACHMENT_LIST_ITEM_PATTERN.exec(trimmed);
        if (!match) {
            break;
        }
        const filePath = match[1]?.trim();
        if (filePath && filePath.length > 0) {
            paths.add(filePath);
        }
    }
    return [...paths];
}

function extractPerImageDurationSeconds(executionQuery: string): number {
    const match = PER_IMAGE_DURATION_PATTERN.exec(executionQuery);
    const raw = match?.[1];
    if (!raw) {
        return DEFAULT_PER_IMAGE_DURATION_SECONDS;
    }
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_PER_IMAGE_DURATION_SECONDS;
    }
    return Math.max(
        MIN_PER_IMAGE_DURATION_SECONDS,
        Math.min(MAX_PER_IMAGE_DURATION_SECONDS, Math.round(parsed)),
    );
}

function escapeForFfmpegConcatPath(filePath: string): string {
    return filePath.replace(/'/g, "'\\''");
}

async function runCommandProcess(input: {
    command: string;
    args: string[];
    cwd: string;
}): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
}> {
    return await new Promise((resolve, reject) => {
        const child = spawn(input.command, input.args, {
            cwd: input.cwd,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer | string) => {
            stdout = appendLimitedOutput(stdout, String(chunk));
        });
        child.stderr.on('data', (chunk: Buffer | string) => {
            stderr = appendLimitedOutput(stderr, String(chunk));
        });
        child.on('error', (error) => {
            reject(error);
        });
        child.on('close', (code) => {
            resolve({
                exitCode: typeof code === 'number' ? code : 1,
                stdout,
                stderr,
            });
        });
    });
}

async function tryAttachmentVideoMergeDeterministicFallback(input: {
    queryCandidates: string[];
    workspacePath?: string;
}): Promise<ExecuteTaskOutput | null> {
    const normalizedCandidates = input.queryCandidates
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    const mergedQueryContext = normalizedCandidates.join('\n');
    if (!input.workspacePath || !ATTACHMENT_VIDEO_MERGE_INTENT_PATTERN.test(mergedQueryContext)) {
        return null;
    }

    const attachmentCandidates = Array.from(new Set(
        normalizedCandidates
            .flatMap((candidate) => parseAttachmentPathsFromExecutionQuery(candidate)),
    ));
    if (attachmentCandidates.length < 2) {
        return null;
    }

    const validAttachmentPaths: string[] = [];
    const emittedAttachmentPaths = new Set<string>();
    for (const candidate of attachmentCandidates) {
        const resolvedPath = await resolveAttachmentPathForVideoMerge(candidate);
        if (!resolvedPath || emittedAttachmentPaths.has(resolvedPath)) {
            continue;
        }
        try {
            const stats = await fs.stat(resolvedPath);
            if (stats.isFile()) {
                validAttachmentPaths.push(resolvedPath);
                emittedAttachmentPaths.add(resolvedPath);
            }
        } catch {
            // Skip missing/unreadable attachments and fallback to the model path.
        }
    }
    if (validAttachmentPaths.length < 2) {
        return null;
    }

    const durationSeconds = extractPerImageDurationSeconds(mergedQueryContext);
    const workspacePath = input.workspacePath;
    const outputDir = path.join(workspacePath, 'output');
    const tempDir = path.join(workspacePath, '.coworkany', 'tmp');
    const timestamp = Date.now();
    const listFilePath = path.join(tempDir, `attachment-video-merge-${timestamp}.txt`);
    const outputPath = path.join(outputDir, `attachment-video-merge-${timestamp}.mp4`);

    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(tempDir, { recursive: true });

    const concatLines: string[] = [];
    for (const filePath of validAttachmentPaths) {
        concatLines.push(`file '${escapeForFfmpegConcatPath(filePath)}'`);
        concatLines.push(`duration ${durationSeconds}`);
    }
    const lastFile = validAttachmentPaths[validAttachmentPaths.length - 1];
    concatLines.push(`file '${escapeForFfmpegConcatPath(lastFile)}'`);
    await fs.writeFile(listFilePath, `${concatLines.join('\n')}\n`, 'utf8');

    const ffmpegProbe = await runCommandProcess({
        command: 'ffmpeg',
        args: ['-version'],
        cwd: workspacePath,
    }).catch(() => null);
    if (!ffmpegProbe || ffmpegProbe.exitCode !== 0) {
        return null;
    }

    const ffmpegResult = await runCommandProcess({
        command: 'ffmpeg',
        args: [
            '-y',
            '-hide_banner',
            '-loglevel',
            'error',
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            listFilePath,
            '-vf',
            "scale='max(2,trunc(iw/2)*2)':'max(2,trunc(ih/2)*2)',format=yuv420p",
            '-r',
            '30',
            '-pix_fmt',
            'yuv420p',
            outputPath,
        ],
        cwd: workspacePath,
    }).catch(() => null);

    if (!ffmpegResult || ffmpegResult.exitCode !== 0) {
        return null;
    }

    const outputStat = await fs.stat(outputPath).catch(() => null);
    if (!outputStat || !outputStat.isFile() || outputStat.size <= 0) {
        return null;
    }

    return {
        result: `已执行命令并完成视频合并，输出文件：${outputPath}（${validAttachmentPaths.length} 张图片，每张 ${durationSeconds}s）。`,
        completed: true,
        toolEvidence: {
            toolCallCount: 1,
            commandToolCallCount: 1,
            toolNames: [WORKSPACE_EXECUTE_COMMAND_TOOL],
            satisfiedCapabilities: [COMMAND_EXECUTION_CAPABILITY],
            missingCapabilities: [],
        },
    };
}

function shouldProbeSiblingStagedAttachments(input: {
    parentDir: string;
    baseName: string;
    sizeBytes: number | null;
}): boolean {
    if (!STAGED_ATTACHMENTS_DIR_PATTERN.test(input.parentDir)) {
        return false;
    }
    if (STAGED_ALIAS_FILE_PATTERN.test(input.baseName)) {
        return true;
    }
    if (input.sizeBytes !== null && input.sizeBytes <= ATTACHMENT_SUSPICIOUS_MAX_BYTES) {
        return true;
    }
    return false;
}

async function resolveAttachmentPathForVideoMerge(candidatePath: string): Promise<string | null> {
    const normalizedPath = candidatePath.trim();
    if (!normalizedPath) {
        return null;
    }
    const parentDir = path.dirname(normalizedPath);
    const baseName = path.basename(normalizedPath);
    const aliasMatch = STAGED_ALIAS_FILE_PATTERN.exec(baseName);
    const suffix = aliasMatch?.[1] ?? baseName;
    const candidateStat = await fs.stat(normalizedPath).catch(() => null);
    const candidateFileSize = candidateStat?.isFile() ? candidateStat.size : null;

    if (!shouldProbeSiblingStagedAttachments({
        parentDir,
        baseName,
        sizeBytes: candidateFileSize,
    })) {
        return candidateStat?.isFile() ? normalizedPath : null;
    }

    const entries = await fs.readdir(parentDir, { withFileTypes: true }).catch(() => []);
    let bestAlternativePath: string | null = null;
    let bestAlternativeSize = -1;
    let bestAlternativeMtimeMs = -1;
    for (const entry of entries) {
        if (!entry.isFile()) {
            continue;
        }
        if (entry.name === baseName) {
            continue;
        }
        if (!entry.name.endsWith(`-${suffix}`)) {
            continue;
        }
        const alternativePath = path.join(parentDir, entry.name);
        const alternativeStat = await fs.stat(alternativePath).catch(() => null);
        if (!alternativeStat?.isFile()) {
            continue;
        }
        const isBetterBySize = alternativeStat.size > bestAlternativeSize;
        const isTieButNewer = alternativeStat.size === bestAlternativeSize && alternativeStat.mtimeMs > bestAlternativeMtimeMs;
        if (isBetterBySize || isTieButNewer) {
            bestAlternativePath = alternativePath;
            bestAlternativeSize = alternativeStat.size;
            bestAlternativeMtimeMs = alternativeStat.mtimeMs;
        }
    }

    if (!bestAlternativePath) {
        return candidateStat?.isFile() ? normalizedPath : null;
    }

    if (!candidateStat?.isFile()) {
        return bestAlternativePath;
    }
    if (candidateStat.size <= ATTACHMENT_SUSPICIOUS_MAX_BYTES) {
        return bestAlternativePath;
    }
    if (bestAlternativeSize >= candidateStat.size * 8) {
        return bestAlternativePath;
    }
    return normalizedPath;
}

function buildExecutionPrompt(input: {
    executionQuery: string;
    requiresCommandExecutionEvidence: boolean;
    requiredCapabilities: string[];
    attempt: number;
}): string {
    if (!input.requiresCommandExecutionEvidence && input.requiredCapabilities.length === 0) {
        return input.executionQuery;
    }
    const contractLines = [
        '',
        'Execution contract (hard requirement):',
        `- Required tool evidence capabilities: ${input.requiredCapabilities.join(', ') || COMMAND_EXECUTION_CAPABILITY}.`,
        '- Narrative-only completion is invalid for this task.',
    ];
    if (input.requiresCommandExecutionEvidence) {
        contractLines.push(
            '- Before finishing, you MUST call a command-execution tool (`mastra_workspace_execute_command` or `run_command`).',
            '- After the command runs, summarize the result and concrete output path(s).',
        );
    }
    if (input.attempt > 0) {
        contractLines.push(
            '- Recovery note: previous attempt missed required tool evidence. Call the required tool type before finalizing.',
        );
    }
    return `${input.executionQuery}${contractLines.join('\n')}`;
}

function isRetryableExecutionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\b(timeout|timed out|econnreset|etimedout|socket hang up|network|429|rate.?limit|temporar(?:y|ily)|unavailable|gateway|upstream)\b/i
        .test(message);
}

export async function executeFrozenTask(input: {
    coworker: Agent;
    task: ExecuteTaskInput;
    approved?: boolean;
    workspacePath?: string;
}): Promise<ExecuteTaskOutput> {
    const checkpoint = input.task.executionPlan.steps.find((step) => step.kind === 'execution');
    if (checkpoint && input.approved === false) {
        return {
            result: 'Execution cancelled by approval gate.',
            completed: false,
            toolEvidence: {
                toolCallCount: 0,
                commandToolCallCount: 0,
                toolNames: [],
                satisfiedCapabilities: [],
                missingCapabilities: [],
            },
        };
    }
    const threadId = `control-plane-${input.task.frozen.id}`;
    const resourceId = deriveDefaultResourceId(input.task.frozen.id);
    const requestContext = createTaskRequestContext({
        threadId,
        resourceId,
        taskId: input.task.frozen.id,
        workspacePath: input.workspacePath,
        requireToolApproval: true,
    });
    const telemetry = createTelemetryRunContext({
        taskId: input.task.frozen.id,
        threadId,
        resourceId,
        workspacePath: input.workspacePath,
    });
    const executeStepTimeoutMs = readBoundedInt(
        'COWORKANY_MASTRA_TASK_EXECUTE_STEP_TIMEOUT_MS',
        30_000,
        3_000,
        90_000,
    );
    const executeStepRetryCount = readBoundedInt(
        'COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT',
        5,
        0,
        5,
    );
    const executeStepRetryDelayMs = readBoundedInt(
        'COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_DELAY_MS',
        1_000,
        100,
        10_000,
    );
    const requiredCapabilities = new Set(normalizeRequiredCapabilities(input.task.requiredCapabilities));
    const requiresCommandExecutionEvidence = requiredCapabilities.has(COMMAND_EXECUTION_CAPABILITY);
    let output: Awaited<ReturnType<Agent['generate']>> | null = null;
    let lastError: unknown;
    let toolEvidence: ExecuteTaskToolEvidence = {
        toolCallCount: 0,
        commandToolCallCount: 0,
        toolNames: [],
        satisfiedCapabilities: [],
        missingCapabilities: [],
    };
    for (let attempt = 0; attempt <= executeStepRetryCount; attempt += 1) {
        const abortController = new AbortController();
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const observedToolNames = new Set<string>();
        const prompt = buildExecutionPrompt({
            executionQuery: input.task.executionQuery,
            requiresCommandExecutionEvidence,
            requiredCapabilities: [...requiredCapabilities],
            attempt,
        });
        try {
            const generateOptions = {
                memory: {
                    thread: threadId,
                    resource: resourceId,
                },
                requestContext,
                tracingOptions: telemetry.tracingOptions
                    ? {
                        ...telemetry.tracingOptions,
                        tags: [...telemetry.tracingOptions.tags, 'workflow:control-plane'],
                    }
                    : undefined,
                requireToolApproval: true,
                autoResumeSuspendedTools: false,
                toolCallConcurrency: 1,
                maxSteps: 8,
                signal: abortController.signal,
                onIterationComplete: (iteration: unknown) => {
                    const iterationRecord = toRecord(iteration);
                    if (iterationRecord?.toolCalls) {
                        collectToolNamesFromUnknown({
                            value: iterationRecord.toolCalls,
                            target: observedToolNames,
                        });
                    }
                    return undefined;
                },
            } as Record<string, unknown>;
            output = await Promise.race([
                (
                    input.coworker.generate as unknown as (
                        prompt: string,
                        options: Record<string, unknown>,
                    ) => Promise<Awaited<ReturnType<Agent['generate']>>>
                )(prompt, generateOptions),
                new Promise<never>((_, reject) => {
                    timeoutId = setTimeout(() => {
                        abortController.abort(new Error('execute_task_timeout'));
                        reject(new Error(`execute_task_timeout:${executeStepTimeoutMs}`));
                    }, executeStepTimeoutMs);
                }),
            ]);
            collectToolNamesFromUnknown({
                value: output,
                target: observedToolNames,
            });
            toolEvidence = annotateCapabilityCoverage({
                toolEvidence: buildToolEvidence(observedToolNames),
                requiredCapabilities,
            });
            if (requiredCapabilities.size > 0) {
                if (toolEvidence.missingCapabilities.length > 0) {
                    const missingLabel = toolEvidence.missingCapabilities.join(',');
                    const evidenceError = new Error(`workflow_missing_required_tool_evidence:${missingLabel}`);
                    lastError = evidenceError;
                    const canRetry = attempt < executeStepRetryCount;
                    if (!canRetry) {
                        const canUseCommandOnlyFallback = toolEvidence.missingCapabilities.length === 1
                            && toolEvidence.missingCapabilities[0] === COMMAND_EXECUTION_CAPABILITY;
                        if (canUseCommandOnlyFallback) {
                            const fallbackResult = await tryAttachmentVideoMergeDeterministicFallback({
                                queryCandidates: [
                                    input.task.originalMessage,
                                    input.task.executionQuery,
                                    input.task.frozen.sourceText,
                                    ...((Array.isArray(input.task.frozen.tasks) ? input.task.frozen.tasks : [])
                                        .flatMap((task) => task.resolvedTargets ?? [])),
                                ].filter((value): value is string => typeof value === 'string'),
                                workspacePath: input.workspacePath,
                            });
                            if (fallbackResult) {
                                return fallbackResult;
                            }
                        }
                        throw evidenceError;
                    }
                    await delay(executeStepRetryDelayMs * (attempt + 1));
                    continue;
                }
            }
            break;
        } catch (error) {
            lastError = error;
            const canRetry = attempt < executeStepRetryCount
                && isRetryableExecutionError(error);
            if (!canRetry) {
                throw error;
            }
            await delay(executeStepRetryDelayMs * (attempt + 1));
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }
    if (output === null) {
        throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
    }
    return {
        result: output.text,
        completed: output.finishReason !== 'error',
        toolEvidence,
    };
}
