import { SkillPolicy } from './types';

export function mapAllowedTools(
    skillId: string,
    allowedTools: string[],
    availableTools: string[]
): SkillPolicy {
    const allowed = new Set(allowedTools);
    const allowedResolved = availableTools.filter((tool) => allowed.has(tool));
    const denied = availableTools.filter((tool) => !allowed.has(tool));

    return {
        skillId,
        allowedTools: allowedResolved,
        deniedTools: denied,
    };
}

export function isToolAllowed(policy: SkillPolicy, toolName: string): boolean {
    return policy.allowedTools.includes(toolName);
}
