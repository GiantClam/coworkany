/**
 * CoworkAny Protocol - Effects Schema
 * 
 * Defines the Effect type system for Policy Gate decisions.
 * All side effects (filesystem, shell, network, etc.) must be declared
 * and approved through this schema before execution.
 */

import { z } from 'zod';

// ============================================================================
// Effect Type Enumeration
// ============================================================================

/**
 * Effect categories with granular permissions.
 * Format: "category:permission"
 */
export const EffectTypeSchema = z.enum([
    // Filesystem operations
    'filesystem:read',      // Read files/directories
    'filesystem:write',     // Write/modify/delete files (requires Shadow+Diff+Confirm)

    // Shell/command execution
    'shell:read',           // Read-only commands (ls, cat, etc.)
    'shell:write',          // Write commands (rm, mv, install, etc.) - requires Confirm + allowlist

    // Network operations
    'network:outbound',     // Outbound HTTP/WebSocket - requires domain whitelist

    // Code execution (OpenClaw-style)
    'code:execute',         // Execute arbitrary code (Python/JS)
    'code:execute:sandbox', // Sandboxed code execution - safer than raw execution

    // Knowledge/Memory operations
    'knowledge:read',       // Read from knowledge base
    'knowledge:update',     // Update knowledge base - auto-approve for AI learning

    // Sensitive operations
    'secrets:read',         // Access secrets/credentials - default DENY
    'screen:capture',       // Screenshot/screen recording - requires Confirm
    'ui:control',           // UI automation - default DENY
]);

export type EffectType = z.infer<typeof EffectTypeSchema>;

// ============================================================================
// Effect Request Source
// ============================================================================

/**
 * The origin of an effect request for audit purposes.
 */
export const EffectSourceSchema = z.enum([
    'agent',      // Core agent loop
    'toolpack',   // MCP Toolpack
    'claude_skill',      // Claude Skill
]);

export type EffectSource = z.infer<typeof EffectSourceSchema>;

// ============================================================================
// Confirmation Policy
// ============================================================================

/**
 * User confirmation policy for effect approval.
 */
export const ConfirmationPolicySchema = z.enum([
    'always',     // Always require confirmation (high-risk)
    'once',       // Confirm once per request
    'session',    // Confirm once per session
    'permanent',  // Remember approval permanently
    'never',      // Auto-approve (low-risk, read-only)
]);

export type ConfirmationPolicy = z.infer<typeof ConfirmationPolicySchema>;

// ============================================================================
// Effect Scope
// ============================================================================

/**
 * Scope constraints for effect execution.
 */
export const EffectScopeSchema = z.object({
    // Filesystem scope
    workspacePaths: z.array(z.string()).optional(),
    allowedExtensions: z.array(z.string()).optional(),
    excludedPaths: z.array(z.string()).optional(),

    // Shell scope
    commandAllowlist: z.array(z.string()).optional(),
    commandBlocklist: z.array(z.string()).optional(),

    // Network scope
    domainAllowlist: z.array(z.string()).optional(),
    domainBlocklist: z.array(z.string()).optional(),

    // General
    maxFileSizeBytes: z.number().optional(),
    timeoutMs: z.number().optional(),
});

export type EffectScope = z.infer<typeof EffectScopeSchema>;

// ============================================================================
// Effect Request
// ============================================================================

/**
 * Request for executing a side effect.
 * Sent from Sidecar to Rust Policy Gate for approval.
 */
export const EffectRequestSchema = z.object({
    id: z.string().uuid(),
    timestamp: z.string().datetime(),

    // Effect classification
    effectType: EffectTypeSchema,
    source: EffectSourceSchema,
    sourceId: z.string().optional(), // Toolpack ID or Claude Skill ID

    // Request details
    payload: z.object({
        // Filesystem
        path: z.string().optional(),
        content: z.string().optional(),
        operation: z.enum(['read', 'write', 'delete', 'create', 'move']).optional(),

        // Shell
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        cwd: z.string().optional(),

        // Network
        url: z.string().optional(),
        method: z.string().optional(),
        headers: z.record(z.string()).optional(),

        // Generic
        description: z.string().optional(),
    }),

    // Context for decision-making
    context: z.object({
        taskId: z.string().optional(),
        toolName: z.string().optional(),
        reasoning: z.string().optional(), // Why this effect is needed
    }).optional(),

    // Scope constraints (if any)
    scope: EffectScopeSchema.optional(),
});

export type EffectRequest = z.infer<typeof EffectRequestSchema>;

// ============================================================================
// Effect Response
// ============================================================================

/**
 * Response from Rust Policy Gate.
 */
export const EffectResponseSchema = z.object({
    requestId: z.string().uuid(),
    timestamp: z.string().datetime(),

    // Decision
    approved: z.boolean(),

    // Approval details
    approvalType: ConfirmationPolicySchema.optional(),
    expiresAt: z.string().datetime().optional(),

    // Denial details
    denialReason: z.string().optional(),
    denialCode: z.enum([
        'user_denied',
        'policy_blocked',
        'scope_violation',
        'timeout',
        'rate_limited',
    ]).optional(),

    // Modifications (Policy Gate may constrain the request)
    modifiedScope: EffectScopeSchema.optional(),
});

export type EffectResponse = z.infer<typeof EffectResponseSchema>;

// ============================================================================
// Default Policies
// ============================================================================

/**
 * Default confirmation requirements by effect type.
 * Used when no user/enterprise policy overrides.
 */
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

/**
 * Risk level by effect type (1-10).
 * Used for UI display and audit prioritization.
 */
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
