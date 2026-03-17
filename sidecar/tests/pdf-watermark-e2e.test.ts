import { describe, test, expect, afterAll } from 'bun:test';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import {
    SidecarProcess,
    buildStartTaskCommand,
    ScenarioVerifier,
    saveTestArtifacts,
} from './helpers/sidecar-harness';
import { resolvePythonExecutable } from './helpers/python';

const TARGET_PDF = 'C:\\Users\\liula\\Downloads\\Resume-YuZiJie.pdf';
const TIMEOUT_LONG = 6 * 60 * 1000;
const PYTHON_EXECUTABLE = resolvePythonExecutable();

async function waitForProgressOrIdle(
    sidecar: SidecarProcess,
    timeoutMs: number,
    opts?: { idleMs?: number; stopWhen?: () => boolean },
): Promise<boolean> {
    const idleMs = opts?.idleMs ?? 25_000;
    const stopWhen = opts?.stopWhen;
    const start = Date.now();
    let lastCount = sidecar.collector.events.length;
    let lastChangeAt = Date.now();

    while (Date.now() - start < timeoutMs) {
        if (stopWhen?.()) {
            return true;
        }
        if (sidecar.collector.taskFinished || sidecar.collector.taskFailed) {
            return true;
        }
        const currentCount = sidecar.collector.events.length;
        if (currentCount !== lastCount) {
            lastCount = currentCount;
            lastChangeAt = Date.now();
        }
        if (sidecar.collector.toolCalls.length > 0 && Date.now() - lastChangeAt > idleMs) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return false;
}

function ensurePythonPdfDependencies(): void {
    const install = Bun.spawnSync({
        cmd: [PYTHON_EXECUTABLE, '-m', 'pip', 'install', '--disable-pip-version-check', 'pypdf', 'PyPDF2', 'reportlab'],
        stdout: 'pipe',
        stderr: 'pipe',
    });
    if (install.exitCode !== 0) {
        const stdout = install.stdout ? Buffer.from(install.stdout).toString('utf-8') : '';
        const stderr = install.stderr ? Buffer.from(install.stderr).toString('utf-8') : '';
        throw new Error(`Failed to install Python PDF dependencies.\n${stdout}\n${stderr}`);
    }
}

function containsCoworkanyInBinary(filePath: string): boolean {
    const content = fs.readFileSync(filePath);
    return /coworkany/i.test(content.toString('latin1'));
}

function detectCoworkanyByPythonExtract(filePath: string): { ran: boolean; found: boolean; output: string } {
    const script = [
        'import sys',
        'path = r"""' + filePath.replace(/\\/g, '\\\\') + '"""',
        'text = ""',
        'found = False',
        'try:',
        '    import pypdf',
        '    reader = pypdf.PdfReader(path)',
        '    for page in reader.pages:',
        '        text += (page.extract_text() or "")',
        '    found = "coworkany" in text.lower()',
        '    print("FOUND" if found else "NOT_FOUND")',
        'except Exception as e:',
        '    print("PY_ERROR:" + str(e))',
    ].join('\n');

    const proc = Bun.spawnSync({
        cmd: [PYTHON_EXECUTABLE, '-c', script],
        stdout: 'pipe',
        stderr: 'pipe',
    });

    const stdout = proc.stdout ? Buffer.from(proc.stdout).toString('utf-8').trim() : '';
    const stderr = proc.stderr ? Buffer.from(proc.stderr).toString('utf-8').trim() : '';
    const output = [stdout, stderr].filter(Boolean).join('\n');

    if (proc.exitCode !== 0) {
        return { ran: false, found: false, output };
    }

    const marker = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .pop() || '';

    return {
        ran: true,
        found: marker === 'FOUND',
        output,
    };
}

describe('E2E: PDF watermark', () => {
    let sidecar: SidecarProcess;
    afterAll(() => sidecar?.kill());

    test('simulate user query: add watermark "coworkany" to Resume-YuZiJie.pdf', async () => {
        expect(fs.existsSync(TARGET_PDF)).toBeTrue();
        ensurePythonPdfDependencies();

        const beforeStat = fs.statSync(TARGET_PDF);
        const beforeBinaryHasMark = containsCoworkanyInBinary(TARGET_PDF);
        const beforePythonDetect = detectCoworkanyByPythonExtract(TARGET_PDF);
        const beforeHasMark = beforeBinaryHasMark || beforePythonDetect.found;

        sidecar = new SidecarProcess();
        await sidecar.start();

        const taskId = randomUUID();
        sidecar.sendCommand(buildStartTaskCommand({
            taskId,
            title: 'E2E-PDF-WATERMARK',
            userQuery: [
                `Add watermark "coworkany" to "${TARGET_PDF}" and overwrite the same file.`,
                'Execute strictly in this order. Do not do environment probing and do not repeat dependency installation:',
                '1) Use run_command to execute a Python script that applies watermark text on each page and prints WATERMARK_DONE',
                '2) Use run_command to verify extracted text contains coworkany, and print VERIFY_OK or VERIFY_FAIL',
                '3) End task only if VERIFY_OK appears in output',
            ].join('\n'),
        }));

        const reachedReadyState = await waitForProgressOrIdle(sidecar, TIMEOUT_LONG, {
            stopWhen: () => {
                if (/verify_ok/i.test(sidecar.collector.getAllText())) {
                    return true;
                }
                if (!sidecar.collector.taskStarted) {
                    return false;
                }
                const currentStat = fs.statSync(TARGET_PDF);
                const changed =
                    currentStat.mtimeMs > beforeStat.mtimeMs ||
                    currentStat.size !== beforeStat.size;
                if (!changed) {
                    return false;
                }
                const pythonDetect = detectCoworkanyByPythonExtract(TARGET_PDF);
                return pythonDetect.ran && pythonDetect.found;
            },
        });

        const verifier = new ScenarioVerifier('E2E-PDF-WATERMARK', sidecar.collector);
        verifier
            .checkTaskStarted()
            .checkTaskCompleted()
            .checkLogFileWritten();

        const afterStat = fs.statSync(TARGET_PDF);
        const afterBinaryHasMark = containsCoworkanyInBinary(TARGET_PDF);
        const afterPythonDetect = detectCoworkanyByPythonExtract(TARGET_PDF);
        const afterHasMark = afterBinaryHasMark || afterPythonDetect.found;

        const fileChanged =
            afterStat.mtimeMs > beforeStat.mtimeMs ||
            afterStat.size !== beforeStat.size;

        const hasPdfToolFlow =
            sidecar.collector.getToolCalls('run_command').length > 0 ||
            sidecar.collector.getToolCalls('write_to_file').length > 0 ||
            sidecar.collector.getToolCalls('view_file').length > 0;

        verifier.printReport();
        saveTestArtifacts('pdf-watermark-e2e', {
            'output.txt': sidecar.collector.textBuffer,
            'report.json': JSON.stringify({
                ...verifier.toJSON(),
                taskFailed: sidecar.collector.taskFailed,
                taskError: sidecar.collector.taskError,
                reachedReadyState,
                stderrTail: sidecar.getAllStderr().slice(-4000),
                hasPdfToolFlow,
                outputContainsVerifyOk: /verify_ok/i.test(sidecar.collector.getAllText()),
                before: {
                    size: beforeStat.size,
                    mtimeMs: beforeStat.mtimeMs,
                    hasMark: beforeHasMark,
                    binary: beforeBinaryHasMark,
                    python: beforePythonDetect,
                },
                after: {
                    size: afterStat.size,
                    mtimeMs: afterStat.mtimeMs,
                    hasMark: afterHasMark,
                    binary: afterBinaryHasMark,
                    python: afterPythonDetect,
                },
                fileChanged,
            }, null, 2),
        });

        expect(reachedReadyState).toBeTrue();
        expect(verifier.failCount).toBe(0);
        expect(hasPdfToolFlow).toBeTrue();
        expect(/verify_ok/i.test(sidecar.collector.getAllText())).toBeTrue();
        expect(afterHasMark).toBeTrue();
        expect(fileChanged || beforeHasMark).toBeTrue();
    }, TIMEOUT_LONG + 60_000);
});
