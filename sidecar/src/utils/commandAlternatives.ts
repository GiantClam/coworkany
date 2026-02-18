/**
 * Command Alternatives - Cross-Platform Command Mapping
 *
 * Provides intelligent command alternatives when a command fails.
 * Supports Windows, macOS, and Linux with automatic OS detection.
 */

import * as os from 'os';

// ============================================================================
// Types
// ============================================================================

export type Platform = 'windows' | 'macos' | 'linux';

export interface CommandAlternative {
    command: string;
    platform?: Platform | Platform[];  // If undefined, works on all platforms
    note?: string;  // Usage note for the user
}

export interface AlternativeResult {
    alternatives: string[];
    platformSpecific: string[];  // Alternatives specific to current platform
    notes: string[];
}

// ============================================================================
// Command Mappings
// ============================================================================

/**
 * Comprehensive command alternatives mapping.
 * Key: base command name (lowercase)
 * Value: array of alternatives with optional platform restrictions
 */
const COMMAND_ALTERNATIVES: Record<string, CommandAlternative[]> = {
    // ========== Python ==========
    'python3': [
        { command: 'python', note: 'Windows often uses python instead of python3' },
        { command: 'py', platform: 'windows', note: 'Windows Python launcher' },
        { command: 'python3.11', note: 'Specific Python version' },
        { command: 'python3.10' },
        { command: 'python3.9' },
    ],
    'python': [
        { command: 'python3', platform: ['macos', 'linux'], note: 'Unix systems often use python3' },
        { command: 'py', platform: 'windows' },
    ],
    'py': [
        { command: 'python' },
        { command: 'python3' },
    ],
    'pip3': [
        { command: 'pip' },
        { command: 'python -m pip', note: 'More reliable module invocation' },
        { command: 'python3 -m pip' },
        { command: 'py -m pip', platform: 'windows' },
    ],
    'pip': [
        { command: 'pip3' },
        { command: 'python -m pip' },
        { command: 'python3 -m pip' },
    ],

    // ========== Node.js ==========
    'node': [
        { command: 'nodejs', platform: 'linux', note: 'Some Linux distros use nodejs' },
        { command: 'node.exe', platform: 'windows' },
    ],
    'nodejs': [
        { command: 'node' },
    ],
    'npm': [
        { command: 'npm.cmd', platform: 'windows' },
        { command: 'npx npm' },
        { command: 'pnpm', note: 'Alternative package manager' },
        { command: 'yarn', note: 'Alternative package manager' },
    ],
    'npx': [
        { command: 'npx.cmd', platform: 'windows' },
        { command: 'npm exec' },
        { command: 'pnpm dlx' },
        { command: 'yarn dlx' },
    ],
    'pnpm': [
        { command: 'npm' },
        { command: 'yarn' },
    ],
    'yarn': [
        { command: 'npm' },
        { command: 'pnpm' },
    ],
    'bun': [
        { command: 'npm' },
        { command: 'node' },
    ],

    // ========== Version Control ==========
    'git': [
        { command: 'git.exe', platform: 'windows' },
    ],

    // ========== File Operations (Unix -> Windows) ==========
    'ls': [
        { command: 'dir', platform: 'windows', note: 'Windows equivalent' },
        { command: 'Get-ChildItem', platform: 'windows', note: 'PowerShell cmdlet' },
        { command: 'gci', platform: 'windows', note: 'PowerShell alias' },
    ],
    'cat': [
        { command: 'type', platform: 'windows', note: 'Windows equivalent' },
        { command: 'Get-Content', platform: 'windows', note: 'PowerShell cmdlet' },
        { command: 'gc', platform: 'windows', note: 'PowerShell alias' },
    ],
    'head': [
        { command: 'Get-Content -Head', platform: 'windows' },
    ],
    'tail': [
        { command: 'Get-Content -Tail', platform: 'windows' },
    ],
    'rm': [
        { command: 'del', platform: 'windows', note: 'For files' },
        { command: 'rmdir /s /q', platform: 'windows', note: 'For directories' },
        { command: 'Remove-Item', platform: 'windows', note: 'PowerShell cmdlet' },
    ],
    'cp': [
        { command: 'copy', platform: 'windows', note: 'For files' },
        { command: 'xcopy', platform: 'windows', note: 'For directories' },
        { command: 'Copy-Item', platform: 'windows', note: 'PowerShell cmdlet' },
    ],
    'mv': [
        { command: 'move', platform: 'windows' },
        { command: 'Move-Item', platform: 'windows', note: 'PowerShell cmdlet' },
    ],
    'mkdir': [
        { command: 'md', platform: 'windows' },
        { command: 'New-Item -ItemType Directory', platform: 'windows' },
    ],
    'rmdir': [
        { command: 'rd', platform: 'windows' },
        { command: 'Remove-Item -Recurse', platform: 'windows' },
    ],
    'touch': [
        { command: 'New-Item -ItemType File', platform: 'windows' },
        { command: 'echo. >', platform: 'windows', note: 'Create empty file' },
    ],
    'chmod': [
        { command: 'icacls', platform: 'windows', note: 'Windows permission tool' },
        { command: 'attrib', platform: 'windows', note: 'Change file attributes' },
    ],
    'chown': [
        { command: 'icacls', platform: 'windows' },
    ],
    'ln': [
        { command: 'mklink', platform: 'windows', note: 'Create symbolic link' },
        { command: 'New-Item -ItemType SymbolicLink', platform: 'windows' },
    ],

    // ========== File Operations (Windows -> Unix) ==========
    'dir': [
        { command: 'ls', platform: ['macos', 'linux'] },
    ],
    'type': [
        { command: 'cat', platform: ['macos', 'linux'] },
    ],
    'del': [
        { command: 'rm', platform: ['macos', 'linux'] },
    ],
    'copy': [
        { command: 'cp', platform: ['macos', 'linux'] },
    ],
    'move': [
        { command: 'mv', platform: ['macos', 'linux'] },
    ],
    'md': [
        { command: 'mkdir', platform: ['macos', 'linux'] },
    ],
    'rd': [
        { command: 'rmdir', platform: ['macos', 'linux'] },
        { command: 'rm -r', platform: ['macos', 'linux'] },
    ],

    // ========== Search & Text Processing ==========
    'grep': [
        { command: 'findstr', platform: 'windows', note: 'Basic pattern matching' },
        { command: 'Select-String', platform: 'windows', note: 'PowerShell grep equivalent' },
        { command: 'sls', platform: 'windows', note: 'PowerShell alias' },
        { command: 'rg', note: 'ripgrep - faster alternative' },
    ],
    'findstr': [
        { command: 'grep', platform: ['macos', 'linux'] },
        { command: 'Select-String', platform: 'windows' },
    ],
    'find': [
        { command: 'where', platform: 'windows', note: 'Find executables' },
        { command: 'Get-ChildItem -Recurse', platform: 'windows' },
        { command: 'fd', note: 'Faster alternative to find' },
    ],
    'which': [
        { command: 'where', platform: 'windows' },
        { command: 'Get-Command', platform: 'windows', note: 'PowerShell cmdlet' },
        { command: 'gcm', platform: 'windows', note: 'PowerShell alias' },
    ],
    'where': [
        { command: 'which', platform: ['macos', 'linux'] },
        { command: 'whereis', platform: ['macos', 'linux'] },
    ],
    'sed': [
        { command: 'powershell -c "(Get-Content file) -replace"', platform: 'windows' },
    ],
    'awk': [
        { command: 'powershell -c "... | ForEach-Object"', platform: 'windows' },
    ],

    // ========== Network ==========
    'curl': [
        { command: 'curl.exe', platform: 'windows' },
        { command: 'Invoke-WebRequest', platform: 'windows', note: 'PowerShell cmdlet' },
        { command: 'iwr', platform: 'windows', note: 'PowerShell alias' },
        { command: 'wget' },
        { command: 'http', note: 'HTTPie - user-friendly curl alternative' },
    ],
    'wget': [
        { command: 'curl -O' },
        { command: 'Invoke-WebRequest -OutFile', platform: 'windows' },
    ],
    'ping': [
        { command: 'Test-Connection', platform: 'windows', note: 'PowerShell cmdlet' },
    ],
    'ifconfig': [
        { command: 'ipconfig', platform: 'windows' },
        { command: 'ip addr', platform: 'linux', note: 'Modern replacement' },
    ],
    'ipconfig': [
        { command: 'ifconfig', platform: ['macos', 'linux'] },
        { command: 'ip addr', platform: 'linux' },
    ],
    'netstat': [
        { command: 'ss', platform: 'linux', note: 'Modern replacement' },
        { command: 'Get-NetTCPConnection', platform: 'windows' },
    ],

    // ========== Process Management ==========
    'ps': [
        { command: 'tasklist', platform: 'windows' },
        { command: 'Get-Process', platform: 'windows', note: 'PowerShell cmdlet' },
        { command: 'gps', platform: 'windows', note: 'PowerShell alias' },
    ],
    'kill': [
        { command: 'taskkill /PID', platform: 'windows' },
        { command: 'Stop-Process', platform: 'windows', note: 'PowerShell cmdlet' },
    ],
    'tasklist': [
        { command: 'ps', platform: ['macos', 'linux'] },
        { command: 'ps aux', platform: ['macos', 'linux'] },
    ],
    'taskkill': [
        { command: 'kill', platform: ['macos', 'linux'] },
        { command: 'pkill', platform: ['macos', 'linux'] },
    ],
    'top': [
        { command: 'htop', note: 'Better alternative if installed' },
        { command: 'btop', note: 'Modern alternative' },
    ],

    // ========== Environment ==========
    'export': [
        { command: 'set', platform: 'windows', note: 'CMD syntax' },
        { command: '$env:', platform: 'windows', note: 'PowerShell syntax' },
    ],
    'echo': [
        { command: 'Write-Output', platform: 'windows', note: 'PowerShell cmdlet' },
        { command: 'Write-Host', platform: 'windows' },
    ],
    'printenv': [
        { command: 'set', platform: 'windows' },
        { command: 'Get-ChildItem Env:', platform: 'windows' },
        { command: 'env', platform: ['macos', 'linux'] },
    ],

    // ========== Terminal ==========
    'clear': [
        { command: 'cls', platform: 'windows' },
        { command: 'Clear-Host', platform: 'windows' },
    ],
    'cls': [
        { command: 'clear', platform: ['macos', 'linux'] },
    ],

    // ========== Archive ==========
    'tar': [
        { command: 'Expand-Archive', platform: 'windows', note: 'For zip files' },
        { command: '7z', note: '7-Zip command line' },
    ],
    'unzip': [
        { command: 'Expand-Archive', platform: 'windows' },
        { command: 'tar -xf', note: 'Modern tar handles zip' },
        { command: '7z x' },
    ],
    'gzip': [
        { command: '7z', platform: 'windows' },
    ],

    // ========== Misc ==========
    'man': [
        { command: 'Get-Help', platform: 'windows', note: 'PowerShell help' },
        { command: '--help', note: 'Most commands support --help flag' },
    ],
    'sudo': [
        { command: 'runas /user:Administrator', platform: 'windows' },
        { command: 'Start-Process -Verb RunAs', platform: 'windows', note: 'PowerShell elevation' },
    ],
    'open': [
        { command: 'start', platform: 'windows' },
        { command: 'explorer', platform: 'windows' },
        { command: 'xdg-open', platform: 'linux' },
    ],
    'xdg-open': [
        { command: 'open', platform: 'macos' },
        { command: 'start', platform: 'windows' },
    ],
    'pbcopy': [
        { command: 'clip', platform: 'windows' },
        { command: 'Set-Clipboard', platform: 'windows' },
        { command: 'xclip', platform: 'linux' },
    ],
    'pbpaste': [
        { command: 'Get-Clipboard', platform: 'windows' },
        { command: 'xclip -o', platform: 'linux' },
    ],
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get current platform
 */
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

/**
 * Check if an alternative is valid for a given platform
 */
function isValidForPlatform(alt: CommandAlternative, platform: Platform): boolean {
    if (!alt.platform) return true;  // No platform restriction
    if (Array.isArray(alt.platform)) {
        return alt.platform.includes(platform);
    }
    return alt.platform === platform;
}

/**
 * Extract base command from a full command string
 * e.g., "python3 -c 'print(1)'" -> "python3"
 */
export function extractBaseCommand(command: string): string {
    return command.trim().split(/\s+/)[0].toLowerCase();
}

/**
 * Find alternative commands for a failed command
 */
export function findAlternatives(failedCommand: string, platform?: Platform): AlternativeResult {
    const currentPlatform = platform || getCurrentPlatform();
    const baseCommand = extractBaseCommand(failedCommand);

    const result: AlternativeResult = {
        alternatives: [],
        platformSpecific: [],
        notes: [],
    };

    // Direct lookup
    let alternatives = COMMAND_ALTERNATIVES[baseCommand];

    // Try without trailing numbers (python3 -> python)
    if (!alternatives) {
        const withoutNumber = baseCommand.replace(/\d+(\.\d+)*$/, '');
        if (withoutNumber !== baseCommand) {
            alternatives = COMMAND_ALTERNATIVES[withoutNumber];
        }
    }

    // Try without .exe extension
    if (!alternatives && baseCommand.endsWith('.exe')) {
        const withoutExe = baseCommand.slice(0, -4);
        alternatives = COMMAND_ALTERNATIVES[withoutExe];
    }

    if (!alternatives) {
        return result;
    }

    for (const alt of alternatives) {
        if (isValidForPlatform(alt, currentPlatform)) {
            result.platformSpecific.push(alt.command);
            if (alt.note) {
                result.notes.push(`${alt.command}: ${alt.note}`);
            }
        }
        // Add to general alternatives regardless of platform
        if (!result.alternatives.includes(alt.command)) {
            result.alternatives.push(alt.command);
        }
    }

    return result;
}

/**
 * Get simple list of alternatives (most common use case)
 */
export function getAlternativeCommands(failedCommand: string): string[] {
    const result = findAlternatives(failedCommand);
    // Prefer platform-specific alternatives, fall back to all alternatives
    return result.platformSpecific.length > 0 ? result.platformSpecific : result.alternatives;
}

/**
 * Format alternatives as a user-friendly message
 */
export function formatAlternativesMessage(failedCommand: string): string {
    const result = findAlternatives(failedCommand);
    const platform = getCurrentPlatform();
    const baseCmd = extractBaseCommand(failedCommand);

    if (result.platformSpecific.length === 0) {
        return `Command '${baseCmd}' not found. No known alternatives for ${platform}.`;
    }

    let message = `Command '${baseCmd}' not found on ${platform}. Try these alternatives:\n`;
    result.platformSpecific.forEach((cmd, i) => {
        message += `  ${i + 1}. ${cmd}\n`;
    });

    if (result.notes.length > 0) {
        message += '\nNotes:\n';
        result.notes.forEach(note => {
            message += `  - ${note}\n`;
        });
    }

    return message;
}

/**
 * Check if we have alternatives for a command
 */
export function hasAlternatives(command: string): boolean {
    return getAlternativeCommands(command).length > 0;
}

// ============================================================================
// Export
// ============================================================================

export default {
    findAlternatives,
    getAlternativeCommands,
    formatAlternativesMessage,
    hasAlternatives,
    getCurrentPlatform,
    extractBaseCommand,
};
