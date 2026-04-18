import { detectMultiAgentIntent, type MultiAgentIntentSignal } from './multiAgentExecution';

export type DelegationWorkflowShape = 'parallel' | 'staged';

export type DelegationRoleId =
    | 'planner'
    | 'researcher'
    | 'developer'
    | 'reviewer'
    | 'tester'
    | 'analyst'
    | 'synthesizer';

export type DelegationRolePlan = {
    roleId: DelegationRoleId;
    objective: string;
    lane: 'parallel' | 'staged';
    dependsOn?: DelegationRoleId[];
    source: 'explicit' | 'inferred' | 'fallback';
};

export type DelegationExecutionPlan = {
    shouldDelegate: boolean;
    workflowShape: DelegationWorkflowShape;
    roles: DelegationRolePlan[];
    weightedScore: number;
    rationale: string[];
};

export const DELEGATION_PLAN_CONTRACT_MARKER = '[CoworkAny Delegation Plan]';

const STAGED_WORKFLOW_PATTERN = /\b(then|after|next|phase|stage|handoff|pipeline|round)\b|先.*再|然后|接着|阶段|交接|流程/iu;
const CODING_TASK_PATTERN = /\b(implement(?:ation)?|code|refactor|fix|test(?:ing)?|bug(?:\s*fix)?|build|typescript|javascript|python|api|backend|frontend)\b|实现|编码|修复|测试|后端|前端|接口/iu;

const ROLE_PATTERNS: Array<{ roleId: DelegationRoleId; pattern: RegExp }> = [
    { roleId: 'planner', pattern: /\b(planner|plan|architect)\b|规划|架构/iu },
    { roleId: 'researcher', pattern: /\b(researcher|research|investigat(?:e|ion)|analyst)\b|研究|调研|分析/iu },
    { roleId: 'developer', pattern: /\b(developer|coder|engineer|implementation|implementer)\b|开发|编码|实现/iu },
    { roleId: 'reviewer', pattern: /\b(reviewer|review|critic|audit)\b|评审|审查|审计/iu },
    { roleId: 'tester', pattern: /\b(tester|qa|test\s*engineer|verification)\b|测试|质保|验证/iu },
    { roleId: 'analyst', pattern: /\b(analyst|analysis|sizing|risk)\b|分析|评估|风险/iu },
    { roleId: 'synthesizer', pattern: /\b(synthesizer|synthesis|integrat(?:e|ion)|merge|consolidat(?:e|ion))\b|综合|汇总|整合/iu },
];

const ROLE_DEFAULT_OBJECTIVES: Record<DelegationRoleId, string> = {
    planner: 'Define concrete task decomposition, ordering, and ownership boundaries.',
    researcher: 'Collect primary evidence and constraints needed for implementation decisions; prioritize workspace/local inputs unless external web research is explicitly required.',
    developer: 'Implement changes within assigned scope and produce concrete artifacts.',
    reviewer: 'Review implementation for regressions, correctness, and maintainability risks.',
    tester: 'Validate behavior with focused tests and report reproducible failures.',
    analyst: 'Evaluate tradeoffs, risk profile, and acceptance criteria coverage using available task/workspace evidence first.',
    synthesizer: 'Integrate role outputs into a coherent final result with evidence.',
};

function resolveWorkflowShape(message: string): DelegationWorkflowShape {
    return STAGED_WORKFLOW_PATTERN.test(message) ? 'staged' : 'parallel';
}

function resolveRoleOrder(message: string): DelegationRoleId[] {
    const matches = ROLE_PATTERNS
        .map(({ roleId, pattern }) => {
            const result = pattern.exec(message);
            return result ? { roleId, index: result.index } : null;
        })
        .filter((entry): entry is { roleId: DelegationRoleId; index: number } => Boolean(entry))
        .sort((left, right) => left.index - right.index);
    const ordered = matches.map((entry) => entry.roleId);
    return Array.from(new Set(ordered));
}

function resolveFallbackRoles(message: string, workflowShape: DelegationWorkflowShape): DelegationRoleId[] {
    if (CODING_TASK_PATTERN.test(message)) {
        return workflowShape === 'staged'
            ? ['researcher', 'developer', 'reviewer', 'tester', 'synthesizer']
            : ['researcher', 'developer', 'reviewer', 'synthesizer'];
    }
    return workflowShape === 'staged'
        ? ['analyst', 'planner', 'reviewer', 'synthesizer']
        : ['analyst', 'reviewer', 'synthesizer'];
}

