const CLI_INTENT_PATTERNS: RegExp[] = [
    /\b(cli|shell|terminal|command line|powershell|pwsh|cmd|bash|zsh|sh)\b/i,
    /(系统命令|命令行|终端命令|用命令|通过命令|用\s*cli|用\s*shell)/i,
    /\b(schtasks|taskkill|netsh|reg|diskpart|sc|ipconfig|route|launchctl|networksetup|scutil|diskutil|pmset|systemctl|journalctl|ufw|iptables|ip|ss|nmcli|apt|dnf|yum|rpm|dpkg|crontab|mount|umount|chmod|chown)\b/i,
];

export function isPlatformCliLearningRequest(message: string): boolean {
    const text = message.trim();
    if (!text) {
        return false;
    }

    return CLI_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

export function getCommandLearningDirective(message: string): string {
    if (!isPlatformCliLearningRequest(message)) {
        return '';
    }

    return `## Command Learning Priority

The current user request is explicitly asking for CLI / shell / system-command execution.

- Before ANY \`run_command\` call for a platform-sensitive or system command, you MUST call \`command_preflight\` first.
- If the OS or shell context is unclear, call \`system_status\` before \`command_preflight\`.
- Do NOT try raw \`run_command\` first and then learn after it fails.
- Do NOT silently rewrite the request into a different shell or a different platform command unless the preflight/help results justify the substitution.
- Prefer the user-named command when possible, and verify its platform-specific syntax locally before executing it.`;
}
