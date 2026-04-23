const SUDO_TOKEN_PATTERN = /(^|[\s;|&()])sudo(?=\s|$)/u;
const SUDO_STDIN_OPTION_PATTERN = /\bsudo\b[^\n\r]*\s(?:-S|--stdin)\b/u;
const SUDO_NON_INTERACTIVE_OPTION_PATTERN = /\bsudo\b[^\n\r]*\s(?:-n|--non-interactive)\b/u;
const SUDO_FAILURE_PATTERN = /sudo:\s*(?:a password is required|no tty present|a terminal is required|sorry,\s*try again|a password is required)/iu;

export const SUDO_PASSWORD_ENV_KEYS = [
    'COWORKANY_SUDO_PASSWORD',
    'SUDO_PASSWORD',
] as const;

export type SudoExecutionPlan = {
    isSudoCommand: boolean;
    transformed: boolean;
    commandToRun: string;
    stdinData?: string;
    usesPassword: boolean;
    passwordEnvKey?: (typeof SUDO_PASSWORD_ENV_KEYS)[number];
    nonInteractive: boolean;
};

function replaceFirstSudoToken(command: string, replacement: string): string {
    let replaced = false;
    return command.replace(SUDO_TOKEN_PATTERN, (match, prefix: string) => {
        if (replaced) {
            return match;
        }
        replaced = true;
        return `${prefix}${replacement}`;
    });
}

function resolveSudoPasswordFromEnv(
    env: NodeJS.ProcessEnv,
): { password: string; key: (typeof SUDO_PASSWORD_ENV_KEYS)[number] } | null {
    for (const key of SUDO_PASSWORD_ENV_KEYS) {
        const value = env[key];
        if (typeof value === 'string' && value.length > 0) {
            return {
                password: value,
                key,
            };
        }
    }
    return null;
}

export function buildSudoExecutionPlan(
    command: string,
    input?: { env?: NodeJS.ProcessEnv },
): SudoExecutionPlan {
    const env = input?.env ?? process.env;
    const isSudoCommand = SUDO_TOKEN_PATTERN.test(command);
    if (!isSudoCommand) {
        return {
            isSudoCommand: false,
            transformed: false,
            commandToRun: command,
            usesPassword: false,
            nonInteractive: false,
        };
    }

    const resolvedPassword = resolveSudoPasswordFromEnv(env);
    const hasSudoStdinOption = SUDO_STDIN_OPTION_PATTERN.test(command);
    const hasSudoNonInteractiveOption = SUDO_NON_INTERACTIVE_OPTION_PATTERN.test(command);

    if (resolvedPassword) {
        const commandToRun = hasSudoStdinOption
            ? command
            : replaceFirstSudoToken(command, "sudo -S -p ''");
        return {
            isSudoCommand: true,
            transformed: commandToRun !== command,
            commandToRun,
            stdinData: `${resolvedPassword.password}\n`,
            usesPassword: true,
            passwordEnvKey: resolvedPassword.key,
            nonInteractive: false,
        };
    }

    const commandToRun = hasSudoNonInteractiveOption
        ? command
        : replaceFirstSudoToken(command, 'sudo -n');
    return {
        isSudoCommand: true,
        transformed: commandToRun !== command,
        commandToRun,
        usesPassword: false,
        nonInteractive: true,
    };
}

export function hasSudoFailure(stderr: string): boolean {
    return SUDO_FAILURE_PATTERN.test(stderr);
}

export function buildSudoFailureSuggestion(input: {
    command: string;
    usesPassword: boolean;
}): string {
    if (input.usesPassword) {
        return `sudo failed for "${input.command}". Verify COWORKANY_SUDO_PASSWORD/SUDO_PASSWORD is correct, or run the command manually in a terminal to enter password interactively.`;
    }
    return `sudo requires interactive auth for "${input.command}". Set COWORKANY_SUDO_PASSWORD (or SUDO_PASSWORD) to allow non-interactive execution, or run manually in a terminal.`;
}

export function appendSudoFailureHint(input: {
    command: string;
    stderr: string;
    usesPassword: boolean;
}): string {
    if (!hasSudoFailure(input.stderr)) {
        return input.stderr;
    }
    const hint = buildSudoFailureSuggestion({
        command: input.command,
        usesPassword: input.usesPassword,
    });
    if (input.stderr.includes(hint)) {
        return input.stderr;
    }
    const suffix = input.stderr.endsWith('\n') ? '' : '\n';
    return `${input.stderr}${suffix}${hint}`;
}
