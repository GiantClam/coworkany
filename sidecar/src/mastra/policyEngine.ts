export type PolicyDecisionAction = 'task_command' | 'forward_command' | 'approval_result';

export type PolicyDecisionInput = {
    action: PolicyDecisionAction;
    commandType?: string;
    taskId?: string;
    approved?: boolean;
    payload?: Record<string, unknown>;
};

export type PolicyDecision = {
    allowed: boolean;
    reason: string;
    ruleId: string;
};

export type PolicyEngine = {
    evaluate: (input: PolicyDecisionInput) => PolicyDecision;
};

type PolicyEngineConfig = {
    denyForwardCommandTypes?: string[];
    denyTaskCommandTypes?: string[];
    denyApprovedTools?: string[];
};

function toNormalizedSet(values: string[] | undefined): Set<string> {
    const normalized = (values ?? [])
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0);
    return new Set(normalized);
}

function pickToolName(payload: Record<string, unknown> | undefined): string | undefined {
    const value = payload?.toolName;
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

export function createMastraPolicyEngine(config: PolicyEngineConfig = {}): PolicyEngine {
    const denyForwardCommandTypes = toNormalizedSet(config.denyForwardCommandTypes);
    const denyTaskCommandTypes = toNormalizedSet(config.denyTaskCommandTypes);
    const denyApprovedTools = toNormalizedSet(config.denyApprovedTools);

    return {
        evaluate: (input): PolicyDecision => {
            const commandType = input.commandType?.trim().toLowerCase();

            if (input.action === 'forward_command' && commandType && denyForwardCommandTypes.has(commandType)) {
                return {
                    allowed: false,
                    reason: `forward_command_blocked:${commandType}`,
                    ruleId: 'deny-forward-command',
                };
            }

            if (input.action === 'task_command' && commandType && denyTaskCommandTypes.has(commandType)) {
                return {
                    allowed: false,
                    reason: `task_command_blocked:${commandType}`,
                    ruleId: 'deny-task-command',
                };
            }

            if (input.action === 'approval_result' && input.approved === true) {
                const toolName = pickToolName(input.payload)?.toLowerCase();
                if (toolName && denyApprovedTools.has(toolName)) {
                    return {
                        allowed: false,
                        reason: `approval_blocked:${toolName}`,
                        ruleId: 'deny-approved-tool',
                    };
                }
            }

            return {
                allowed: true,
                reason: 'allowed_by_default',
                ruleId: 'default-allow',
            };
        },
    };
}

function parseCsvEnvList(raw: string | undefined): string[] {
    if (!raw) {
        return [];
    }
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

export function createMastraPolicyEngineFromEnv(
    env: Record<string, string | undefined> = process.env,
): PolicyEngine {
    return createMastraPolicyEngine({
        denyForwardCommandTypes: parseCsvEnvList(env.COWORKANY_POLICY_DENY_FORWARD_COMMANDS),
        denyTaskCommandTypes: parseCsvEnvList(env.COWORKANY_POLICY_DENY_TASK_COMMANDS),
        denyApprovedTools: parseCsvEnvList(env.COWORKANY_POLICY_DENY_APPROVED_TOOLS),
    });
}
