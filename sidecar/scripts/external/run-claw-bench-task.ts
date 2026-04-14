#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { handleUserMessage } from '../../src/ipc/streaming.ts';

type DesktopEvent = {
    type: string;
    message?: string;
    inputTokens?: number;
    outputTokens?: number;
    [key: string]: unknown;
};

type TaskRunResult = {
    taskId: string;
    workspacePath: string;
    modelId: string;
    runId: string | null;
    tokensInput: number;
    tokensOutput: number;
    toolCalls: number;
    toolErrors: number;
    approvalRequiredCount: number;
    error: string | null;
};

function usage(): never {
    console.error(
        'Usage: node --import tsx scripts/external/run-claw-bench-task.ts'
        + ' --task-id <id> --workspace <dir> --instruction <file> --model-id <model> [--result-path <file>]',
    );
    process.exit(2);
}

function readArg(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    if (index < 0) {
        return undefined;
    }
    return args[index + 1];
}

function parseArgs(): {
    taskId: string;
    workspacePath: string;
    instructionPath: string;
    modelId: string;
    resultPath?: string;
} {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        usage();
    }
    const taskId = readArg(args, '--task-id');
    const workspacePath = readArg(args, '--workspace');
    const instructionPath = readArg(args, '--instruction');
    const modelId = readArg(args, '--model-id');
    const resultPath = readArg(args, '--result-path');

    if (!taskId || !workspacePath || !instructionPath || !modelId) {
        usage();
    }

    return {
        taskId,
        workspacePath: path.resolve(workspacePath),
        instructionPath: path.resolve(instructionPath),
        modelId,
        resultPath: resultPath ? path.resolve(resultPath) : undefined,
    };
}

async function main(): Promise<void> {
    const args = parseArgs();
    if (!fs.existsSync(args.instructionPath)) {
        throw new Error(`instruction file not found: ${args.instructionPath}`);
    }
    const instruction = fs.readFileSync(args.instructionPath, 'utf8');
    const threadId = `thread-${args.taskId}`;
    const resourceId = `resource-${args.taskId}`;

    let tokensInput = 0;
    let tokensOutput = 0;
    let runId: string | null = null;
    let lastError: string | null = null;
    let toolCalls = 0;
    let toolErrors = 0;
    let approvalRequiredCount = 0;

    try {
        const run = await handleUserMessage(
            instruction,
            threadId,
            resourceId,
            (event: DesktopEvent) => {
                if (typeof event.runId === 'string' && event.runId.trim().length > 0) {
                    runId = event.runId;
                }
                if (event.type === 'token_usage') {
                    tokensInput += typeof event.inputTokens === 'number' ? event.inputTokens : 0;
                    tokensOutput += typeof event.outputTokens === 'number' ? event.outputTokens : 0;
                }
                if (event.type === 'tool_call') {
                    toolCalls += 1;
                }
                if (event.type === 'tool_result' && event.isError === true) {
                    toolErrors += 1;
                }
                if (event.type === 'approval_required') {
                    approvalRequiredCount += 1;
                }
                if (event.type === 'error' && typeof event.message === 'string' && event.message.trim().length > 0) {
                    lastError = event.message.trim();
                }
            },
            {
                taskId: args.taskId,
                workspacePath: args.workspacePath,
                forcedRouteMode: 'task',
                modelId: args.modelId,
                requireToolApproval: false,
                autoResumeSuspendedTools: true,
                forcePostAssistantCompletion: true,
                maxSteps: 8,
            },
        );
        if (run && typeof run.runId === 'string' && run.runId.trim().length > 0) {
            runId = run.runId.trim();
        }
    } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
    }

    const result: TaskRunResult = {
        taskId: args.taskId,
        workspacePath: args.workspacePath,
        modelId: args.modelId,
        runId,
        tokensInput,
        tokensOutput,
        toolCalls,
        toolErrors,
        approvalRequiredCount,
        error: lastError,
    };

    const payload = JSON.stringify(result, null, 2);
    if (args.resultPath) {
        fs.mkdirSync(path.dirname(args.resultPath), { recursive: true });
        fs.writeFileSync(args.resultPath, payload);
    } else {
        process.stdout.write(`${payload}\n`);
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
});
