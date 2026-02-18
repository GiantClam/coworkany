import { z } from 'zod';

export const SkillSourceSchema = z.enum(['local_folder', 'zip', 'api']);
export type SkillSource = z.infer<typeof SkillSourceSchema>;

/**
 * Skill requirements schema (OpenClaw compatible)
 * Defines what tools, capabilities, binaries, and environment variables a skill needs
 */
export const SkillRequirementsSchema = z.object({
    /** Required tool names (e.g., ['Bash', 'Write', 'Read']) */
    tools: z.array(z.string()).default([]),
    /** Required capabilities (e.g., ['filesystem:write', 'network:outbound']) */
    capabilities: z.array(z.string()).default([]),
    /** Required CLI binaries on host (e.g., ['python3', 'node']) */
    bins: z.array(z.string()).default([]),
    /** Required environment variables (e.g., ['OPENAI_API_KEY']) */
    env: z.array(z.string()).default([]),
    /** Required config paths (e.g., ['llm.apiKey']) */
    config: z.array(z.string()).default([]),
});

export type SkillRequirements = z.infer<typeof SkillRequirementsSchema>;

/**
 * Extended skill manifest schema (OpenClaw compatible)
 * Supports triggers, requirements, and enhanced metadata
 */
export const SkillManifestSchema = z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    description: z.string().optional(),
    author: z.string().optional(),
    /** Optional homepage URL */
    homepage: z.string().url().optional(),
    /** Optional license identifier */
    license: z.string().optional(),
    /** Entry point file (optional) */
    entry: z.string().optional(),
    /** Allowed tools for this skill */
    allowedTools: z.array(z.string()).default([]),
    /** Discovery tags */
    tags: z.array(z.string()).default([]),

    // OpenClaw-compatible extensions
    /** Skill requirements (tools, binaries, env vars) */
    requires: SkillRequirementsSchema.optional(),
    /**
     * Trigger phrases for auto-activation
     * When user message matches any trigger, skill is auto-injected
     */
    triggers: z.array(z.string()).default([]),
    /**
     * Whether to expose as slash command (e.g., /docx)
     * @default true
     */
    userInvocable: z.boolean().default(true),
    /**
     * If true, skill instructions are NOT included in model prompts
     * Useful for background/system skills
     * @default false
     */
    disableModelInvocation: z.boolean().default(false),
    /**
     * Extension metadata for custom integrations
     * Follows OpenClaw's metadata.openclaw pattern
     */
    metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export const SkillPackageSchema = z.object({
    manifest: SkillManifestSchema,
    rootPath: z.string(),
    source: SkillSourceSchema,
    installedAt: z.string().datetime(),
});

export type SkillPackage = z.infer<typeof SkillPackageSchema>;

export const SkillRecordSchema = z.object({
    manifest: SkillManifestSchema,
    rootPath: z.string(),
    source: SkillSourceSchema,
    installedAt: z.string().datetime(),
    enabled: z.boolean(),
    lastUsedAt: z.string().datetime().optional(),
});

export type SkillRecord = z.infer<typeof SkillRecordSchema>;

export const SkillContextBundleSchema = z.object({
    skillId: z.string(),
    instructions: z.string(),
    resources: z.array(
        z.object({
            path: z.string(),
            content: z.string(),
        })
    ),
});

export type SkillContextBundle = z.infer<typeof SkillContextBundleSchema>;

export const SkillPolicySchema = z.object({
    skillId: z.string(),
    allowedTools: z.array(z.string()),
    deniedTools: z.array(z.string()),
});

export type SkillPolicy = z.infer<typeof SkillPolicySchema>;