function capRoles(roles: DelegationRoleId[], maxRoles: number): DelegationRoleId[] {
    const capped = roles.slice(0, Math.max(2, Math.floor(maxRoles)));
    if (capped.length < 2) {
        return ['analyst', 'synthesizer'];
    }
    return capped;
}

function ensureSynthesizerLast(roles: DelegationRoleId[]): DelegationRoleId[] {
    const withoutSynthesizer = roles.filter((roleId) => roleId !== 'synthesizer');
    return [...withoutSynthesizer, 'synthesizer'];
}

function mergeRoles(primary: DelegationRoleId[], secondary: DelegationRoleId[]): DelegationRoleId[] {
    return Array.from(new Set([...primary, ...secondary]));
}

function buildRolePlans(
    roles: DelegationRoleId[],
    workflowShape: DelegationWorkflowShape,
    source: 'explicit' | 'fallback',
): DelegationRolePlan[] {
    const normalizedRoles = ensureSynthesizerLast(roles);
    return normalizedRoles.map((roleId, index) => {
        const isSynthesizer = roleId === 'synthesizer';
        if (workflowShape === 'parallel') {
            const dependsOn = isSynthesizer
                ? normalizedRoles.filter((candidate) => candidate !== 'synthesizer')
                : undefined;
            return {
                roleId,
                objective: ROLE_DEFAULT_OBJECTIVES[roleId],
                lane: isSynthesizer ? 'staged' : 'parallel',
                dependsOn: dependsOn && dependsOn.length > 0 ? dependsOn : undefined,
                source,
            };
        }
        const priorRole = index > 0 ? normalizedRoles[index - 1] : undefined;
        return {
            roleId,
            objective: ROLE_DEFAULT_OBJECTIVES[roleId],
            lane: 'staged',
            dependsOn: priorRole ? [priorRole] : undefined,
            source,
        };
    });
}

export function buildDelegationExecutionPlan(input: {
    message: string;
    signal?: MultiAgentIntentSignal;
    maxRoles?: number;
}): DelegationExecutionPlan {
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    const signal = input.signal ?? detectMultiAgentIntent(message);
    if (!message || !signal.shouldUseMultiAgent) {
        return {
            shouldDelegate: false,
            workflowShape: 'parallel',
            roles: [],
            weightedScore: signal.weightedScore,
            rationale: ['no_multi_agent_signal'],
        };
    }

    const workflowShape = resolveWorkflowShape(message);
    const explicitRoles = resolveRoleOrder(message);
    const maxRoles = Number.isFinite(input.maxRoles) ? Math.max(2, Math.floor(input.maxRoles as number)) : 4;
    const fallbackRoles = resolveFallbackRoles(message, workflowShape);
    const selectedRoles = explicitRoles.length >= 2
        ? capRoles(explicitRoles, maxRoles)
        : capRoles(mergeRoles(explicitRoles, fallbackRoles), maxRoles);
    const source: 'explicit' | 'fallback' = explicitRoles.length > 0 ? 'explicit' : 'fallback';
    const roles = buildRolePlans(selectedRoles, workflowShape, source);
    const rationale = [
        signal.explicitKeyword ? 'explicit_keyword' : 'keyword_implicit',
        `role_count:${roles.length}`,
        `workflow:${workflowShape}`,
        source === 'explicit' ? 'roles_from_prompt' : 'roles_from_fallback',
    ];
    return {
        shouldDelegate: roles.length >= 2,
        workflowShape,
        roles,
        weightedScore: signal.weightedScore,
        rationale,
    };
}

function toRoleContractLine(role: DelegationRolePlan): string {
    const dependsOn = Array.isArray(role.dependsOn) && role.dependsOn.length > 0
        ? role.dependsOn.join(',')
        : 'none';
    return `- role=${role.roleId}; lane=${role.lane}; depends_on=${dependsOn}; objective=${role.objective}`;
}

export function injectDelegationPlanContract(input: {
    message: string;
    plan: DelegationExecutionPlan;
}): string {
    const message = typeof input.message === 'string' ? input.message : '';
    if (!input.plan.shouldDelegate) {
        return message;
    }
    if (message.includes(DELEGATION_PLAN_CONTRACT_MARKER)) {
        return message;
    }
    const contract = [
        DELEGATION_PLAN_CONTRACT_MARKER,
        `workflow_shape=${input.plan.workflowShape}`,
        `role_count=${input.plan.roles.length}`,
        ...input.plan.roles.map((role) => toRoleContractLine(role)),
    ].join('\n');
    return `${contract}\n\n${message}`;
}
