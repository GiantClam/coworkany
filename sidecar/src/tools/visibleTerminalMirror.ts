import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';

function parseBooleanEnv(value: string | undefined): boolean | null {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }
    return null;
}

function quoteShell(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escapeAppleScript(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
}

function quotePowerShellDouble(value: string): string {
    return `"${value
        .replace(/`/g, '``')
        .replace(/"/g, '`"')
        .replace(/\r/g, '')
        .replace(/\n/g, ' ')}"`;
}

function quotePowerShellSingle(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

function toSingleLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function shouldEnableByDefault(): boolean {
    const appDir = process.env.COWORKANY_APP_DIR?.trim();
    return Boolean(appDir && appDir.length > 0);
}

export function shouldEnableVisibleTerminalMirror(): boolean {
    const explicit = parseBooleanEnv(process.env.COWORKANY_SHELL_VISIBLE_TERMINAL);
    if (explicit !== null) {
        return explicit;
    }
    return shouldEnableByDefault();
}

function launchMonitorWindow(input: {
    logFilePath: string;
    command: string;
    cwd: string;
}): void {
    const commandPreview = toSingleLine(input.command);
    const cwdPreview = toSingleLine(input.cwd);
    const lines = [
        '[CoworkAny] Shell command monitor',
        `CWD: ${cwdPreview}`,
        `Command: ${commandPreview}`,
        '----------------------------------------',
    ];
    if (process.platform === 'darwin') {
        const viewerCommand = [
            ...lines.map((line) => `printf '%s\\n' ${quoteShell(line)}`),
            `touch ${quoteShell(input.logFilePath)}`,
            `tail -n +1 -f ${quoteShell(input.logFilePath)}`,
        ].join('; ');
        const child = spawn('osascript', [
            '-e',
            'tell application "Terminal" to activate',
            '-e',
            `tell application "Terminal" to do script "${escapeAppleScript(viewerCommand)}"`,
        ], {
            stdio: 'ignore',
            detached: true,
        });
        child.unref();
        return;
    }
    if (process.platform === 'win32') {
        const psScript = [
            `$Host.UI.RawUI.WindowTitle = ${quotePowerShellDouble('CoworkAny Shell Monitor')}`,
            `Write-Host ${quotePowerShellDouble('[CoworkAny] Shell command monitor')}`,
            `Write-Host ${quotePowerShellDouble(`CWD: ${cwdPreview}`)}`,
            `Write-Host ${quotePowerShellDouble(`Command: ${commandPreview}`)}`,
            `Write-Host ${quotePowerShellDouble('----------------------------------------')}`,
            `if (!(Test-Path -LiteralPath ${quotePowerShellSingle(input.logFilePath)})) { New-Item -ItemType File -Path ${quotePowerShellSingle(input.logFilePath)} -Force | Out-Null }`,
            `Get-Content -LiteralPath ${quotePowerShellSingle(input.logFilePath)} -Wait`,
        ].join('; ');
        const child = spawn('cmd', [
            '/c',
            'start',
            '',
            'powershell',
            '-NoProfile',
            '-NoExit',
            '-Command',
            psScript,
        ], {
            stdio: 'ignore',
            detached: true,
            windowsHide: false,
        });
        child.unref();
        return;
    }
    const viewerCommand = [
        ...lines.map((line) => `printf '%s\\n' ${quoteShell(line)}`),
        `touch ${quoteShell(input.logFilePath)}`,
        `tail -n +1 -f ${quoteShell(input.logFilePath)}`,
    ].join('; ');
    const launchScript = [
        `if command -v gnome-terminal >/dev/null 2>&1; then gnome-terminal -- bash -lc ${quoteShell(viewerCommand)}; exit 0; fi`,
        `if command -v konsole >/dev/null 2>&1; then konsole -e bash -lc ${quoteShell(viewerCommand)}; exit 0; fi`,
        `if command -v xterm >/dev/null 2>&1; then xterm -e bash -lc ${quoteShell(viewerCommand)}; exit 0; fi`,
        'exit 0',
    ].join('; ');
    const child = spawn(launchScript, {
        shell: true,
        stdio: 'ignore',
        detached: true,
    });
    child.unref();
}

export type VisibleTerminalMirrorSession = {
    logFilePath: string;
    note: (message: string) => void;
    appendStdout: (chunk: string) => void;
    appendStderr: (chunk: string) => void;
    close: (input?: { exitCode?: number; reason?: string }) => void;
};

export function createVisibleTerminalMirrorSession(input: {
    workspacePath: string;
    command: string;
}): VisibleTerminalMirrorSession | null {
    if (!shouldEnableVisibleTerminalMirror()) {
        return null;
    }
    const logsDir = path.join(input.workspacePath, '.coworkany', 'command-logs');
    try {
        fs.mkdirSync(logsDir, { recursive: true });
    } catch {
        return null;
    }
    const runId = `${Date.now()}-${randomUUID()}`;
    const logFilePath = path.join(logsDir, `${runId}.log`);
    let stream: fs.WriteStream;
    try {
        stream = fs.createWriteStream(logFilePath, { flags: 'a', encoding: 'utf-8' });
    } catch {
        return null;
    }
    let closed = false;
    const write = (chunk: string): void => {
        if (closed) {
            return;
        }
        try {
            stream.write(chunk);
        } catch {
            closed = true;
        }
    };
    const writeLine = (line: string): void => {
        write(`${line}\n`);
    };
    writeLine(`[CoworkAny] ${new Date().toISOString()}`);
    writeLine(`CWD: ${input.workspacePath}`);
    writeLine(`Command: ${toSingleLine(input.command)}`);
    writeLine('----------------------------------------');
    try {
        launchMonitorWindow({
            logFilePath,
            command: input.command,
            cwd: input.workspacePath,
        });
    } catch {
    }
    return {
        logFilePath,
        note: (message: string) => {
            writeLine(`[coworkany] ${toSingleLine(message)}`);
        },
        appendStdout: (chunk: string) => {
            write(chunk);
        },
        appendStderr: (chunk: string) => {
            write(chunk);
        },
        close: (closeInput?: { exitCode?: number; reason?: string }) => {
            if (closed) {
                return;
            }
            if (typeof closeInput?.exitCode === 'number') {
                writeLine(`\n[coworkany] command finished with exit code ${closeInput.exitCode}`);
            } else if (typeof closeInput?.reason === 'string' && closeInput.reason.trim().length > 0) {
                writeLine(`\n[coworkany] command finished: ${toSingleLine(closeInput.reason)}`);
            } else {
                writeLine('\n[coworkany] command finished');
            }
            closed = true;
            try {
                stream.end();
            } catch {
            }
        },
    };
}
