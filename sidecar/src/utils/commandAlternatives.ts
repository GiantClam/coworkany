import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
export type Platform = 'windows' | 'macos' | 'linux';
export interface CommandAlternative {
    command: string;
    platform?: Platform | Platform[];
    note?: string;
}
export interface AlternativeResult {
    alternatives: string[];
    platformSpecific: string[];
    notes: string[];
}
export interface CommandRecoveryHints {
    failedCommand: string;
    baseCommand: string;
    platform: Platform;
    alternativeCommands: string[];
    staticAlternatives: string[];
    discoveredCommands: string[];
    probeCommands: string[];
    suggestion: string;
}

const MAX_PATH_DIRS_TO_SCAN = 20;
const MAX_FILES_PER_PATH_DIR = 400;
const MAX_DISCOVERED_COMMANDS = 8;
const WINDOWS_EXECUTABLE_SUFFIX_PATTERN = /\.(exe|cmd|bat|ps1)$/i;
const COMMAND_NOT_FOUND_PATTERN = /\b(command not found|is not recognized|not recognized as an internal or external command)\b/i;
const DISCOVERY_CACHE = new Map<string, string[]>();
const COMMAND_ALTERNATIVES: Record<string, CommandAlternative[]> = {
    python: [{ command: 'python3', platform: ['macos', 'linux'] }, { command: 'py', platform: 'windows' }],
    python3: [{ command: 'python' }, { command: 'py', platform: 'windows' }],
    pip: [{ command: 'pip3' }, { command: 'python -m pip' }],
    pip3: [{ command: 'pip' }, { command: 'python3 -m pip' }],
    npm: [{ command: 'pnpm' }, { command: 'yarn' }],
    pnpm: [{ command: 'npm' }, { command: 'yarn' }],
    yarn: [{ command: 'npm' }, { command: 'pnpm' }],
    nodejs: [{ command: 'node' }],
    ls: [{ command: 'dir', platform: 'windows' }],
    cat: [{ command: 'type', platform: 'windows' }],
    rm: [{ command: 'del', platform: 'windows' }, { command: 'Remove-Item', platform: 'windows' }],
    cp: [{ command: 'copy', platform: 'windows' }],
    mv: [{ command: 'move', platform: 'windows' }],
    grep: [{ command: 'findstr', platform: 'windows' }, { command: 'rg', note: 'ripgrep (faster)' }],
    which: [{ command: 'where', platform: 'windows' }],
    curl: [{ command: 'Invoke-WebRequest', platform: 'windows' }, { command: 'wget' }],
};
export function getCurrentPlatform(): Platform {
    switch (os.platform()) {
        case 'win32':
            return 'windows';
        case 'darwin':
            return 'macos';
        default:
            return 'linux';
    }
}
export function extractBaseCommand(command: string): string {
    return command.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}
function matchesPlatform(platform: Platform, input?: Platform | Platform[]): boolean {
    if (!input) {
        return true;
    }
    return Array.isArray(input) ? input.includes(platform) : input === platform;
}
export function findAlternatives(failedCommand: string, platform = getCurrentPlatform()): AlternativeResult {
    const base = extractBaseCommand(failedCommand).replace(/\.exe$/, '').replace(/\d+(?:\.\d+)*$/, '');
    const candidates = COMMAND_ALTERNATIVES[base] ?? [];
    const alternatives = Array.from(new Set(candidates.map((item) => item.command)));
    const platformSpecific = Array.from(new Set(
        candidates
            .filter((item) => matchesPlatform(platform, item.platform))
            .map((item) => item.command),
    ));
    const notes = candidates
        .filter((item) => matchesPlatform(platform, item.platform) && typeof item.note === 'string')
        .map((item) => `${item.command}: ${item.note}`);
    return {
        alternatives,
        platformSpecific,
        notes,
    };
}
export function getAlternativeCommands(failedCommand: string): string[] {
    const result = findAlternatives(failedCommand);
    return result.platformSpecific.length > 0 ? result.platformSpecific : result.alternatives;
}

function normalizeExecutableName(name: string, platform: Platform): string {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
        return '';
    }
    if (platform === 'windows') {
        return trimmed.replace(WINDOWS_EXECUTABLE_SUFFIX_PATTERN, '').toLowerCase();
    }
    return trimmed.toLowerCase();
}

function scoreDiscoveredCommand(base: string, candidate: string): number {
    if (candidate.length === 0 || base.length === 0 || candidate === base) {
        return 0;
    }
    let score = 0;
    if (candidate.startsWith(base)) {
        score += 8;
    }
    if (base.startsWith(candidate)) {
        score += 3;
    }
    if (candidate.includes(base)) {
        score += 3;
    }
    const basePrefix = base.slice(0, Math.min(base.length, 3));
    if (basePrefix.length >= 2 && candidate.startsWith(basePrefix)) {
        score += 2;
    }
    const baseNoDigits = base.replace(/\d+$/u, '');
    const candidateNoDigits = candidate.replace(/\d+$/u, '');
    if (baseNoDigits.length > 0 && baseNoDigits === candidateNoDigits) {
        score += 2;
    }
    return score;
}

