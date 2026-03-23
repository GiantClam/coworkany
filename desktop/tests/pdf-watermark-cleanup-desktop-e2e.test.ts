/**
 * Desktop GUI E2E: PDF watermark cleanup (anti-loop acceptance)
 *
 * Scenario:
 * 1) Launch CoworkAny Desktop (Tauri)
 * 2) Send a user message to clean "coworkany" watermark from a PDF
 * 3) Verify the task does not get stuck in repeated identical run_command loops
 * 4) Verify watermark text is removed from the PDF
 *
 * Run:
 *   cd desktop && npx playwright test tests/pdf-watermark-cleanup-desktop-e2e.test.ts
 */

import { test, expect, type Locator } from './tauriFixtureNoChrome';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

const TASK_TIMEOUT_MS = 8 * 60 * 1000;

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

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function resolvePythonCommand(): string {
    const candidates = ['python', 'python3'];
    for (const command of candidates) {
        const probe = spawnSync(command, ['--version'], { encoding: 'utf-8' });
        if (probe.status === 0) {
            return command;
        }
    }
    throw new Error('Neither python nor python3 is available in PATH');
}

function runPython(command: string, args: string[], cwd?: string): { code: number | null; stdout: string; stderr: string } {
    const proc = spawnSync(command, args, {
        cwd,
        encoding: 'utf-8',
    });
    return {
        code: proc.status,
        stdout: proc.stdout || '',
        stderr: proc.stderr || '',
    };
}

function ensurePythonPdfDependencies(command: string, sidecarDir: string): void {
    const install = runPython(
        command,
        ['-m', 'pip', 'install', '--disable-pip-version-check', 'pypdf', 'reportlab'],
        sidecarDir,
    );
    if (install.code !== 0) {
        throw new Error(`Failed to install Python PDF dependencies.\n${install.stdout}\n${install.stderr}`);
    }
}

function createWatermarkedPdf(command: string, pdfPath: string): void {
    const script = [
        'from reportlab.pdfgen import canvas',
        'from reportlab.lib.pagesizes import A4',
        `path = r"""${pdfPath.replace(/\\/g, '\\\\')}"""`,
        'c = canvas.Canvas(path, pagesize=A4, pageCompression=0)',
        "c.setFont('Helvetica', 12)",
        "c.drawString(80, 760, 'Resume: Test Candidate')",
        "c.drawString(80, 720, 'coworkany watermark')",
        'c.save()',
        "print('PDF_CREATED')",
    ].join('\n');

    const created = runPython(command, ['-c', script]);
    if (created.code !== 0 || !/PDF_CREATED/.test(created.stdout)) {
        throw new Error(`Failed to create test PDF.\n${created.stdout}\n${created.stderr}`);
    }
}

function detectCoworkanyInPdf(command: string, pdfPath: string): boolean {
    const rawHas = fs.readFileSync(pdfPath).toString('latin1').toLowerCase().includes('coworkany');
    if (!rawHas) {
        return false;
    }

    // Raw bytes still contain marker; use pypdf as secondary signal.
    const script = [
        'import pypdf',
        `path = r"""${pdfPath.replace(/\\/g, '\\\\')}"""`,
        'reader = pypdf.PdfReader(path)',
        'text = ""',
        'for page in reader.pages:',
        '    text += (page.extract_text() or "")',
        "print('FOUND' if 'coworkany' in text.lower() else 'NOT_FOUND')",
    ].join('\n');
    const result = runPython(command, ['-c', script]);
    if (result.code !== 0) {
        return rawHas;
    }
    return /FOUND/.test(result.stdout) || rawHas;
}

function writeCleanupScript(scriptPath: string): void {
    const script = [
        '#!/usr/bin/env python3',
        'import argparse',
        'from pathlib import Path',
        '',
        'parser = argparse.ArgumentParser()',
        "parser.add_argument('pdf_path')",
        'args = parser.parse_args()',
        '',
        'p = Path(args.pdf_path)',
        'raw = p.read_bytes()',
        "needle = b'coworkany'",
        'count = raw.lower().count(needle)',
        "cleaned = raw.replace(b'coworkany', b'_________')",
        'p.write_bytes(cleaned)',
        "print(f'PDF_WATERMARK_CLEAN_DONE replaced={count}')",
    ].join('\n');
    fs.writeFileSync(scriptPath, script, 'utf-8');
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

function normalizeCommand(command: string): string {
    return command.trim().replace(/\s+/g, ' ').toLowerCase();
}

type ExecutionToolCall = {
    toolName: string;
    command: string;
};

function parseExecutionToolCalls(rawLogs: string): ExecutionToolCall[] {
    const calls: ExecutionToolCall[] = [];
    const marker = 'Received from sidecar: ';
    for (const line of rawLogs.split(/\r?\n/)) {
        const idx = line.indexOf(marker);
        if (idx < 0) continue;
        const jsonPart = line.slice(idx + marker.length).trim();
        if (!jsonPart.startsWith('{')) continue;
        try {
            const evt = JSON.parse(jsonPart) as any;
            const name = evt?.payload?.name;
            if (evt?.type === 'TOOL_CALL' && (name === 'run_command' || name === 'execute_python')) {
                const input = evt?.payload?.input || {};
                const command =
                    typeof input?.command === 'string'
                        ? input.command
                        : JSON.stringify(input);
                if (typeof command === 'string' && command.trim().length > 0) {
                    calls.push({ toolName: name, command });
                }
            }
        } catch {
            // Fallback: regex parse for partially malformed JSON log lines.
            if (line.includes('"type":"TOOL_CALL"') && (line.includes('"name":"run_command"') || line.includes('"name":"execute_python"'))) {
                const m = line.match(/"(?:command|code|script)":"((?:\\.|[^"\\])*)"/);
                if (m?.[1]) {
                    try {
                        const parsed = JSON.parse(`"${m[1]}"`);
                        if (typeof parsed === 'string' && parsed.trim().length > 0) {
                            const toolName = line.includes('"name":"execute_python"') ? 'execute_python' : 'run_command';
                            calls.push({ toolName, command: parsed });
                        }
                    } catch {
                        // Ignore fallback parse errors.
                    }
                }
            }
        }
    }
    return calls;
}

