import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { getAlternativeCommands, extractBaseCommand, getCurrentPlatform } from '../utils/commandAlternatives';
import { checkCommand } from './commandSandbox';
import type { EffectRequest, EffectResponse, EffectType, EffectScope } from '../protocol';

// ============================================================================
// Types
// ============================================================================

/**
 * Standard effect categories for tool security and permission management
 * Used by PolicyBridge to enforce tool usage constraints
 */
export type ToolEffect =
    | 'filesystem:read'      // Read files/directories
    | 'filesystem:write'     // Write/modify files
    | 'filesystem:delete'    // Delete files/directories
    | 'network:outbound'     // Make external HTTP requests
    | 'process:spawn'        // Spawn child processes
    | 'ui:notify'            // Show notifications to user
    | 'state:remember'       // Persist data across sessions
    | 'code:execute'         // Execute arbitrary code
    | 'code:execute:sandbox' // Sandboxed code execution
    | 'knowledge:read'       // Read from knowledge base
    | 'knowledge:update';    // Update knowledge base

export type ToolDefinition = {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    effects: ToolEffect[];   // Security effects this tool can cause
    handler: (args: any, context: ToolContext) => Promise<any>;
};

export type ToolContext = {
    workspacePath: string;
    taskId: string;
};

// ============================================================================
// Error Analysis Helper
// ============================================================================

type CommandErrorType = 'syntax' | 'runtime' | 'dependency' | 'permission' | 'timeout' | 'not_found' | 'unknown';

interface CommandErrorAnalysis {
    type: CommandErrorType;
    suggestion: string;
    alternatives?: string[];  // Alternative commands to try
}

type CommandPreflightRequirement = {
    required: boolean;
    reason?: string;
    category?: 'high_risk' | 'platform_sensitive' | 'forceful';
};

type CapturedCommandResult = {
    command: string;
    exit_code: number;
    stdout: string;
    stderr: string;
};

type CommandHelpReport = {
    success: boolean;
    baseCommand: string;
    attemptedCommands: string[];
    selectedCommand?: string;
    outputSnippet?: string;
    stderrSnippet?: string;
};

type CommandPreflightReport = {
    command: string;
    baseCommand: string;
    platform: string;
    riskLevel: string;
    requirement: CommandPreflightRequirement;
    commandExists: boolean;
    resolution: {
        paths: string[];
        detail?: string;
    };
    commandKnowledge?: PlatformCommandKnowledge;
    alternatives: string[];
    help: CommandHelpReport;
    preflightToken?: string;
    alreadyPreflightedInTask?: boolean;
    nextStep: string;
};

type DirectExecutionPlan = {
    executable: string;
    args: string[];
};

type CommandLearningSystemContext = {
    platform: string;
    platformName: string;
    osType: string;
    osRelease: string;
    arch: string;
    shell: string;
    shellFamily: 'powershell-cmd' | 'posix';
    recommendedHelpCommands: string[];
    learningSequence: string[];
};

type PlatformCommandKnowledge = {
    baseCommand: string;
    category: 'service' | 'task' | 'network' | 'package' | 'process' | 'filesystem' | 'power' | 'system' | 'security';
    platforms: Array<'windows' | 'macos' | 'linux'>;
    shellFamilies: Array<'powershell-cmd' | 'posix'>;
    helpHints: string[];
    reason: string;
};

const COMMAND_PREFLIGHT_TTL_MS = 10 * 60 * 1000;
const commandPreflightApprovals = new Map<string, { normalizedCommand: string; expiresAt: number }>();
const commandPreflightCache = new Map<string, { token: string; expiresAt: number; report: CommandPreflightReport }>();
const commandPreflightReviews = new Map<string, { expiresAt: number }>();
type CommandApprovalRequester = (request: EffectRequest) => Promise<EffectResponse>;
let commandApprovalRequester: CommandApprovalRequester | null = null;

