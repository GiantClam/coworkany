/**
 * Command Sandbox
 *
 * Intercepts and analyzes shell commands before execution.
 * Blocks/warns about dangerous patterns like:
 * - rm -rf / (recursive delete of root)
 * - format/mkfs (disk format)
 * - registry editing (reg delete, regedit)
 * - system shutdown/restart
 * - environment variable deletion
 * - chmod 777 (overly permissive)
 * - kill -9 1 (kill init)
 * - network config changes (iptables, netsh)
 */

export interface CommandCheckResult {
    allowed: boolean;
    riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
    reason?: string;
    pattern?: string;
}

/** Dangerous command patterns with risk levels */
const DANGEROUS_PATTERNS: Array<{
    pattern: RegExp;
    riskLevel: 'medium' | 'high' | 'critical';
    reason: string;
}> = [
    // Critical: System-destroying commands
    { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive\s+--force|-[a-zA-Z]*f[a-zA-Z]*r)\s+[\/\\](\s|$)/, riskLevel: 'critical', reason: 'Recursive delete of root filesystem' },
    { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive\s+--force)\s+~/, riskLevel: 'critical', reason: 'Recursive delete of home directory' },
    { pattern: /\bmkfs\b/, riskLevel: 'critical', reason: 'Filesystem format command' },
    { pattern: /\bformat\s+[a-zA-Z]:/, riskLevel: 'critical', reason: 'Disk format command' },
    { pattern: /\bdd\s+.*of=\/dev\/[sh]d/, riskLevel: 'critical', reason: 'Direct disk write' },

    // High: System modification
    { pattern: /\b(shutdown|reboot|halt|poweroff|init\s+[06])\b/, riskLevel: 'high', reason: 'System shutdown/restart command' },
    { pattern: /\breg\s+(delete|add)\b/i, riskLevel: 'high', reason: 'Windows registry modification' },
    { pattern: /\bregedit\b/i, riskLevel: 'high', reason: 'Registry editor' },
    { pattern: /\bkill\s+(-9\s+)?1\b/, riskLevel: 'high', reason: 'Kill init/system process' },
    { pattern: /\bkillall\b/, riskLevel: 'high', reason: 'Kill all processes by name' },
    { pattern: /\bchmod\s+(-R\s+)?777\b/, riskLevel: 'high', reason: 'Overly permissive file permissions' },
    { pattern: /\bchown\s+(-R\s+)?root/, riskLevel: 'high', reason: 'Change ownership to root' },
    { pattern: /\b(visudo|passwd)\b/, riskLevel: 'high', reason: 'User/permission management' },

    // Medium: Potentially dangerous
    { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive\s+--force)/, riskLevel: 'medium', reason: 'Recursive force delete' },
    { pattern: /\brmdir\s+\/[sS]\b/, riskLevel: 'medium', reason: 'Recursive directory removal' },
    { pattern: /\bcurl\s+.*\|\s*(ba)?sh\b/, riskLevel: 'medium', reason: 'Pipe remote script to shell' },
    { pattern: /\bwget\s+.*\|\s*(ba)?sh\b/, riskLevel: 'medium', reason: 'Pipe remote script to shell' },
    { pattern: /\b(iptables|ufw|netsh)\b/, riskLevel: 'medium', reason: 'Network/firewall configuration' },
    { pattern: /\bsetx?\s+/i, riskLevel: 'medium', reason: 'Environment variable modification' },
    { pattern: /\bexport\s+PATH=/, riskLevel: 'medium', reason: 'PATH modification' },
    { pattern: />\s*\/etc\//, riskLevel: 'medium', reason: 'Write to system config directory' },
    { pattern: /\bnpm\s+(-g\s+)?install\s+--unsafe-perm/, riskLevel: 'medium', reason: 'npm install with unsafe permissions' },
    { pattern: /\bsudo\s+/, riskLevel: 'medium', reason: 'Elevated privileges' },
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
    };

    for (const entry of DANGEROUS_PATTERNS) {
        if (entry.pattern.test(normalizedCmd)) {
            const riskOrder = { safe: 0, low: 1, medium: 2, high: 3, critical: 4 };
            if (riskOrder[entry.riskLevel] > riskOrder[worstResult.riskLevel]) {
                worstResult = {
                    allowed: entry.riskLevel !== 'critical',
                    riskLevel: entry.riskLevel,
                    reason: entry.reason,
                    pattern: entry.pattern.source,
                };
            }
        }
    }

    // For critical commands, always block
    if (worstResult.riskLevel === 'critical') {
        worstResult.allowed = false;
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
