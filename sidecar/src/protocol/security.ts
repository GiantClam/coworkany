/**
 * CoworkAny Protocol - Identity and Security Schema
 *
 * Shared schemas for agent identity, MCP gateway decisions, and runtime guards.
 */

import { z } from 'zod';

// ============================================================================
// Agent Identity
// ============================================================================

export const AgentIdentitySchema = z.object({
    sessionId: z.string().uuid(),
    parentSessionId: z.string().uuid().optional(),
    userId: z.string().optional(),
    capabilities: z.array(z.string()).default([]),
    ephemeral: z.boolean(),
});

export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;

export const AgentDelegationSchema = z.object({
    parentSessionId: z.string().uuid(),
    childSessionId: z.string().uuid(),
    reason: z.string().optional(),
});

export type AgentDelegation = z.infer<typeof AgentDelegationSchema>;

// ============================================================================
// MCP Gateway Decision
// ============================================================================

export const McpGatewayDecisionSchema = z.object({
    serverId: z.string(),
    toolName: z.string(),
    toolId: z.string().optional(),
    decision: z.enum(['allow', 'deny', 'warn']),
    riskScore: z.number().min(1).max(10).optional(),
    reason: z.string().optional(),
    policyId: z.string().optional(),
    durationMs: z.number().int().nonnegative().optional(),
});

export type McpGatewayDecision = z.infer<typeof McpGatewayDecisionSchema>;

// ============================================================================
// Runtime Security Alert
// ============================================================================

export const RuntimeSecurityAlertSchema = z.object({
    threatType: z.string(),
    score: z.number().min(0).max(100),
    action: z.enum(['blocked', 'redacted', 'flagged', 'allowed']),
    detail: z.string().optional(),
    redactionApplied: z.boolean().optional(),
});

export type RuntimeSecurityAlert = z.infer<typeof RuntimeSecurityAlertSchema>;
