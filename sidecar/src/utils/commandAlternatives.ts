import * as os from 'os';
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
