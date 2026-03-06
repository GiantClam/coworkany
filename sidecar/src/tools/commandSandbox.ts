/**
 * Command Sandbox
 *
 * Intercepts and analyzes shell commands before execution.
 * Categories:
 * - BLOCKED: Commands that should never run (filesystem destruction)
 * - NEEDS_INTERACTION: Commands that need user interaction (sudo, password)
 * - WARNING: Commands that run but with a warning
 */

export interface CommandCheckResult {
    allowed: boolean;
    riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
    reason?: string;
    pattern?: string;
    needsInteraction?: boolean;  // Command needs user input (password, etc.)
    interactionHint?: string;    // Hint for user about what to input
}

/** Dangerous command patterns with risk levels */
const DANGEROUS_PATTERNS: Array<{
    pattern: RegExp;
    riskLevel: 'medium' | 'high' | 'critical';
    reason: string;
    blocked?: boolean;  // If true, never execute
    needsInteraction?: boolean;
    interactionHint?: string;
}> = [
    // Critical BLOCKED: System-destroying commands - NEVER execute
    { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive\s+--force|-[a-zA-Z]*f[a-zA-Z]*r)\s+[\/\\](\s|$)/, riskLevel: 'critical', reason: 'Recursive delete of root filesystem', blocked: true },
    { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive\s+--force)\s+~/, riskLevel: 'critical', reason: 'Recursive delete of home directory', blocked: true },
    { pattern: /\bmkfs\b/, riskLevel: 'critical', reason: 'Filesystem format command', blocked: true },
    { pattern: /\bformat\s+[a-zA-Z]:/, riskLevel: 'critical', reason: 'Disk format command', blocked: true },
    { pattern: /\bdd\s+.*of=\/dev\/[sh]d/, riskLevel: 'critical', reason: 'Direct disk write', blocked: true },

    // High NEEDS_INTERACTION: System commands that require user confirmation/input
    { 
        pattern: /\b(shutdown|reboot|halt|poweroff|init\s+[06])\b/, 
        riskLevel: 'high', 
        reason: 'System shutdown/restart command',
        needsInteraction: true,
        interactionHint: 'This will shut down or restart the computer. Enter admin password if prompted.'
    },
    { 
        pattern: /\b(sudo|doas|su)\b/, 
        riskLevel: 'high', 
        reason: 'Elevated privileges required',
        needsInteraction: true,
        interactionHint: 'Enter your password in the terminal when prompted.'
    },
    { pattern: /\breg\s+(delete|add)\b/i, riskLevel: 'high', reason: 'Windows registry modification', needsInteraction: true },
    { pattern: /\bregedit\b/i, riskLevel: 'high', reason: 'Registry editor', needsInteraction: true },
    { pattern: /\bkill\s+(-9\s+)?1\b/, riskLevel: 'high', reason: 'Kill init/system process', needsInteraction: true },
    { pattern: /\bkillall\b/, riskLevel: 'high', reason: 'Kill all processes by name', needsInteraction: true },
    { pattern: /\bchmod\s+(-R\s+)?777\b/, riskLevel: 'high', reason: 'Overly permissive file permissions', needsInteraction: true },
    { pattern: /\bchown\s+(-R\s+)?root/, riskLevel: 'high', reason: 'Change ownership to root', needsInteraction: true },
    { pattern: /\b(visudo|passwd)\b/, riskLevel: 'high', reason: 'User/permission management', needsInteraction: true },

    // Medium: Potentially dangerous but can run with warning
    { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive\s+--force)/, riskLevel: 'medium', reason: 'Recursive force delete' },
    { pattern: /\brmdir\s+\/[sS]\b/, riskLevel: 'medium', reason: 'Recursive directory removal' },
    { pattern: /\bcurl\s+.*\|\s*(ba)?sh\b/, riskLevel: 'medium', reason: 'Pipe remote script to shell' },
    { pattern: /\bwget\s+.*\|\s*(ba)?sh\b/, riskLevel: 'medium', reason: 'Pipe remote script to shell' },
    { pattern: /\b(iptables|ufw|netsh)\b/, riskLevel: 'medium', reason: 'Network/firewall configuration' },
    { pattern: /\bsetx?\s+/i, riskLevel: 'medium', reason: 'Environment variable modification' },
    { pattern: /\bexport\s+PATH=/, riskLevel: 'medium', reason: 'PATH modification' },
    { pattern: />\s*\/etc\//, riskLevel: 'medium', reason: 'Write to system config directory' },
    { pattern: /\bnpm\s+(-g\s+)?install\s+--unsafe-perm/, riskLevel: 'medium', reason: 'npm install with unsafe permissions' },
    { pattern: /\b(Start-Process|Invoke-Expression|iex)\b/i, riskLevel: 'medium', reason: 'PowerShell code execution' },
];

/**
 * Check a command for dangerous patterns.
 * Returns the result with the highest risk level found.
 */
export function checkCommand(command: string): CommandCheckResult {
    const normalizedCmd = command.trim();

    let worstResult: CommandCheckResult = {
        allowed: true,
        riskLevel: 'safe',
        needsInteraction: false,
    };

    for (const entry of DANGEROUS_PATTERNS) {
        if (entry.pattern.test(normalizedCmd)) {
            const riskOrder = { safe: 0, low: 1, medium: 2, high: 3, critical: 4 };
            if (riskOrder[entry.riskLevel] > riskOrder[worstResult.riskLevel]) {
                worstResult = {
                    // Only block if explicitly marked as blocked (critical destruction commands)
                    allowed: !entry.blocked,
                    riskLevel: entry.riskLevel,
                    reason: entry.reason,
                    pattern: entry.pattern.source,
                    needsInteraction: entry.needsInteraction,
                    interactionHint: entry.interactionHint,
                };
            }
        }
    }

    return worstResult;
}

/**
 * Get all dangerous patterns for display in settings UI.
 */
export function getDangerousPatterns(): Array<{ riskLevel: string; reason: string }> {
    return DANGEROUS_PATTERNS.map((p) => ({
        riskLevel: p.riskLevel,
        reason: p.reason,
    }));
}
