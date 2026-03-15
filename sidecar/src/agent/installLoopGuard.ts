export interface ParsedRunCommandResult {
    exitCode?: number | null;
    stdout: string;
    stderr: string;
    error?: string;
}

const PYTHON_INSTALL_COMMAND_REGEX =
    /^(?:python(?:\d+(?:\.\d+)*)?\s+-m\s+pip|py(?:\s+-\d+(?:\.\d+)*)?\s+-m\s+pip|pip\d*|uv\s+pip)\s+install\b/i;

const SUCCESSFUL_INSTALL_PATTERNS = [
    /requirement already satisfied/i,
    /successfully installed/i,
    /installing collected packages/i,
];

export function normalizePythonInstallCommandForLoopGuard(command: string): string | null {
    const normalized = command.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!normalized) {
        return null;
    }

    return PYTHON_INSTALL_COMMAND_REGEX.test(normalized) ? normalized : null;
}

export function parseRunCommandResult(result: unknown): ParsedRunCommandResult {
    if (typeof result === 'string') {
        try {
            return parseRunCommandResult(JSON.parse(result));
        } catch {
            return {
                stdout: result,
                stderr: '',
            };
        }
    }

    if (!result || typeof result !== 'object') {
        return {
            stdout: '',
            stderr: '',
        };
    }

    const payload = result as Record<string, unknown>;
    return {
        exitCode: typeof payload.exit_code === 'number' ? payload.exit_code : null,
        stdout: typeof payload.stdout === 'string' ? payload.stdout : '',
        stderr: typeof payload.stderr === 'string' ? payload.stderr : '',
        error: typeof payload.error === 'string' ? payload.error : undefined,
    };
}

export function isSuccessfulPythonInstallResult(result: unknown): boolean {
    const parsed = parseRunCommandResult(result);

    if (typeof parsed.exitCode === 'number' && parsed.exitCode !== 0) {
        return false;
    }

    if (parsed.error && parsed.error.trim().length > 0) {
        return false;
    }

    const combinedOutput = `${parsed.stdout}\n${parsed.stderr}`.trim();
    if (!combinedOutput) {
        return false;
    }

    return SUCCESSFUL_INSTALL_PATTERNS.some((pattern) => pattern.test(combinedOutput));
}

export function buildRepeatedSuccessfulInstallMessage(command: string, repeatCount: number): string {
    return `[AUTOPILOT] The installation command "${command}" already succeeded earlier in this task. ` +
        `Do not run the same package installation again. ` +
        `Proceed to the next step, or finish the task if installation was the goal. ` +
        `(repeat prevention count: ${repeatCount})`;
}

export function isDirectPackageInstallRequest(query: string): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    const mentionsInstallVerb = /(install|安装|装好|setup|set up)/i.test(normalized);
    const mentionsPackageScope = /(python|pip|package|packages|dependency|dependencies|module|库|依赖)/i.test(normalized);

    return mentionsInstallVerb && mentionsPackageScope;
}
