import { z } from 'zod';
import { EffectTypeSchema } from './effects';
const OptionalStringFromNullishSchema = z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().optional(),
);
export const RuntimeBinaryInfoSchema = z.object({
    available: z.boolean(),
    path: z.string().optional(),
    source: z.string().optional(),
});
export const ManagedServiceCapabilitySchema = z.object({
    id: z.string(),
    bundled: z.boolean(),
    runtimeReady: z.boolean(),
});
export const PlatformRuntimeContextSchema = z.object({
    platform: z.string(),
    arch: z.string(),
    appDir: z.string(),
    appDataDir: z.string(),
    shell: z.string(),
    sidecarLaunchMode: OptionalStringFromNullishSchema,
    python: RuntimeBinaryInfoSchema,
    skillhub: RuntimeBinaryInfoSchema,
    managedServices: z.array(ManagedServiceCapabilitySchema),
});
export const ToolpackRuntimeSchema = z.enum(['stdio', 'http', 'internal']);
export const ToolpackSourceSchema = z.enum(['registry', 'local_folder', 'github', 'built_in']);
export const ToolpackManifestSchema = z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    description: z.string().optional(),
    author: z.string().optional(),
    entry: z.string().optional(),
    runtime: ToolpackRuntimeSchema.default('stdio'),
    tools: z.array(z.string()).default([]),
    effects: z.array(EffectTypeSchema).default([]),
    tags: z.array(z.string()).optional(),
    homepage: z.string().optional(),
    repository: z.string().optional(),
    signature: z.string().optional(),
});
export const ExtensionPermissionSummarySchema = z.object({
    tools: z.array(z.string()).default([]),
    effects: z.array(z.string()).default([]),
    hostAccess: z.array(z.string()).default([]),
    notes: z.array(z.string()).default([]),
});
export const ExtensionPermissionDeltaSchema = z.object({
    added: ExtensionPermissionSummarySchema,
    removed: ExtensionPermissionSummarySchema,
});
export const ExtensionProvenanceSchema = z.object({
    sourceType: z.enum(['built_in', 'workspace_local', 'github']).default('workspace_local'),
    sourceRef: z.string().optional(),
    digest: z.string().optional(),
    publisher: z.string().optional(),
    verifiedAt: z.string().optional(),
});
export const ExtensionTrustSummarySchema = z.object({
    level: z.enum(['trusted', 'review_required', 'untrusted']).default('review_required'),
    pendingReview: z.boolean().default(false),
    reasons: z.array(z.string()).default([]),
});
export const ExtensionGovernanceReviewSchema = z.object({
    extensionType: z.enum(['skill', 'toolpack']),
    extensionId: z.string(),
    summary: z.string(),
    permissionDelta: ExtensionPermissionDeltaSchema.optional(),
    sourceWarnings: z.array(z.string()).default([]),
    trustWarnings: z.array(z.string()).default([]),
    decisionRequired: z.boolean().default(true),
});
export const ExtensionGovernanceStateSchema = z.object({
    approvedAt: z.string().optional(),
    pendingReview: z.boolean().default(false),
    quarantined: z.boolean().default(false),
    lastReviewSummary: z.string().optional(),
    reviewers: z.array(z.string()).default([]),
    updatedAt: z.string().optional(),
});
export const ClaudeSkillSourceSchema = z.enum(['builtin', 'local', 'github']);
export const ClaudeSkillManifestSchema = z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    description: z.string(),
    tags: z.array(z.string()).optional(),
    allowedTools: z.array(z.string()).optional(),
});
export const DirectiveSchema = z.object({
    id: z.string().optional(),
    name: z.string(),
    prompt: z.string(),
    updatedAt: z.string().optional(),
});
const BaseCommandSchema = z.object({
    id: z.string(),
    commandId: z.string().optional(),
    timestamp: z.string().optional(),
    payload: z.unknown().default({}),
});
const BaseResponseSchema = z.object({
    commandId: z.string(),
    timestamp: z.string(),
    payload: z.unknown().default({}),
});
export const SpeechProviderRegistrationSchema = z.object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(['system', 'custom']).default('system'),
    enabled: z.boolean().default(true),
    capabilities: z.array(z.enum(['asr', 'tts'])).default([]),
});
export const StartAutonomousTaskCommandSchema = BaseCommandSchema.extend({
    type: z.literal('start_autonomous_task'),
});
export const GetAutonomousTaskStatusCommandSchema = BaseCommandSchema.extend({
    type: z.literal('get_autonomous_task_status'),
});
export const PauseAutonomousTaskCommandSchema = BaseCommandSchema.extend({
    type: z.literal('pause_autonomous_task'),
});
export const ResumeAutonomousTaskCommandSchema = BaseCommandSchema.extend({
    type: z.literal('resume_autonomous_task'),
});
export const CancelAutonomousTaskCommandSchema = BaseCommandSchema.extend({
    type: z.literal('cancel_autonomous_task'),
});
export const ListAutonomousTasksCommandSchema = BaseCommandSchema.extend({
    type: z.literal('list_autonomous_tasks'),
});
export const IpcCommandSchema = BaseCommandSchema.extend({
    type: z.string(),
});
export const IpcResponseSchema = BaseResponseSchema.extend({
    type: z.string(),
});
export type IpcCommand = z.infer<typeof IpcCommandSchema>;
export type IpcResponse = z.infer<typeof IpcResponseSchema>;
export type PlatformRuntimeContext = z.infer<typeof PlatformRuntimeContextSchema>;
export type ToolpackManifest = z.infer<typeof ToolpackManifestSchema>;
export type ExtensionPermissionSummary = z.infer<typeof ExtensionPermissionSummarySchema>;
export type ExtensionPermissionDelta = z.infer<typeof ExtensionPermissionDeltaSchema>;
export type ExtensionProvenance = z.infer<typeof ExtensionProvenanceSchema>;
export type ExtensionTrustSummary = z.infer<typeof ExtensionTrustSummarySchema>;
export type ExtensionGovernanceReview = z.infer<typeof ExtensionGovernanceReviewSchema>;
export type ExtensionGovernanceState = z.infer<typeof ExtensionGovernanceStateSchema>;
export type ClaudeSkillManifest = z.infer<typeof ClaudeSkillManifestSchema>;
export type Directive = z.infer<typeof DirectiveSchema>;
