/**
 * End-to-End Test: Xiaohongshu Post via Sidecar IPC
 *
 * Spawns a fresh sidecar instance, sends a start_task command,
 * and monitors the agent's execution to verify the task pipeline works.
 */

import { spawn, type Subprocess } from 'bun';
import { randomUUID } from 'crypto';

// ============================================================================
// Config
// ============================================================================

const TASK_QUERY = '帮我发一条小红书的帖文，帖文内容是hello world';
const TASK_TITLE = '小红书帖文测试';
const WORKSPACE_PATH = process.cwd();
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max

// ============================================================================
// IPC Command Builder
// ============================================================================

function buildStartTaskCommand(taskId: string) {
    return JSON.stringify({
        type: 'start_task',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {
            taskId,
            title: TASK_TITLE,
            userQuery: TASK_QUERY,
            context: {
                workspacePath: WORKSPACE_PATH,
            },
            config: {
                enabledToolpacks: ['builtin-websearch'],
                enabledSkills: [],
            },
        },
    });
}

// ============================================================================
// Event Tracker
// ============================================================================

interface TaskEventLog {
    type: string;
    timestamp: string;
    payload: any;
}

const eventLog: TaskEventLog[] = [];
let taskFinished = false;
let taskFailed = false;
let taskError = '';
let textBuffer = '';

function processEvent(event: any) {
    eventLog.push({
        type: event.type,
        timestamp: event.timestamp,
        payload: event.payload,
    });

    const ts = new Date().toLocaleTimeString();

    switch (event.type) {
        case 'TASK_STARTED':
            console.log(`[${ts}] ✅ Task started: ${event.payload?.title || 'untitled'}`);
            break;
        case 'TASK_STATUS':
            console.log(`[${ts}] 📊 Status: ${event.payload?.status}`);
            break;
        case 'CHAT_MESSAGE':
            if (event.payload?.role === 'assistant') {
                console.log(`[${ts}] 🤖 Assistant: ${(event.payload.content || '').substring(0, 200)}...`);
            } else if (event.payload?.role === 'user') {
                console.log(`[${ts}] 👤 User: ${event.payload.content}`);
            }
            break;
        case 'TEXT_DELTA':
            textBuffer += event.payload?.delta || '';
            // Print in chunks
            if (textBuffer.length > 100 || event.payload?.delta?.includes('\n')) {
                process.stderr.write(`[${ts}] 💬 ${textBuffer}\n`);
                textBuffer = '';
            }
            break;
        case 'TOOL_CALL':
            console.log(`[${ts}] 🔧 Tool called: ${event.payload?.name} (${event.payload?.id})`);
            if (event.payload?.input) {
                const argsStr = JSON.stringify(event.payload.input).substring(0, 300);
                console.log(`         Args: ${argsStr}`);
            }
            break;
        case 'TOOL_RESULT':
            const success = event.payload?.success ? '✅' : '❌';
            const summary = event.payload?.resultSummary || event.payload?.result?.substring(0, 200) || '';
            console.log(`[${ts}] ${success} Tool result: ${summary.substring(0, 200)}`);
            break;
        case 'PLAN_UPDATED':
            console.log(`[${ts}] 📋 Plan: ${event.payload?.summary || ''}`);
            if (event.payload?.steps) {
                for (const step of event.payload.steps) {
                    console.log(`         - [${step.status}] ${step.description}`);
                }
            }
            break;
        case 'EFFECT_REQUESTED':
            console.log(`[${ts}] ⚠️  Effect requested: ${event.payload?.request?.effectType} (risk: ${event.payload?.riskLevel})`);
            break;
        case 'TASK_FINISHED':
            console.log(`[${ts}] 🎉 Task finished: ${event.payload?.summary || 'completed'}`);
            taskFinished = true;
            break;
        case 'TASK_FAILED':
            console.log(`[${ts}] ❌ Task failed: ${event.payload?.error}`);
            taskFailed = true;
            taskError = event.payload?.error || 'Unknown error';
            break;
        default:
            if (event.type?.endsWith('_response')) {
                // IPC responses (start_task_response, etc.)
                console.log(`[${ts}] 📨 ${event.type}: success=${event.payload?.success}`);
            } else {
                console.log(`[${ts}] 📩 ${event.type}`);
            }
    }
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runTest() {
    console.log('='.repeat(70));
    console.log(`  CoworkAny E2E Test: 小红书帖文`);
    console.log(`  Query: "${TASK_QUERY}"`);
    console.log(`  Timeout: ${TIMEOUT_MS / 1000}s`);
    console.log('='.repeat(70));
    console.log();

    const taskId = randomUUID();
    const command = buildStartTaskCommand(taskId);

    console.log(`[INFO] Spawning sidecar process...`);

    const proc = spawn({
        cmd: ['bun', 'run', 'src/main.ts'],
        cwd: process.cwd(),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
    });

    // Read stderr (sidecar logs) using Bun's async iterator
    const stderrReader = async () => {
        try {
            for await (const chunk of proc.stderr) {
                const text = new TextDecoder().decode(chunk);
                for (const line of text.split('\n')) {
                    if (line.trim()) {
                        process.stderr.write(`[SIDECAR] ${line}\n`);
                    }
                }
            }
        } catch {}
    };
    stderrReader();

    // Read stdout (JSON events) using Bun's async iterator
    let stdoutBuffer = '';
    const stdoutReader = async () => {
        try {
            for await (const chunk of proc.stdout) {
                stdoutBuffer += new TextDecoder().decode(chunk);

                // Process complete lines
                const lines = stdoutBuffer.split('\n');
                stdoutBuffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const event = JSON.parse(line);
                        processEvent(event);
                    } catch {
                        process.stderr.write(`[STDOUT-RAW] ${line}\n`);
                    }
                }
            }
        } catch {}
    };
    stdoutReader();

    // Wait for sidecar to initialize
    console.log(`[INFO] Waiting for sidecar to initialize...`);
    await new Promise(r => setTimeout(r, 3000));

    // Send the start_task command
    console.log(`[INFO] Sending start_task command...`);
    console.log(`[INFO] TaskId: ${taskId}`);
    console.log();

    proc.stdin.write(command + '\n');
    proc.stdin.flush();

    // Wait for task completion or timeout
    const startTime = Date.now();
    while (!taskFinished && !taskFailed && Date.now() - startTime < TIMEOUT_MS) {
        await new Promise(r => setTimeout(r, 1000));
    }

    // Flush remaining text
    if (textBuffer) {
        console.log(`💬 ${textBuffer}`);
    }

    // Summary
    console.log();
    console.log('='.repeat(70));
    console.log('  TEST RESULTS');
    console.log('='.repeat(70));
    console.log(`  Total events: ${eventLog.length}`);
    console.log(`  Tool calls: ${eventLog.filter(e => e.type === 'TOOL_CALL').length}`);
    console.log(`  Status: ${taskFinished ? '✅ FINISHED' : taskFailed ? '❌ FAILED: ' + taskError : '⏱️ TIMEOUT'}`);

    const browserTools = eventLog.filter(e =>
        e.type === 'TOOL_CALL' && e.payload?.name?.startsWith('browser_')
    );
    if (browserTools.length > 0) {
        console.log(`  Browser actions: ${browserTools.length}`);
        for (const bt of browserTools) {
            console.log(`    - ${bt.payload.name}: ${JSON.stringify(bt.payload.input || {}).substring(0, 100)}`);
        }
    }

    console.log('='.repeat(70));

    // Kill sidecar
    proc.kill();
    process.exit(taskFinished ? 0 : 1);
}

runTest().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});