const PLATFORM_COMMAND_KNOWLEDGE: PlatformCommandKnowledge[] = [
    { baseCommand: 'shutdown', category: 'power', platforms: ['windows'], shellFamilies: ['powershell-cmd'], helpHints: ['shutdown /?', 'system_shutdown_*'], reason: 'Windows shutdown semantics are sensitive and have dedicated tools.' },
    { baseCommand: 'schtasks', category: 'task', platforms: ['windows'], shellFamilies: ['powershell-cmd'], helpHints: ['schtasks /?'], reason: 'Windows scheduled task syntax is platform-specific and verbose.' },
    { baseCommand: 'sc', category: 'service', platforms: ['windows'], shellFamilies: ['powershell-cmd'], helpHints: ['sc /?'], reason: 'Windows service control flags differ from Linux/macOS service commands.' },
    { baseCommand: 'netsh', category: 'network', platforms: ['windows'], shellFamilies: ['powershell-cmd'], helpHints: ['netsh /?'], reason: 'Windows network/firewall configuration commands are platform-specific.' },
    { baseCommand: 'reg', category: 'system', platforms: ['windows'], shellFamilies: ['powershell-cmd'], helpHints: ['reg /?'], reason: 'Windows registry operations are high-impact and platform-specific.' },
    { baseCommand: 'regedit', category: 'system', platforms: ['windows'], shellFamilies: ['powershell-cmd'], helpHints: ['regedit /?'], reason: 'Registry editing is platform-specific and high-impact.' },
    { baseCommand: 'diskpart', category: 'filesystem', platforms: ['windows'], shellFamilies: ['powershell-cmd'], helpHints: ['diskpart /?'], reason: 'Disk partition management is destructive and Windows-specific.' },
    { baseCommand: 'format', category: 'filesystem', platforms: ['windows'], shellFamilies: ['powershell-cmd'], helpHints: ['format /?'], reason: 'Drive formatting is destructive and platform-specific.' },
    { baseCommand: 'taskkill', category: 'process', platforms: ['windows'], shellFamilies: ['powershell-cmd'], helpHints: ['taskkill /?'], reason: 'Windows process termination flags differ from Unix kill commands.' },
    { baseCommand: 'ipconfig', category: 'network', platforms: ['windows'], shellFamilies: ['powershell-cmd'], helpHints: ['ipconfig /?'], reason: 'Windows network inspection uses platform-specific commands.' },
    { baseCommand: 'route', category: 'network', platforms: ['windows'], shellFamilies: ['powershell-cmd'], helpHints: ['route /?'], reason: 'Routing table management differs by operating system.' },
    { baseCommand: 'wevtutil', category: 'system', platforms: ['windows'], shellFamilies: ['powershell-cmd'], helpHints: ['wevtutil /?'], reason: 'Windows event log management is platform-specific.' },
    { baseCommand: 'winget', category: 'package', platforms: ['windows'], shellFamilies: ['powershell-cmd'], helpHints: ['winget --help'], reason: 'Windows package management syntax differs from Linux/macOS managers.' },

    { baseCommand: 'launchctl', category: 'service', platforms: ['macos'], shellFamilies: ['posix'], helpHints: ['launchctl help'], reason: 'macOS service management is unique to launchd/launchctl.' },
    { baseCommand: 'networksetup', category: 'network', platforms: ['macos'], shellFamilies: ['posix'], helpHints: ['networksetup -help'], reason: 'macOS network configuration uses platform-specific verbs.' },
    { baseCommand: 'scutil', category: 'network', platforms: ['macos'], shellFamilies: ['posix'], helpHints: ['scutil --help'], reason: 'macOS system configuration interfaces differ from Linux/Windows.' },
    { baseCommand: 'diskutil', category: 'filesystem', platforms: ['macos'], shellFamilies: ['posix'], helpHints: ['diskutil help'], reason: 'macOS disk management commands are platform-specific and potentially destructive.' },
    { baseCommand: 'pmset', category: 'power', platforms: ['macos'], shellFamilies: ['posix'], helpHints: ['pmset -g', 'man pmset'], reason: 'macOS power management syntax is unique and high-impact.' },
    { baseCommand: 'softwareupdate', category: 'package', platforms: ['macos'], shellFamilies: ['posix'], helpHints: ['softwareupdate --help'], reason: 'macOS update management differs from other package managers.' },
    { baseCommand: 'pkgutil', category: 'package', platforms: ['macos'], shellFamilies: ['posix'], helpHints: ['pkgutil --help'], reason: 'macOS package tooling is platform-specific.' },
    { baseCommand: 'defaults', category: 'system', platforms: ['macos'], shellFamilies: ['posix'], helpHints: ['man defaults'], reason: 'macOS preference editing is platform-specific and can affect system behavior.' },
    { baseCommand: 'systemsetup', category: 'system', platforms: ['macos'], shellFamilies: ['posix'], helpHints: ['sudo systemsetup -help'], reason: 'macOS system setup commands are privileged and platform-specific.' },

    { baseCommand: 'systemctl', category: 'service', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['systemctl --help', 'man systemctl'], reason: 'Linux service control semantics vary by init system and require verification.' },
    { baseCommand: 'journalctl', category: 'service', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['journalctl --help', 'man journalctl'], reason: 'Linux journald queries use platform-specific flags.' },
    { baseCommand: 'ufw', category: 'security', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['ufw --help', 'man ufw'], reason: 'Firewall configuration is high-impact and Linux-specific.' },
    { baseCommand: 'iptables', category: 'security', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['iptables --help', 'man iptables'], reason: 'Packet filter syntax is high-impact and platform-specific.' },
    { baseCommand: 'ip', category: 'network', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['ip --help', 'man ip'], reason: 'Linux network interface/routing commands use platform-specific syntax.' },
    { baseCommand: 'ss', category: 'network', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['ss --help', 'man ss'], reason: 'Linux socket inspection syntax is platform-specific.' },
    { baseCommand: 'nmcli', category: 'network', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['nmcli --help', 'man nmcli'], reason: 'NetworkManager CLI syntax is platform-specific.' },
    { baseCommand: 'apt', category: 'package', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['apt --help', 'man apt'], reason: 'Linux package manager actions differ by distribution.' },
    { baseCommand: 'apt-get', category: 'package', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['apt-get --help', 'man apt-get'], reason: 'Linux package manager actions differ by distribution.' },
    { baseCommand: 'dnf', category: 'package', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['dnf --help', 'man dnf'], reason: 'Linux package manager actions differ by distribution.' },
    { baseCommand: 'yum', category: 'package', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['yum --help', 'man yum'], reason: 'Linux package manager actions differ by distribution.' },
    { baseCommand: 'rpm', category: 'package', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['rpm --help', 'man rpm'], reason: 'RPM package operations are platform-specific.' },
    { baseCommand: 'dpkg', category: 'package', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['dpkg --help', 'man dpkg'], reason: 'Debian package operations are platform-specific.' },
    { baseCommand: 'crontab', category: 'task', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['crontab --help', 'man crontab'], reason: 'Cron scheduling syntax is platform-specific and easy to misuse.' },
    { baseCommand: 'mount', category: 'filesystem', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['mount --help', 'man mount'], reason: 'Mount operations affect system state and differ by platform.' },
    { baseCommand: 'umount', category: 'filesystem', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['umount --help', 'man umount'], reason: 'Unmount operations affect system state and differ by platform.' },
    { baseCommand: 'useradd', category: 'system', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['useradd --help', 'man useradd'], reason: 'User management is privileged and platform-specific.' },
    { baseCommand: 'usermod', category: 'system', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['usermod --help', 'man usermod'], reason: 'User management is privileged and platform-specific.' },

    { baseCommand: 'reboot', category: 'power', platforms: ['linux', 'macos'], shellFamilies: ['posix'], helpHints: ['reboot --help', 'man reboot'], reason: 'Power control is high-impact and platform-sensitive.' },
    { baseCommand: 'halt', category: 'power', platforms: ['linux', 'macos'], shellFamilies: ['posix'], helpHints: ['halt --help', 'man halt'], reason: 'Power control is high-impact and platform-sensitive.' },
    { baseCommand: 'poweroff', category: 'power', platforms: ['linux', 'macos'], shellFamilies: ['posix'], helpHints: ['poweroff --help', 'man poweroff'], reason: 'Power control is high-impact and platform-sensitive.' },
    { baseCommand: 'init', category: 'power', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['man init'], reason: 'Init targets affect system runlevel and are high-impact.' },
    { baseCommand: 'killall', category: 'process', platforms: ['linux', 'macos'], shellFamilies: ['posix'], helpHints: ['killall --help', 'man killall'], reason: 'Bulk process termination differs by OS and is high-impact.' },
    { baseCommand: 'chmod', category: 'filesystem', platforms: ['linux', 'macos'], shellFamilies: ['posix'], helpHints: ['chmod --help', 'man chmod'], reason: 'Permission changes can be destructive and syntax varies.' },
    { baseCommand: 'chown', category: 'filesystem', platforms: ['linux', 'macos'], shellFamilies: ['posix'], helpHints: ['chown --help', 'man chown'], reason: 'Ownership changes are high-impact and syntax varies.' },
    { baseCommand: 'mkfs', category: 'filesystem', platforms: ['linux'], shellFamilies: ['posix'], helpHints: ['mkfs --help', 'man mkfs'], reason: 'Filesystem creation is destructive and platform-specific.' },
];