function splitPathEntries(pathValue: string | undefined): string[] {
    if (typeof pathValue !== 'string' || pathValue.trim().length === 0) {
        return [];
    }
    return pathValue
        .split(path.delimiter)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

export function discoverInstalledCommandCandidates(
    failedCommand: string,
    platform = getCurrentPlatform(),
    envPath = process.env.PATH,
): string[] {
    const base = extractBaseCommand(failedCommand)
        .replace(WINDOWS_EXECUTABLE_SUFFIX_PATTERN, '')
        .toLowerCase();
    if (base.length === 0) {
        return [];
    }
    const cacheKey = `${platform}:${base}`;
    const cached = DISCOVERY_CACHE.get(cacheKey);
    if (cached) {
        return [...cached];
    }
    const pathEntries = splitPathEntries(envPath).slice(0, MAX_PATH_DIRS_TO_SCAN);
    const scored = new Map<string, number>();
    for (const dirPath of pathEntries) {
        let entries: string[];
        try {
            entries = fs.readdirSync(dirPath);
        } catch {
            continue;
        }
        for (const rawName of entries.slice(0, MAX_FILES_PER_PATH_DIR)) {
            const normalized = normalizeExecutableName(rawName, platform);
            if (!normalized || normalized === base) {
                continue;
            }
            if (!/^[a-z0-9._+-]+$/i.test(normalized)) {
                continue;
            }
            const score = scoreDiscoveredCommand(base, normalized);
            if (score <= 0) {
                continue;
            }
            const prevScore = scored.get(normalized) ?? 0;
            if (score > prevScore) {
                scored.set(normalized, score);
            }
        }
    }
    const discovered = [...scored.entries()]
        .sort((left, right) => {
            if (right[1] !== left[1]) {
                return right[1] - left[1];
            }
            return left[0].localeCompare(right[0]);
        })
        .map(([name]) => name)
        .slice(0, MAX_DISCOVERED_COMMANDS);
    DISCOVERY_CACHE.set(cacheKey, discovered);
    return [...discovered];
}

function buildShellProbeCommands(baseCommand: string, platform: Platform): string[] {
    const escapedBase = baseCommand.replace(/(["'`\\$])/g, '\\$1');
    if (platform === 'windows') {
        return [
            `Get-Command ${baseCommand}*`,
            `where ${baseCommand}`,
        ];
    }
    return [
        `command -v ${escapedBase}`,
        `which ${escapedBase}`,
        `compgen -c | grep -E '^${escapedBase}' | head -20`,
    ];
}

export function isLikelyCommandNotFoundFailure(input: {
    stderr?: string;
    exitCode?: number;
}): boolean {
    if (input.exitCode === 127 || input.exitCode === 9009) {
        return true;
    }
    const stderr = typeof input.stderr === 'string' ? input.stderr : '';
    if (stderr.length === 0) {
        return false;
    }
    return COMMAND_NOT_FOUND_PATTERN.test(stderr);
}

export function buildCommandRecoveryHints(input: {
    command: string;
    stderr?: string;
    exitCode?: number;
    platform?: Platform;
    envPath?: string;
}): CommandRecoveryHints | null {
    const baseCommand = extractBaseCommand(input.command)
        .replace(WINDOWS_EXECUTABLE_SUFFIX_PATTERN, '');
    if (baseCommand.length === 0) {
        return null;
    }
    if (!isLikelyCommandNotFoundFailure({ stderr: input.stderr, exitCode: input.exitCode })) {
        return null;
    }
    const platform = input.platform ?? getCurrentPlatform();
    const staticAlternatives = getAlternativeCommands(baseCommand);
    const discoveredCommands = discoverInstalledCommandCandidates(
        baseCommand,
        platform,
        input.envPath,
    );
    const alternativeCommands = Array.from(new Set([
        ...staticAlternatives,
        ...discoveredCommands,
    ])).slice(0, MAX_DISCOVERED_COMMANDS);
    const probeCommands = buildShellProbeCommands(baseCommand, platform);
    const suggestion = alternativeCommands.length > 0
        ? `Command '${baseCommand}' was not found. Try alternatives: ${alternativeCommands.join(', ')}`
        : `Command '${baseCommand}' was not found. Probe available commands first, then retry with a platform-compatible executable.`;
    return {
        failedCommand: input.command,
        baseCommand,
        platform,
        alternativeCommands,
        staticAlternatives,
        discoveredCommands,
        probeCommands,
        suggestion,
    };
}
export function formatAlternativesMessage(failedCommand: string): string {
    const platform = getCurrentPlatform();
    const base = extractBaseCommand(failedCommand);
    const alternatives = getAlternativeCommands(failedCommand);
    if (alternatives.length === 0) {
        return `Command '${base}' not found. No known alternatives for ${platform}.`;
    }
    return `Command '${base}' not found on ${platform}. Try: ${alternatives.join(', ')}`;
}
export function hasAlternatives(command: string): boolean {
    return getAlternativeCommands(command).length > 0;
}
export default {
    findAlternatives,
    getAlternativeCommands,
    formatAlternativesMessage,
    hasAlternatives,
    getCurrentPlatform,
    extractBaseCommand,
};