function maxConsecutiveIdentical(commands: string[]): number {
    let max = 0;
    let current = 0;
    let prev = '';
    for (const cmd of commands.map(normalizeCommand)) {
        if (cmd === prev) {
            current += 1;
        } else {
            prev = cmd;
            current = 1;
        }
        if (current > max) {
            max = current;
        }
    }
    return max;
}

test.describe('Desktop GUI E2E - PDF watermark cleanup', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 180_000);

    test('send PDF cleanup message via desktop and verify anti-loop + cleanup result', async ({ page, tauriLogs }) => {
        const sidecarDir = path.resolve(process.cwd(), '..', 'sidecar');
        const scenarioDir = path.join(os.tmpdir(), `desktop-pdf-watermark-${Date.now()}`);
        const testResultsDir = path.join(process.cwd(), 'test-results');
        const pythonCommand = resolvePythonCommand();
        ensureDir(scenarioDir);
        ensureDir(testResultsDir);

        ensurePythonPdfDependencies(pythonCommand, sidecarDir);

        const targetPdf = path.join(scenarioDir, 'resume_with_watermark.pdf');
        const cleanupScript = path.join(scenarioDir, 'remove_coworkany_watermark.py');
        createWatermarkedPdf(pythonCommand, targetPdf);
        writeCleanupScript(cleanupScript);

        const beforeHasWatermark = detectCoworkanyInPdf(pythonCommand, targetPdf);
        expect(beforeHasWatermark, 'test fixture PDF should include "coworkany" before cleanup').toBe(true);

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(12_000);

        const input = await findChatInput(page);
        expect(input, 'desktop UI should expose chat input').not.toBeNull();

        const taskQuery = [
            `Clean the watermark text from this PDF: ${targetPdf}`,
            `Execute this command first and do not install skills: ${pythonCommand} "${cleanupScript}" "${targetPdf}"`,
            'Do not inspect directories first and do not call marketplace or skill installation tools.',
            'Do not repeat identical run_command calls. After completion, print a cleanup completion marker.',
            'Finally confirm the watermark text is removed.',
        ].join('\n');
        tauriLogs.setBaseline();
        await input!.fill(taskQuery);
        await input!.press('Enter');
        await page.waitForTimeout(2000);

        if (!tauriLogs.containsSinceBaseline('send_task_message command received')) {
            const submitButton = page.locator('button[type="submit"], .send-button').first();
            const canClick = await submitButton.isVisible({ timeout: 1000 }).catch(() => false);
            if (canClick) {
                await submitButton.click({ timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(2000);
            }
        }

        let submitted = false;
        let taskFinished = false;
        let taskFailed = false;
        let markerSeen = false;
        const startedAt = Date.now();

        while (Date.now() - startedAt < TASK_TIMEOUT_MS) {
            await page.waitForTimeout(4000);
            const logs = tauriLogs.getRawSinceBaseline().toLowerCase();
            submitted = submitted || logs.includes('send_task_message command received');
            markerSeen = markerSeen || logs.includes('pdf_watermark_clean_done replaced=');
            taskFinished = taskFinished || logs.includes('"type":"task_finished"') || logs.includes('task_finished');
            taskFailed = taskFailed || logs.includes('"type":"task_failed"') || logs.includes('task_failed');

            if (taskFinished || taskFailed || markerSeen) {
                break;
            }
        }

        const finalLogs = tauriLogs.getRawSinceBaseline();
        const executionCalls = parseExecutionToolCalls(finalLogs);
        const maxRepeat = maxConsecutiveIdentical(executionCalls.map((call) => call.command));
        const calledCleanupScript = executionCalls.some((call) =>
            normalizeCommand(call.command).includes(normalizeCommand(cleanupScript))
        );
        const afterHasWatermark = detectCoworkanyInPdf(pythonCommand, targetPdf);

        const summary = {
            targetPdf,
            cleanupScript,
            submitted,
            taskFinished,
            taskFailed,
            markerSeen,
            executionCalls: executionCalls.length,
            maxConsecutiveIdenticalExecutionCall: maxRepeat,
            calledCleanupScript,
            beforeHasWatermark,
            afterHasWatermark,
        };

        fs.writeFileSync(
            path.join(testResultsDir, 'pdf-watermark-cleanup-desktop-summary.json'),
            JSON.stringify(summary, null, 2),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(testResultsDir, 'pdf-watermark-cleanup-desktop-logs.txt'),
            finalLogs,
            'utf-8',
        );
        await page.screenshot({ path: path.join(testResultsDir, 'pdf-watermark-cleanup-desktop-final.png') }).catch(() => {});

        console.log('[Test] summary:', summary);

        expect(submitted, 'message should be submitted from desktop UI').toBe(true);
        expect(executionCalls.length, 'agent should call an execution tool at least once').toBeGreaterThan(0);
        expect(calledCleanupScript, 'agent should execute the cleanup script').toBe(true);
        expect(maxRepeat, 'identical execution command should not loop indefinitely').toBeLessThanOrEqual(4);
        expect(taskFailed, 'task should not fail').toBe(false);
        expect(markerSeen, 'cleanup script marker should appear in logs').toBe(true);
        expect(afterHasWatermark, 'watermark should be removed from PDF').toBe(false);
    });
});
