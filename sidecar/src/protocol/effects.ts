import { z } from 'zod';
export const EffectTypeSchema = z.enum([
    'filesystem:read',      // Read files/directories
    'filesystem:write',     // Write/modify/delete files (requires Shadow+Diff+Confirm)
    'shell:read',           // Read-only commands (ls, cat, etc.)
    'shell:write',          // Write commands (rm, mv, install, etc.) - requires Confirm + allowlist
    'network:outbound',     // Outbound HTTP/WebSocket - requires domain whitelist
    'code:execute',         // Execute arbitrary code (Python/JS)
    'code:execute:sandbox', // Sandboxed code execution - safer than raw execution
    'knowledge:read',       // Read from knowledge base
    'knowledge:update',     // Update knowledge base - auto-approve for AI learning
    'secrets:read',         // Access secrets/credentials - default DENY
    'screen:capture',       // Screenshot/screen recording - requires Confirm
    'ui:control',           // UI automation - default DENY
]);
export type EffectType = z.infer<typeof EffectTypeSchema>;
export const EffectSourceSchema = z.enum([
    'agent',      // Core agent loop
    'toolpack',   // MCP Toolpack
    'claude_skill',      // Claude Skill
]);
export type EffectSource = z.infer<typeof EffectSourceSchema>;
export const ConfirmationPolicySchema = z.enum([
    'always',     // Always require confirmation (high-risk)
    'once',       // Confirm once per request
    'session',    // Confirm once per session
    'permanent',  // Remember approval permanently
    'never',      // Auto-approve (low-risk, read-only)
]);
export type ConfirmationPolicy = z.infer<typeof ConfirmationPolicySchema>;
export const EffectScopeSchema = z.object({
    workspacePaths: z.array(z.string()).optional(),
    allowedExtensions: z.array(z.string()).optional(),
    excludedPaths: z.array(z.string()).optional(),
    commandAllowlist: z.array(z.string()).optional(),
    commandBlocklist: z.array(z.string()).optional(),
    domainAllowlist: z.array(z.string()).optional(),
    domainBlocklist: z.array(z.string()).optional(),
    maxFileSizeBytes: z.number().optional(),
    timeoutMs: z.number().optional(),
});
export const EffectRequestSchema = z.object({
    id: z.string().uuid(),
    timestamp: z.string().datetime({ offset: true }),
    effectType: EffectTypeSchema,
    source: EffectSourceSchema,
    sourceId: z.string().optional(), // Toolpack ID or Claude Skill ID
    payload: z.object({
        path: z.string().optional(),
        content: z.string().optional(),
        operation: z.enum(['read', 'write', 'delete', 'create', 'move']).optional(),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        cwd: z.string().optional(),
        url: z.string().optional(),
        method: z.string().optional(),
        headers: z.record(z.string()).optional(),
        description: z.string().optional(),
    }),
    context: z.object({
        taskId: z.string().optional(),
        toolName: z.string().optional(),
        reasoning: z.string().optional(), // Why this effect is needed
    }).optional(),
    scope: EffectScopeSchema.optional(),
});
export type EffectRequest = z.infer<typeof EffectRequestSchema>;
export const EffectResponseSchema = z.object({
    requestId: z.string().uuid(),
    timestamp: z.string().datetime({ offset: true }),
    approved: z.boolean(),
    approvalType: ConfirmationPolicySchema.nullable().optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    denialReason: z.string().nullable().optional(),
    denialCode: z.enum([
        'user_denied',
        'policy_blocked',
        'policy_error',
        'scope_violation',
        'timeout',
        'rate_limited',
    ]).nullable().optional(),
    modifiedScope: EffectScopeSchema.nullable().optional(),
});
export type EffectResponse = z.infer<typeof EffectResponseSchema>;
export const DEFAULT_EFFECT_POLICIES: Record<EffectType, ConfirmationPolicy> = {
    'filesystem:read': 'never',
    'filesystem:write': 'always',
    'shell:read': 'once',
    'shell:write': 'always',
    'network:outbound': 'once',
    'code:execute': 'always',           // Require confirmation for raw code execution
    'code:execute:sandbox': 'once',     // Confirm once per session for sandboxed execution
    'knowledge:read': 'never',          // Auto-approve knowledge reads
    'knowledge:update': 'never',        // Auto-approve knowledge updates (AI learning)
    'secrets:read': 'always',           // Would be 'deny' in production
    'screen:capture': 'always',
    'ui:control': 'always',             // Would be 'deny' in production
};
export const EFFECT_RISK_LEVELS: Record<EffectType, number> = {
    'filesystem:read': 2,
    'filesystem:write': 7,
    'shell:read': 3,
    'shell:write': 9,
    'network:outbound': 5,
    'code:execute': 8,              // High risk - raw code execution
    'code:execute:sandbox': 5,      // Medium risk - sandboxed execution
    'knowledge:read': 1,            // Low risk - reading knowledge
    'knowledge:update': 2,          // Low risk - updating knowledge
    'secrets:read': 10,
    'screen:capture': 6,
    'ui:control': 10,
};