/**
 * Analyze command error output and provide suggestions
 * Uses the unified commandAlternatives module for cross-platform support
 */
function analyzeCommandError(stderr: string, exitCode?: number, command?: string): CommandErrorAnalysis | null {
    const lowerStderr = stderr.toLowerCase();
    const alternatives = command ? getAlternativeCommands(command) : [];

    // Windows exit code 9009 = command not found (even with empty stderr!)
    if (exitCode === 9009) {
        const baseCmd = command?.trim().split(/\s+/)[0] || 'command';
        return {
            type: 'not_found',
            suggestion: alternatives.length > 0
                ? `Command '${baseCmd}' not found (Windows error 9009). Try alternatives: ${alternatives.join(', ')}`
                : `Command '${baseCmd}' not found (Windows error 9009). Install it or check system PATH.`,
            alternatives
        };
    }

    // Command not found
    if (lowerStderr.includes('command not found') || lowerStderr.includes('is not recognized')) {
        const cmdMatch = stderr.match(/['"]?(\S+)['"]?:?\s*(?:command not found|is not recognized)/i);
        const failedCmd = cmdMatch?.[1] || command?.trim().split(/\s+/)[0];
        const cmdAlts = failedCmd ? getAlternativeCommands(failedCmd) : alternatives;
        return {
            type: 'not_found',
            suggestion: cmdAlts.length > 0
                ? `Command '${failedCmd}' not found. Try alternatives: ${cmdAlts.join(', ')}`
                : `Command '${failedCmd || 'unknown'}' not found. Install it or check if it's in PATH.`,
            alternatives: cmdAlts
        };
    }

    // Permission denied
    if (lowerStderr.includes('permission denied') || lowerStderr.includes('access denied')) {
        return {
            type: 'permission',
            suggestion: 'Permission denied. Check file/directory permissions or run with appropriate privileges.'
        };
    }

    // File/directory not found
    if (lowerStderr.includes('no such file or directory') || lowerStderr.includes('cannot find')) {
        return {
            type: 'not_found',
            suggestion: 'File or directory not found. Check the path and ensure it exists.'
        };
    }

    // Syntax errors
    if (lowerStderr.includes('syntax error') || lowerStderr.includes('unexpected token')) {
        return {
            type: 'syntax',
            suggestion: 'Syntax error in command. Check command syntax and quoting.'
        };
    }

    // Module/dependency errors (npm, pip, etc.)
    if (lowerStderr.includes('module not found') || lowerStderr.includes('cannot find module') ||
        lowerStderr.includes('no module named') || lowerStderr.includes('package not found')) {
        return {
            type: 'dependency',
            suggestion: 'Missing dependency. Install the required package first.'
        };
    }

    // Network errors
    if (lowerStderr.includes('network') || lowerStderr.includes('connection refused') ||
        lowerStderr.includes('enotfound') || lowerStderr.includes('etimedout')) {
        return {
            type: 'runtime',
            suggestion: 'Network error. Check your internet connection or the target URL.'
        };
    }

    return null;
}

function normalizeCommand(command: string): string {
    return command.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeBaseCommand(command: string): string {
    return extractBaseCommand(command).replace(/\.exe$/i, '');
}

function isPowerShellSafeIdentifier(value: string): boolean {
    return /^[a-zA-Z0-9_.-]+$/.test(value);
}

function truncateForReport(value: string, maxLength = 4000): string {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength)}\n...[truncated]`;
}

function getCommandLearningSystemContext(): CommandLearningSystemContext {
    const platform = getCurrentPlatform();
    const rawShell = process.platform === 'win32'
        ? 'PowerShell/cmd'
        : (process.env.SHELL || '/bin/sh');

    const recommendedHelpCommands = platform === 'windows'
        ? ['system_status', '<command> /?', 'help <command>', 'Get-Help <command> -Full', 'command_preflight']
        : ['system_status', '<command> --help', 'man <command>', 'command_preflight'];

    return {
        platform: os.platform(),
        platformName: platform,
        osType: os.type(),
        osRelease: os.release(),
        arch: os.arch(),
        shell: rawShell,
        shellFamily: platform === 'windows' ? 'powershell-cmd' : 'posix',
        recommendedHelpCommands,
        learningSequence: ['system_status', 'command_help', 'command_preflight', 'run_command'],
    };
}

function findPlatformCommandKnowledge(baseCommand: string, platform = getCurrentPlatform()): PlatformCommandKnowledge | undefined {
    return PLATFORM_COMMAND_KNOWLEDGE.find((entry) =>
        entry.baseCommand === baseCommand && entry.platforms.includes(platform)
    );
}

function tokenizeCommandLine(command: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let escaping = false;

    for (let index = 0; index < command.length; index += 1) {
        const char = command[index];

        if (escaping) {
            current += char;
            escaping = false;
            continue;
        }

        if (quote) {
            if (char === '\\' && quote === '"') {
                const nextChar = command[index + 1];
                if (nextChar === '"' || nextChar === '\\') {
                    escaping = true;
                    continue;
                }
            }
            if (char === quote) {
                quote = null;
            } else {
                current += char;
            }
            continue;
        }

        if (char === '\\') {
            current += char;
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }

        if (/\s/.test(char)) {
            if (current) {
                tokens.push(current);
                current = '';
            }
            continue;
        }

        current += char;
    }

    if (escaping) {
        current += '\\';
    }

    if (quote) {
        throw new Error('Unterminated quote in command line.');
    }

    if (current) {
        tokens.push(current);
    }

    return tokens;
}

function containsShellControlOperators(command: string): boolean {
    return /&&|\|\||[|><;`]|[$][(]|\r|\n/.test(command);
}

function isOpaqueShellWrapperCommand(command: string): boolean {
    return /^(powershell|pwsh|cmd|bash|zsh|sh)(\.exe)?\b/i.test(command.trim()) &&
        /(^|\s)(-command|-c|\/c)(\s|$)/i.test(command);
}

function cleanupExpiredPreflightApprovals(): void {
    const now = Date.now();
    for (const [token, approval] of commandPreflightApprovals.entries()) {
        if (approval.expiresAt <= now) {
            commandPreflightApprovals.delete(token);
        }
    }
    for (const [cacheKey, cached] of commandPreflightCache.entries()) {
        if (cached.expiresAt <= now || !commandPreflightApprovals.has(cached.token)) {
            commandPreflightCache.delete(cacheKey);
        }
    }
    for (const [reviewKey, review] of commandPreflightReviews.entries()) {
        if (review.expiresAt <= now) {
            commandPreflightReviews.delete(reviewKey);
        }
    }
}

export function setCommandApprovalRequester(requester: CommandApprovalRequester | null): void {
    commandApprovalRequester = requester;
}

function issuePreflightToken(command: string): string {
    cleanupExpiredPreflightApprovals();
    const token = `preflight_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    commandPreflightApprovals.set(token, {
        normalizedCommand: normalizeCommand(command),
        expiresAt: Date.now() + COMMAND_PREFLIGHT_TTL_MS,
    });
    return token;
}

function getCommandPreflightCacheKey(taskId: string | undefined, command: string): string | null {
    if (!taskId) {
        return null;
    }
    return `${taskId}::${normalizeCommand(command)}`;
}

function markCommandReviewedInTask(taskId: string | undefined, command: string): void {
    const cacheKey = getCommandPreflightCacheKey(taskId, command);
    if (!cacheKey) {
        return;
    }
    commandPreflightReviews.set(cacheKey, {
        expiresAt: Date.now() + COMMAND_PREFLIGHT_TTL_MS,
    });
}

function hasCommandBeenReviewedInTask(taskId: string | undefined, command: string): boolean {
    cleanupExpiredPreflightApprovals();
    const cacheKey = getCommandPreflightCacheKey(taskId, command);
    if (!cacheKey) {
        return false;
    }
    return commandPreflightReviews.has(cacheKey);
}

function validatePreflightToken(command: string, token?: string): boolean {
    cleanupExpiredPreflightApprovals();
    if (!token) {
        return false;
    }
    const approval = commandPreflightApprovals.get(token);
    if (!approval) {
        return false;
    }
    if (approval.normalizedCommand !== normalizeCommand(command)) {
        return false;
    }
    commandPreflightApprovals.delete(token);
    return true;
}

function normalizeAllowlistEntries(entries?: string[] | null): string[] {
    return (entries ?? []).map((entry) => entry.toLowerCase().replace(/\.exe$/i, ''));
}

function isCommandAllowedByScope(baseCommand: string, scope?: EffectScope): boolean {
    const allowlist = normalizeAllowlistEntries(scope?.commandAllowlist);
    if (allowlist.length === 0) {
        return true;
    }
    return allowlist.includes(baseCommand.toLowerCase());
}

function inferShellEffectType(command: string): EffectType {
    const normalized = command.trim().toLowerCase();
    const baseCommand = normalizeBaseCommand(command);
    const tokens = tokenizeCommandLine(command).map((token) => token.toLowerCase());
    const secondToken = tokens[1];

    const readOnlyCommands = new Set([
        'ls', 'dir', 'pwd', 'cat', 'type', 'more', 'head', 'tail',
        'rg', 'grep', 'findstr', 'which', 'where', 'whoami', 'id',
        'echo', 'printenv', 'env', 'uname', 'ver', 'ipconfig',
        'journalctl', 'ss', 'ps', 'tasklist', 'wevtutil',
    ]);

    if (containsShellControlOperators(command)) {
        return 'shell:write';
    }

    if (readOnlyCommands.has(baseCommand)) {
        return 'shell:read';
    }

    if (baseCommand === 'git') {
        const readOnlyGitSubcommands = new Set(['status', 'log', 'diff', 'show', 'branch', 'rev-parse']);
        return secondToken && readOnlyGitSubcommands.has(secondToken) ? 'shell:read' : 'shell:write';
    }

    if (baseCommand === 'schtasks') {
        return normalized.includes('/query') ? 'shell:read' : 'shell:write';
    }

    if (baseCommand === 'sc') {
        return secondToken === 'query' || secondToken === 'qc' ? 'shell:read' : 'shell:write';
    }

    if (baseCommand === 'systemctl') {
        const readOnlySystemctlSubcommands = new Set(['status', 'list-units', 'list-timers', 'show', 'cat']);
        return secondToken && readOnlySystemctlSubcommands.has(secondToken) ? 'shell:read' : 'shell:write';
    }

    if (baseCommand === 'netsh') {
        return secondToken === 'show' ? 'shell:read' : 'shell:write';
    }

    if (baseCommand === 'reg') {
        return secondToken === 'query' ? 'shell:read' : 'shell:write';
    }

    return 'shell:write';
}

function buildCommandEffectRequest(
    command: string,
    cwd: string,
    timeoutMs: number,
    taskId: string,
    effectType: EffectType,
    reasoning: string
): EffectRequest {
    const baseCommand = normalizeBaseCommand(command);
    return {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        effectType,
        source: 'agent',
        payload: {
            command,
            cwd,
            args: tokenizeCommandLine(command).slice(1),
            description: `run_command approval for ${baseCommand}`,
        },
        context: {
            taskId,
            toolName: 'run_command',
            reasoning,
        },
        scope: {
            commandAllowlist: [baseCommand],
            workspacePaths: [cwd],
            timeoutMs,
        },
    };
}

function getCommandPreflightRequirement(command: string): CommandPreflightRequirement {
    const normalizedCommand = command.trim();
    const safetyCheck = checkCommand(normalizedCommand);
    const baseCommand = normalizeBaseCommand(normalizedCommand);
    const commandKnowledge = findPlatformCommandKnowledge(baseCommand);

    if (['medium', 'high', 'critical'].includes(safetyCheck.riskLevel)) {
        return {
            required: true,
            reason: safetyCheck.reason || 'This command has elevated risk.',
            category: 'high_risk',
        };
    }

    if (isOpaqueShellWrapperCommand(normalizedCommand)) {
        return {
            required: true,
            reason: 'This command is invoking a shell interpreter with an inline command string. Learn and validate it before execution.',
            category: 'platform_sensitive',
        };
    }

    if (commandKnowledge) {
        return {
            required: true,
            reason: commandKnowledge.reason,
            category: 'platform_sensitive',
        };
    }

    if (/(^|\s)(--force|-f|\/f|\/force)(\s|$)/i.test(normalizedCommand)) {
        return {
            required: true,
            reason: 'Forceful flags were detected. Verify the command syntax before execution.',
            category: 'forceful',
        };
    }

    return { required: false };
}

async function runCapturedCommand(command: string, cwd: string, timeoutMs = 10000): Promise<CapturedCommandResult> {
    return new Promise((resolve) => {
        const child = spawn(command, {
            shell: true,
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        const finish = (result: CapturedCommandResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };

        const timer = setTimeout(() => {
            child.kill();
            finish({
                command,
                exit_code: -1,
                stdout: stdout.trim(),
                stderr: `${stderr.trim()}\n[timeout]`.trim(),
            });
        }, timeoutMs);

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });

        child.on('close', (code) => {
            finish({
                command,
                exit_code: code ?? 0,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
            });
        });

        child.on('error', (error) => {
            finish({
                command,
                exit_code: -1,
                stdout: stdout.trim(),
                stderr: `${stderr}\n${error.message}`.trim(),
            });
        });
    });
}

async function inspectCommandResolution(baseCommand: string, cwd: string): Promise<{ exists: boolean; paths: string[]; detail?: string }> {
    const platform = getCurrentPlatform();

    if (platform === 'windows') {
        const whereResult = await runCapturedCommand(`where.exe ${baseCommand}`, cwd, 8000);
        const paths = whereResult.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

        if (paths.length > 0) {
            return { exists: true, paths };
        }

        if (isPowerShellSafeIdentifier(baseCommand)) {
            const getCommand = await runCapturedCommand(
                `powershell -NoProfile -Command "$c = Get-Command '${baseCommand}' -ErrorAction SilentlyContinue; if ($c) { $c | Select-Object Name,CommandType,Source | ConvertTo-Json -Compress }"`,
                cwd,
                8000
            );
            if (getCommand.stdout.trim()) {
                return {
                    exists: true,
                    paths: [],
                    detail: getCommand.stdout.trim(),
                };
            }
        }

        return {
            exists: false,
            paths: [],
            detail: truncateForReport(whereResult.stderr || whereResult.stdout, 1200),
        };
    }

    const resolution = await runCapturedCommand(`command -v ${baseCommand}`, cwd, 8000);
    const pathValue = resolution.stdout.trim();
    return {
        exists: resolution.exit_code === 0 && Boolean(pathValue),
        paths: pathValue ? [pathValue] : [],
        detail: resolution.stderr ? truncateForReport(resolution.stderr, 1200) : undefined,
    };
}

async function collectCommandHelp(baseCommand: string, cwd: string): Promise<CommandHelpReport> {
    const platform = getCurrentPlatform();
    const attemptedCommands: string[] = [];
    const candidates: string[] = [];

    if (platform === 'windows') {
        candidates.push(`cmd /d /c "${baseCommand} /?"`);
        if (isPowerShellSafeIdentifier(baseCommand)) {
            candidates.push(`powershell -NoProfile -Command "Get-Help ${baseCommand} -Full | Out-String -Width 200"`);
        }
        candidates.push(`cmd /d /c "help ${baseCommand}"`);
    } else {
        candidates.push(`${baseCommand} --help`);
        candidates.push(`man ${baseCommand} | col -b | head -n 120`);
    }

    for (const candidate of candidates) {
        attemptedCommands.push(candidate);
        const result = await runCapturedCommand(candidate, cwd, 12000);
        const output = result.stdout || result.stderr;
        if (output.trim()) {
            return {
                success: result.exit_code === 0 || Boolean(result.stdout.trim()),
                baseCommand,
                attemptedCommands,
                selectedCommand: candidate,
                outputSnippet: truncateForReport(output),
                stderrSnippet: result.stderr ? truncateForReport(result.stderr, 1500) : undefined,
            };
        }
    }

    return {
        success: false,
        baseCommand,
        attemptedCommands,
        stderrSnippet: 'No help output was returned by platform help commands.',
    };
}

async function buildCommandPreflightReport(command: string, cwd: string, taskId?: string): Promise<CommandPreflightReport> {
    const baseCommand = normalizeBaseCommand(command);
    const requirement = getCommandPreflightRequirement(command);
    const safetyCheck = checkCommand(command);
    const commandKnowledge = findPlatformCommandKnowledge(baseCommand);
    const cacheKey = getCommandPreflightCacheKey(taskId, command);

    cleanupExpiredPreflightApprovals();
    if (cacheKey) {
        const cached = commandPreflightCache.get(cacheKey);
        if (cached && commandPreflightApprovals.has(cached.token)) {
            return {
                ...cached.report,
                alreadyPreflightedInTask: true,
                nextStep: 'You already completed command_preflight for this exact command in the current task. Do not call command_preflight again. Call run_command now with the same command and this preflight_token so host approval can proceed.',
            };
        }
    }

    const resolution = await inspectCommandResolution(baseCommand, cwd);
    const help = await collectCommandHelp(baseCommand, cwd);
    const preflightToken = requirement.required && resolution.exists ? issuePreflightToken(command) : undefined;
    const report: CommandPreflightReport = {
        command,
        baseCommand,
        platform: getCurrentPlatform(),
        riskLevel: safetyCheck.riskLevel,
        requirement,
        commandExists: resolution.exists,
        resolution,
        commandKnowledge,
        alternatives: getAlternativeCommands(baseCommand),
        help,
        preflightToken,
        nextStep: requirement.required
            ? (
                preflightToken
                    ? 'Review the help output, confirm the syntax/flags are correct, then call run_command again with the same command and this preflight_token.'
                    : 'Review the help output first. If the command is unavailable, choose one of the alternatives instead of executing blindly.'
            )
            : 'Command looks eligible for execution. If you are still unsure about flags or side effects, review help output before running it.',
    };

    if (cacheKey && preflightToken) {
        commandPreflightCache.set(cacheKey, {
            token: preflightToken,
            expiresAt: Date.now() + COMMAND_PREFLIGHT_TTL_MS,
            report,
        });
    }
    if (cacheKey) {
        markCommandReviewedInTask(taskId, command);
    }

    return report;
}

async function buildDirectExecutionPlan(command: string, cwd: string): Promise<DirectExecutionPlan | null> {
    const tokens = tokenizeCommandLine(command);
    if (tokens.length === 0) {
        return null;
    }

    const resolution = await inspectCommandResolution(normalizeBaseCommand(command), cwd);
    const executable = resolution.paths[0];
    if (!executable) {
        return null;
    }

    return {
        executable,
        args: tokens.slice(1),
    };
}

function getWindowsShutdownToolSuggestion(command: string): { tool: string; reason: string } | null {
    if (process.platform !== 'win32') {
        return null;
    }

    const normalized = command.trim().toLowerCase();
    if (!/^shutdown(\.exe)?\b/.test(normalized)) {
        return null;
    }

    if (/\s\/a\b/.test(normalized)) {
        return {
            tool: 'system_shutdown_cancel',
            reason: 'Use the dedicated shutdown cancellation tool instead of run_command.',
        };
    }

    if (/\s\/s\b/.test(normalized) || /\s\/r\b/.test(normalized)) {
        return {
            tool: 'system_shutdown_schedule',
            reason: 'Use the dedicated shutdown scheduling tool instead of run_command.',
        };
    }

    return {
        tool: 'system_shutdown_status',
        reason: 'Use the dedicated shutdown status tool instead of run_command.',
    };
}

// ============================================================================
// File System Tools
// ============================================================================

/**
 * List directory contents
 */
const listDir: ToolDefinition = {
    name: 'list_dir',
    description: 'List files and directories in the given path. The path must be relative to the workspace root or absolute.',
    effects: ['filesystem:read'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'The directory path to list. If omitted, lists the workspace root.',
            },
        },
    },
    handler: async (args: { path?: string }, context) => {
        const targetPath = args.path
            ? path.resolve(context.workspacePath, args.path)
            : context.workspacePath;

        try {
            const entires = await fs.promises.readdir(targetPath, { withFileTypes: true });
            const result = entires.map((entry) => ({
                name: entry.name,
                isDir: entry.isDirectory(),
                size: entry.isFile() ? fs.statSync(path.join(targetPath, entry.name)).size : undefined,
            }));
            return result;
        } catch (error: any) {
            return { error: `Failed to list directory: ${error.message}` };
        }
    },
};

/**
 * View file content
 */
const viewFile: ToolDefinition = {
    name: 'view_file',
    description: 'Read the contents of a file. Supports reading specific line ranges.',
    effects: ['filesystem:read'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'The path to the file to read.',
            },
            start_line: {
                type: 'integer',
                description: 'The line number to start reading from (1-indexed).',
            },
            end_line: {
                type: 'integer',
                description: 'The line number to stop reading at (inclusive).',
            },
        },
        required: ['path'],
    },
    handler: async (args: { path: string; start_line?: number; end_line?: number }, context) => {
        const targetPath = path.resolve(context.workspacePath, args.path);
        try {
            const content = await fs.promises.readFile(targetPath, 'utf-8');

            if (args.start_line === undefined && args.end_line === undefined) {
                return content;
            }

            const lines = content.split('\n');
            const start = (args.start_line || 1) - 1;
            const end = args.end_line || lines.length;

            return lines.slice(start, end).join('\n');
        } catch (error: any) {
            return { error: `Failed to read file: ${error.message}` };
        }
    },
};

/**
 * Write to file (Create or Overwrite)
 */
const writeToFile: ToolDefinition = {
    name: 'write_to_file',
    description: 'Write content to a file. Creates the file if it does not exist, overwrites it if it does. Supports creating intermediate directories.',
    effects: ['filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'The path to the file to write to.',
            },
            content: {
                type: 'string',
                description: 'The content to write.',
            },
        },
        required: ['path', 'content'],
    },
    handler: async (args: { path: string; content: string }, context) => {
        const targetPath = path.resolve(context.workspacePath, args.path);
        try {
            await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.promises.writeFile(targetPath, args.content, 'utf-8');
            return { success: true, path: targetPath, size: args.content.length };
        } catch (error: any) {
            return { error: `Failed to write file: ${error.message}` };
        }
    },
};

/**
 * Replace file content (Patch)
 * Note: A simple string replacement for now. `replace_file_content` often implies a more smart block replacement in some agent contexts,
 * but here we implement strict string replacement or full overwrite if needed.
 * For "Apply Patch" functionalities, we usually rely on `apply_patch` specialized command, but let's
 * provide a simple text replacement tool as per agent-tools spec.
 */
const replaceFileContent: ToolDefinition = {
    name: 'replace_file_content',
    description: 'Replace a specific block of text in a file with new content.',
    effects: ['filesystem:read', 'filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'The path to the file to modify.',
            },
            target_content: {
                type: 'string',
                description: 'The exact string to look for and replace.',
            },
            replacement_content: {
                type: 'string',
                description: 'The new content to insert in place of target_content.',
            },
        },
        required: ['path', 'target_content', 'replacement_content'],
    },
    handler: async (args: { path: string; target_content: string; replacement_content: string }, context) => {
        const targetPath = path.resolve(context.workspacePath, args.path);
        try {
            const content = await fs.promises.readFile(targetPath, 'utf-8');
            if (!content.includes(args.target_content)) {
                return { error: 'Target content not found in file.' };
            }
            const newContent = content.replace(args.target_content, args.replacement_content);
            await fs.promises.writeFile(targetPath, newContent, 'utf-8');
            return { success: true, path: targetPath };
        } catch (error: any) {
            return { error: `Failed to replace content: ${error.message}` };
        }
    },
};


// ============================================================================
// Command Tools
// ============================================================================

/**
 * Run Command
 */
const commandHelp: ToolDefinition = {
    name: 'command_help',
    description: 'Read-only command learning tool. Use this BEFORE executing a platform-specific or high-risk CLI command when you are unsure about syntax, flags, or platform differences. It retrieves local help output (`command /?`, `help`, `Get-Help`, `--help`, `man`) without executing the target action.',
    effects: ['process:spawn'],
    input_schema: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'The command name or full command line you want to learn before executing, for example `shutdown /s /t 600` or `systemctl restart nginx`.',
            },
            cwd: {
                type: 'string',
                description: 'Optional working directory for help discovery.',
            },
        },
        required: ['command'],
    },
    handler: async (args: { command: string; cwd?: string }, context) => {
        const cwd = args.cwd
            ? path.resolve(context.workspacePath, args.cwd)
            : context.workspacePath;
        const baseCommand = normalizeBaseCommand(args.command);
        const resolution = await inspectCommandResolution(baseCommand, cwd);
        const help = await collectCommandHelp(baseCommand, cwd);
        const commandKnowledge = findPlatformCommandKnowledge(baseCommand);
        return {
            command: args.command,
            baseCommand,
            platform: getCurrentPlatform(),
            systemContext: getCommandLearningSystemContext(),
            commandExists: resolution.exists,
            resolution,
            commandKnowledge,
            alternatives: getAlternativeCommands(baseCommand),
            help,
            nextStep: 'If the OS or shell context is unclear, call system_status first. Then use this help output to verify the platform-specific syntax and flags before running run_command.',
        };
    },
};

const commandPreflight: ToolDefinition = {
    name: 'command_preflight',
    description: 'Mandatory pre-execution learning and validation for uncertain, high-risk, or platform-sensitive CLI commands. It checks command availability, resolves the local binary/cmdlet, reads local help output, and returns a short-lived preflight_token that must be passed back into run_command for protected commands. Do not call command_preflight repeatedly for the exact same command in the same task once you already have a valid preflight_token.',
    effects: ['process:spawn'],
    input_schema: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'The exact command line you plan to execute.',
            },
            cwd: {
                type: 'string',
                description: 'Optional working directory for resolution/help discovery.',
            },
        },
        required: ['command'],
    },
    handler: async (args: { command: string; cwd?: string }, context) => {
        const cwd = args.cwd
            ? path.resolve(context.workspacePath, args.cwd)
            : context.workspacePath;
        const report = await buildCommandPreflightReport(args.command, cwd, context.taskId);
        return {
            ...report,
            systemContext: getCommandLearningSystemContext(),
            learningPath: {
                recommendedFirstStep: 'Call system_status if you need to confirm the active OS, shell family, or host environment before interpreting command help.',
                sequence: ['system_status', 'command_help', 'command_preflight', 'run_command'],
            },
            approvalModel: {
                hostEnforced: true,
                modes: ['once', 'session', 'permanent'],
                note: 'Protected commands require both local preflight review and host approval before execution.',
            },
        };
    },
};

const runCommand: ToolDefinition = {
    name: 'run_command',
    description: 'Execute a shell command in the context of the workspace. For high-risk or platform-sensitive system commands, you must first call command_preflight, review the local help output, and then pass the returned preflight_token back into run_command.',
    effects: ['process:spawn', 'code:execute'],
    input_schema: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'The command line to execute.',
            },
            cwd: {
                type: 'string',
                description: 'The directory to execute the command in (relative to workspace root).',
            },
            timeout_ms: {
                type: 'integer',
                description: 'Timeout in milliseconds (default: 30000).',
            },
            preflight_token: {
                type: 'string',
                description: 'Required for high-risk or platform-sensitive commands. Obtain it from command_preflight after reviewing the local help output.',
            }
        },
        required: ['command'],
    },
    handler: async (args: { command: string; cwd?: string; timeout_ms?: number; preflight_token?: string }, context) => {
        const shutdownToolSuggestion = getWindowsShutdownToolSuggestion(args.command);
        if (shutdownToolSuggestion) {
            return {
                error: shutdownToolSuggestion.reason,
                error_type: 'use_dedicated_tool',
                suggested_tool: shutdownToolSuggestion.tool,
                command: args.command,
            };
        }

        // Command sandbox: check for dangerous patterns before execution
        const safetyCheck = checkCommand(args.command);
        const cwd = args.cwd
            ? path.resolve(context.workspacePath, args.cwd)
            : context.workspacePath;
        const preflightRequirement = getCommandPreflightRequirement(args.command);

        const hasReviewedCommand = hasCommandBeenReviewedInTask(context.taskId, args.command);
        if (preflightRequirement.required && !validatePreflightToken(args.command, args.preflight_token) && !hasReviewedCommand) {
            const preflight = await buildCommandPreflightReport(args.command, cwd, context.taskId);
            return {
                error: 'preflight_required',
                error_type: 'preflight_required',
                reason: preflightRequirement.reason,
                requirement_category: preflightRequirement.category,
                suggested_tool: 'command_preflight',
                command: args.command,
                preflight,
                next_step: preflight.alreadyPreflightedInTask
                    ? 'You already completed command_preflight for this exact command in the current task. Call run_command again with the same command and the returned preflight_token.'
                    : 'Review the discovered help output, then retry run_command with the same command and the returned preflight_token.',
            };
        }

        let directExecutionPlan: DirectExecutionPlan | null = null;
        if (preflightRequirement.required) {
            if (containsShellControlOperators(args.command)) {
                return {
                    command: args.command,
                    error: 'Protected commands cannot include shell control operators, pipes, or redirection.',
                    error_type: 'unsafe_shell_compound',
                    suggested_fix: 'Run a single command only. If you need multiple steps, split them into separate calls or use a script/tool purpose-built for that workflow.',
                };
            }

            try {
                directExecutionPlan = await buildDirectExecutionPlan(args.command, cwd);
            } catch (error: any) {
                return {
                    command: args.command,
                    error: error?.message || 'Failed to parse command line for direct execution.',
                    error_type: 'direct_execution_parse_failed',
                    suggested_fix: 'Fix command quoting, then run command_preflight again and retry with the exact same command.',
                };
            }

            if (!directExecutionPlan) {
                return {
                    command: args.command,
                    error: 'Protected command could not be mapped to a concrete local executable.',
                    error_type: 'direct_execution_unavailable',
                    suggested_fix: 'Use a direct executable command, or prefer a dedicated tool instead of shell aliases/cmdlets for this action.',
                };
            }
        }
        
        // BLOCKED commands - never execute, return instructions
        if (!safetyCheck.allowed) {
            return `⛔ COMMAND BLOCKED: ${safetyCheck.reason}\n\nThe command "${args.command}" was blocked because it matches a dangerous pattern (risk: ${safetyCheck.riskLevel}).\n\nIf this command is absolutely necessary, you must execute it manually in your terminal.`;
        }

        // Commands needing user interaction - open in terminal for user input
        if (safetyCheck.needsInteraction) {
            const platform = process.platform;
            
            // Open in system terminal for interactive commands
            // This allows user to enter passwords, confirm actions, etc.
            let terminalCommand: string;
            
            if (platform === 'darwin') {
                // macOS: Open Terminal.app with the command
                terminalCommand = `osascript -e 'tell application "Terminal" to do script "cd '${cwd}' && ${args.command.replace(/'/g, "'\\''")}"'`;
            } else if (platform === 'linux') {
                // Linux: Try common terminal emulators
                terminalCommand = `which gnome-terminal >/dev/null 2>&1 && gnome-terminal -- bash -c "cd '${cwd}' && ${args.command}; exec bash" || which xterm >/dev/null 2>&1 && xterm -e "cd '${cwd}' && ${args.command}" || which konsole >/dev/null 2>&1 && konsole -e "cd '${cwd}' && ${args.command}" || ${args.command}`;
            } else if (platform === 'win32') {
                // Windows: Open cmd window
                terminalCommand = `start cmd /k "cd /d ${cwd} && ${args.command}"`;
            } else {
                terminalCommand = args.command;
            }

            return new Promise((resolve) => {
                const child = spawn(terminalCommand, {
                    shell: true,
                    cwd,
                    stdio: 'ignore',
                    detached: true,  // Detach so terminal stays open
                });

                // Unref the child to allow parent to continue
                child.unref();

                // Return immediately - the terminal window handles the rest
                resolve({
                    command: args.command,
                    status: 'opened_in_terminal',
                    message: `✅ 已在终端中打开命令，请在终端窗口中输入密码或进行操作。`,
                    interaction_hint: safetyCheck.interactionHint,
                    platform: platform,
                    cwd: cwd,
                    instructions: [
                        `1. 终端窗口已打开`,
                        `2. 如果需要密码，请在终端中输入`,
                        `3. 命令执行完成后，终端窗口会保持打开`,
                    ],
                    exit_code: 0,
                });
            });
        }

        let safetyWarning = '';
        if (safetyCheck.riskLevel === 'high' || safetyCheck.riskLevel === 'medium') {
            safetyWarning = `\n⚠️ Safety Warning: ${safetyCheck.reason} (risk: ${safetyCheck.riskLevel})\n`;
        }

        const timeout = args.timeout_ms || 30000;
        const effectType = inferShellEffectType(args.command);
        const effectRequest = buildCommandEffectRequest(
            args.command,
            cwd,
            timeout,
            context.taskId,
            effectType,
            preflightRequirement.required
                ? 'Executing a protected command only after local help/preflight review.'
                : 'Executing a CLI command requested by the user.'
        );

        if (commandApprovalRequester) {
            const approval = await commandApprovalRequester(effectRequest);
            if (!approval.approved) {
                return {
                    command: args.command,
                    error: approval.denialReason || 'Command execution denied by host policy.',
                    error_type: 'effect_denied',
                    denial_code: approval.denialCode,
                    effect_request_id: effectRequest.id,
                    approval_type: approval.approvalType,
                    modified_scope: approval.modifiedScope,
                    suggested_fix: 'Choose allow once/session/permanent in the approval dialog, or revise the command to fit host policy.',
                };
            }

            if (!isCommandAllowedByScope(normalizeBaseCommand(args.command), approval.modifiedScope ?? undefined)) {
                return {
                    command: args.command,
                    error: 'Host policy approved the request but returned a command scope that excludes this command.',
                    error_type: 'scope_violation',
                    effect_request_id: effectRequest.id,
                    approval_type: approval.approvalType,
                    modified_scope: approval.modifiedScope,
                    suggested_fix: 'Request approval for the exact command you want to run, or update the host allowlist.',
                };
            }
        }

        const startTime = Date.now();

        return new Promise((resolve) => {
            const child = directExecutionPlan
                ? spawn(directExecutionPlan.executable, directExecutionPlan.args, {
                    shell: false,
                    cwd,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    windowsHide: true,
                })
                : spawn(args.command, {
                    shell: true,
                    cwd,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            const timer = setTimeout(() => {
                timedOut = true;
                child.kill();
                resolve({
                    command: args.command,
                    error: 'Command timed out',
                    stdout,
                    stderr,
                    exit_code: -1,
                    execution_time_ms: Date.now() - startTime,
                    effect_request_id: effectRequest.id,
                    effect_type: effectType,
                    error_type: 'timeout' as const,
                    suggested_fix: `Increase timeout (current: ${timeout}ms) or optimize the command`,
                    safety_warning: safetyWarning || undefined,
                });
            }, timeout);

            child.stdout.on('data', (data) => { stdout += data.toString(); });
            child.stderr.on('data', (data) => { stderr += data.toString(); });

            child.on('close', (code) => {
                if (timedOut) return;
                clearTimeout(timer);

                const executionTime = Date.now() - startTime;
                const result: Record<string, unknown> = {
                    command: args.command,
                    exit_code: code,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    execution_time_ms: executionTime,
                    effect_request_id: effectRequest.id,
                    effect_type: effectType,
                };

                if (directExecutionPlan) {
                    result.resolved_executable = directExecutionPlan.executable;
                    result.executed_with_shell = false;
                } else {
                    result.executed_with_shell = true;
                }

                // Add error analysis if command failed
                // Note: Also check exit_code even if stderr is empty (e.g., Windows 9009)
                if (code !== 0) {
                    const errorAnalysis = analyzeCommandError(stderr, code ?? undefined, args.command);
                    if (errorAnalysis) {
                        result.error_type = errorAnalysis.type;
                        result.suggested_fix = errorAnalysis.suggestion;
                        if (errorAnalysis.alternatives?.length) {
                            result.alternative_commands = errorAnalysis.alternatives;
                        }
                    }
                }

                // Append safety warning if command matched a risky pattern
                if (safetyWarning) {
                    result.safety_warning = safetyWarning;
                }

                resolve(result);
            });

            child.on('error', (err) => {
                if (timedOut) return;
                clearTimeout(timer);

                const errorAnalysis = analyzeCommandError(err.message, -1, args.command);
                resolve({
                    command: args.command,
                    error: err.message,
                    exit_code: -1,
                    execution_time_ms: Date.now() - startTime,
                    effect_request_id: effectRequest.id,
                    effect_type: effectType,
                    error_type: errorAnalysis?.type || 'unknown',
                    alternative_commands: errorAnalysis?.alternatives,
                    suggested_fix: errorAnalysis?.suggestion || 'Check the command syntax and permissions',
                    resolved_executable: directExecutionPlan?.executable,
                    executed_with_shell: !directExecutionPlan,
                    safety_warning: safetyWarning || undefined,
                });
            });
        });
    },
};

// ============================================================================
// Export
// ============================================================================

export const STANDARD_TOOLS: ToolDefinition[] = [
    listDir,
    viewFile,
    writeToFile,
    replaceFileContent,
    commandHelp,
    commandPreflight,
    runCommand,
];
