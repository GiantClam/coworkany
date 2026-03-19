/**
 * CoworkAny Protocol - IPC Commands Schema
 * 
 * Defines the command/response protocol between Sidecar and Rust.
 * Commands flow: Sidecar → Rust (for execution/policy decisions)
 * Responses flow: Rust → Sidecar (with results/approvals)
 */

import { z } from 'zod';
import { EffectRequestSchema, EffectResponseSchema, EffectScopeSchema, EffectTypeSchema } from './effects';
import { PatchApplyRequestSchema, PatchApplyResultSchema, FilePatchSchema } from './patches';
import {
    AgentDelegationSchema,
    AgentIdentitySchema,
    McpGatewayDecisionSchema,
    RuntimeSecurityAlertSchema,
} from './security';

// ============================================================================
// Base Command/Response
// ============================================================================

const BaseCommandSchema = z.object({
    id: z.string().uuid(),
    timestamp: z.string().datetime(),
});

const BaseResponseSchema = z.object({
    commandId: z.string().uuid(),
    timestamp: z.string().datetime(),
});

// ============================================================================
// Task Commands
// ============================================================================

/**
 * Start a new task.
 */
export const StartTaskCommandSchema = BaseCommandSchema.extend({
    type: z.literal('start_task'),
    payload: z.object({
        taskId: z.string().uuid(),
        title: z.string(),
        userQuery: z.string(),
        context: z.object({
            workspacePath: z.string(),
            activeFile: z.string().optional(),
            selectedText: z.string().optional(),
            openFiles: z.array(z.string()).optional(),
        }),
        config: z.object({
            modelId: z.string().optional(),
            maxTokens: z.number().optional(),
            maxHistoryMessages: z.number().int().positive().optional(),
            enabledClaudeSkills: z.array(z.string()).optional(),
            enabledToolpacks: z.array(z.string()).optional(),
            // Backward-compatible alias
            enabledSkills: z.array(z.string()).optional(),
            disabledTools: z.array(z.string()).optional(),
        }).optional(),
    }),
});

export const StartTaskResponseSchema = BaseResponseSchema.extend({
    type: z.literal('start_task_response'),
    payload: z.object({
        success: z.boolean(),
        taskId: z.string().uuid(),
        error: z.string().optional(),
        workspace: z.object({
            id: z.string(),
            name: z.string(),
            path: z.string(),
            autoNamed: z.boolean().optional(),
            createdAt: z.string().optional(),
        }).optional(),
    }),
});

/**
 * Cancel a running task.
 */
export const CancelTaskCommandSchema = BaseCommandSchema.extend({
    type: z.literal('cancel_task'),
    payload: z.object({
        taskId: z.string().uuid(),
        reason: z.string().optional(),
    }),
});

export const CancelTaskResponseSchema = BaseResponseSchema.extend({
    type: z.literal('cancel_task_response'),
    payload: z.object({
        success: z.boolean(),
        taskId: z.string().uuid(),
    }),
});

/**
 * Clear task conversation history.
 */
export const ClearTaskHistoryCommandSchema = BaseCommandSchema.extend({
    type: z.literal('clear_task_history'),
    payload: z.object({
        taskId: z.string().uuid(),
    }),
});

export const ClearTaskHistoryResponseSchema = BaseResponseSchema.extend({
    type: z.literal('clear_task_history_response'),
    payload: z.object({
        success: z.boolean(),
        taskId: z.string().uuid(),
        error: z.string().optional(),
    }),
});

/**
 * Send a message to an existing task.
 */
export const SendTaskMessageCommandSchema = BaseCommandSchema.extend({
    type: z.literal('send_task_message'),
    payload: z.object({
        taskId: z.string().uuid(),
        content: z.string(),
        config: z.object({
            modelId: z.string().optional(),
            maxTokens: z.number().optional(),
            maxHistoryMessages: z.number().int().positive().optional(),
            enabledClaudeSkills: z.array(z.string()).optional(),
            enabledToolpacks: z.array(z.string()).optional(),
            enabledSkills: z.array(z.string()).optional(),
            disabledTools: z.array(z.string()).optional(),
        }).optional(),
    }),
});

export const SendTaskMessageResponseSchema = BaseResponseSchema.extend({
    type: z.literal('send_task_message_response'),
    payload: z.object({
        success: z.boolean(),
        taskId: z.string().uuid(),
        error: z.string().optional(),
    }),
});

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
    sidecarLaunchMode: z.string().optional(),
    python: RuntimeBinaryInfoSchema,
    skillhub: RuntimeBinaryInfoSchema,
    managedServices: z.array(ManagedServiceCapabilitySchema),
});

export const BootstrapRuntimeContextCommandSchema = BaseCommandSchema.extend({
    type: z.literal('bootstrap_runtime_context'),
    payload: z.object({
        runtimeContext: PlatformRuntimeContextSchema,
    }),
});

export const BootstrapRuntimeContextResponseSchema = BaseResponseSchema.extend({
    type: z.literal('bootstrap_runtime_context_response'),
    payload: z.object({
        success: z.boolean(),
    }),
});

// ============================================================================
// Effect Commands
// ============================================================================

/**
 * Request approval for an effect.
 */
export const RequestEffectCommandSchema = BaseCommandSchema.extend({
    type: z.literal('request_effect'),
    payload: z.object({
        request: EffectRequestSchema,
    }),
});

export const RequestEffectResponseSchema = BaseResponseSchema.extend({
    type: z.literal('request_effect_response'),
    payload: z.object({
        response: EffectResponseSchema,
    }),
});

/**
 * Report effect execution result.
 */
export const ReportEffectResultCommandSchema = BaseCommandSchema.extend({
    type: z.literal('report_effect_result'),
    payload: z.object({
        requestId: z.string().uuid(),
        success: z.boolean(),
        result: z.unknown().optional(),
        error: z.string().optional(),
        duration: z.number(), // ms
    }),
});

// ============================================================================
// Patch Commands
// ============================================================================

/**
 * Propose a patch for user review.
 */
export const ProposePatchCommandSchema = BaseCommandSchema.extend({
    type: z.literal('propose_patch'),
    payload: z.object({
        patch: FilePatchSchema,
        taskId: z.string().uuid(),
    }),
});

export const ProposePatchResponseSchema = BaseResponseSchema.extend({
    type: z.literal('propose_patch_response'),
    payload: z.object({
        patchId: z.string().uuid(),
        shadowPath: z.string(), // Path to shadow file for preview
    }),
});

/**
 * Apply an approved patch.
 */
export const ApplyPatchCommandSchema = BaseCommandSchema.extend({
    type: z.literal('apply_patch'),
    payload: PatchApplyRequestSchema,
});

export const ApplyPatchResponseSchema = BaseResponseSchema.extend({
    type: z.literal('apply_patch_response'),
    payload: PatchApplyResultSchema,
});

/**
 * Reject a proposed patch.
 */
export const RejectPatchCommandSchema = BaseCommandSchema.extend({
    type: z.literal('reject_patch'),
    payload: z.object({
        patchId: z.string().uuid(),
        reason: z.string().optional(),
    }),
});

// ============================================================================
// Filesystem Commands (via Policy Gate)
// ============================================================================

/**
 * Read file (goes through policy for audit).
 */
export const ReadFileCommandSchema = BaseCommandSchema.extend({
    type: z.literal('read_file'),
    payload: z.object({
        path: z.string(),
        encoding: z.string().default('utf-8'),
        maxBytes: z.number().optional(),
    }),
});

export const ReadFileResponseSchema = BaseResponseSchema.extend({
    type: z.literal('read_file_response'),
    payload: z.object({
        success: z.boolean(),
        content: z.string().optional(),
        error: z.string().optional(),
        truncated: z.boolean().optional(),
    }),
});

/**
 * List directory.
 */
export const ListDirCommandSchema = BaseCommandSchema.extend({
    type: z.literal('list_dir'),
    payload: z.object({
        path: z.string(),
        recursive: z.boolean().default(false),
        maxDepth: z.number().default(3),
        includeHidden: z.boolean().default(false),
    }),
});

export const ListDirResponseSchema = BaseResponseSchema.extend({
    type: z.literal('list_dir_response'),
    payload: z.object({
        success: z.boolean(),
        entries: z.array(z.object({
            name: z.string(),
            path: z.string(),
            isDirectory: z.boolean(),
            size: z.number().optional(),
            modified: z.string().datetime().optional(),
        })).optional(),
        error: z.string().optional(),
    }),
});

// ============================================================================
// Shell Commands (via Policy Gate)
// ============================================================================

/**
 * Execute shell command.
 */
export const ExecShellCommandSchema = BaseCommandSchema.extend({
    type: z.literal('exec_shell'),
    payload: z.object({
        command: z.string(),
        args: z.array(z.string()).default([]),
        cwd: z.string().optional(),
        env: z.record(z.string()).optional(),
        timeout: z.number().default(30000), // ms
        stdin: z.string().optional(),
    }),
});

export const ExecShellResponseSchema = BaseResponseSchema.extend({
    type: z.literal('exec_shell_response'),
    payload: z.object({
        success: z.boolean(),
        exitCode: z.number().optional(),
        stdout: z.string().optional(),
        stderr: z.string().optional(),
        error: z.string().optional(),
        timedOut: z.boolean().optional(),
    }),
});

// ============================================================================
// Screenshot Command
// ============================================================================

/**
 * Capture screenshot.
 */
export const CaptureScreenCommandSchema = BaseCommandSchema.extend({
    type: z.literal('capture_screen'),
    payload: z.object({
        region: z.enum(['full', 'window', 'selection']).default('window'),
        format: z.enum(['png', 'webp', 'jpeg']).default('png'),
        quality: z.number().min(1).max(100).default(90),
    }),
});

export const CaptureScreenResponseSchema = BaseResponseSchema.extend({
    type: z.literal('capture_screen_response'),
    payload: z.object({
        success: z.boolean(),
        imagePath: z.string().optional(),
        imageBase64: z.string().optional(),
        error: z.string().optional(),
    }),
});

// ============================================================================
// Policy Configuration Commands
// ============================================================================

/**
 * Get current policy configuration.
 */
export const GetPolicyConfigCommandSchema = BaseCommandSchema.extend({
    type: z.literal('get_policy_config'),
    payload: z.object({
        scope: EffectScopeSchema.optional(),
    }),
});

export const GetPolicyConfigResponseSchema = BaseResponseSchema.extend({
    type: z.literal('get_policy_config_response'),
    payload: z.object({
        defaultPolicies: z.record(z.string()), // EffectType → ConfirmationPolicy
        allowlists: z.object({
            commands: z.array(z.string()),
            domains: z.array(z.string()),
            paths: z.array(z.string()),
        }),
        blocklists: z.object({
            commands: z.array(z.string()),
            domains: z.array(z.string()),
            paths: z.array(z.string()),
        }),
    }),
});


// ============================================================================
// Toolpack and Claude Skill Management Commands
// ============================================================================

// Toolpacks (MCP tool servers)
export const ToolpackRuntimeSchema = z.enum(['node', 'bun', 'python', 'internal', 'other']);
export const ToolpackSourceSchema = z.enum(['local_folder', 'zip', 'registry', 'url', 'git', 'built_in']);

export const ToolpackManifestSchema = z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    description: z.string().optional(),
    author: z.string().optional(),
    entry: z.string().optional(),
    runtime: ToolpackRuntimeSchema.optional(),
    tools: z.array(z.string()).default([]),
    effects: z.array(EffectTypeSchema).default([]),
    tags: z.array(z.string()).default([]),
    homepage: z.string().optional(),
    repository: z.string().optional(),
    signature: z.string().optional(), // Package signature for verification
});

export const ToolpackRecordSchema = z.object({
    manifest: ToolpackManifestSchema,
    source: ToolpackSourceSchema,
    rootPath: z.string().optional(),
    installedAt: z.string().datetime(),
    enabled: z.boolean(),
    lastUsedAt: z.string().datetime().optional(),
    status: z.enum(['stopped', 'running', 'error']).optional(),
});

export const ListToolpacksCommandSchema = BaseCommandSchema.extend({
    type: z.literal('list_toolpacks'),
    payload: z.object({
        includeDisabled: z.boolean().default(true),
    }).optional(),
});

export const ListToolpacksResponseSchema = BaseResponseSchema.extend({
    type: z.literal('list_toolpacks_response'),
    payload: z.object({
        toolpacks: z.array(ToolpackRecordSchema),
    }),
});

export const GetToolpackCommandSchema = BaseCommandSchema.extend({
    type: z.literal('get_toolpack'),
    payload: z.object({
        toolpackId: z.string(),
    }),
});

export const GetToolpackResponseSchema = BaseResponseSchema.extend({
    type: z.literal('get_toolpack_response'),
    payload: z.object({
        toolpack: ToolpackRecordSchema.optional(),
    }),
});

export const InstallToolpackCommandSchema = BaseCommandSchema.extend({
    type: z.literal('install_toolpack'),
    payload: z.object({
        source: ToolpackSourceSchema,
        path: z.string().optional(),
        url: z.string().optional(),
        allowUnsigned: z.boolean().default(false),
        overwrite: z.boolean().default(false),
    }),
});

export const InstallToolpackResponseSchema = BaseResponseSchema.extend({
    type: z.literal('install_toolpack_response'),
    payload: z.object({
        success: z.boolean(),
        toolpackId: z.string().optional(),
        error: z.string().optional(),
    }),
});

export const SetToolpackEnabledCommandSchema = BaseCommandSchema.extend({
    type: z.literal('set_toolpack_enabled'),
    payload: z.object({
        toolpackId: z.string(),
        enabled: z.boolean(),
    }),
});

export const SetToolpackEnabledResponseSchema = BaseResponseSchema.extend({
    type: z.literal('set_toolpack_enabled_response'),
    payload: z.object({
        success: z.boolean(),
        toolpackId: z.string(),
        error: z.string().optional(),
    }),
});

export const RemoveToolpackCommandSchema = BaseCommandSchema.extend({
    type: z.literal('remove_toolpack'),
    payload: z.object({
        toolpackId: z.string(),
        deleteFiles: z.boolean().default(true),
    }),
});

export const RemoveToolpackResponseSchema = BaseResponseSchema.extend({
    type: z.literal('remove_toolpack_response'),
    payload: z.object({
        success: z.boolean(),
        toolpackId: z.string(),
        error: z.string().optional(),
    }),
});

// Claude Skills (Agent Skills)
export const ClaudeSkillSourceSchema = z.enum(['local_folder', 'zip', 'api']);

export const ClaudeSkillManifestSchema = z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    description: z.string().optional(),
    author: z.string().optional(),
    entry: z.string().optional(),
    allowedTools: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
});

export const DirectiveSchema = z.object({
    id: z.string(),
    name: z.string(),
    content: z.string(),
    enabled: z.boolean(),
    priority: z.number().int(),
    trigger: z.string().optional(),
});

export const ClaudeSkillRecordSchema = z.object({
    manifest: ClaudeSkillManifestSchema,
    rootPath: z.string(),
    source: ClaudeSkillSourceSchema,
    installedAt: z.string().datetime(),
    enabled: z.boolean(),
    lastUsedAt: z.string().datetime().optional(),
});

export const ListClaudeSkillsCommandSchema = BaseCommandSchema.extend({
    type: z.literal('list_claude_skills'),
    payload: z.object({
        includeDisabled: z.boolean().default(true),
    }).optional(),
});

export const ListClaudeSkillsResponseSchema = BaseResponseSchema.extend({
    type: z.literal('list_claude_skills_response'),
    payload: z.object({
        skills: z.array(ClaudeSkillRecordSchema),
    }),
});

export const GetClaudeSkillCommandSchema = BaseCommandSchema.extend({
    type: z.literal('get_claude_skill'),
    payload: z.object({
        skillId: z.string(),
    }),
});

export const GetClaudeSkillResponseSchema = BaseResponseSchema.extend({
    type: z.literal('get_claude_skill_response'),
    payload: z.object({
        skill: ClaudeSkillRecordSchema.optional(),
    }),
});

export const ImportClaudeSkillCommandSchema = BaseCommandSchema.extend({
    type: z.literal('import_claude_skill'),
    payload: z.object({
        source: ClaudeSkillSourceSchema,
        path: z.string().optional(),
        url: z.string().optional(),
        overwrite: z.boolean().default(false),
        autoInstallDependencies: z.boolean().default(true),
    }),
});

export const ImportClaudeSkillResponseSchema = BaseResponseSchema.extend({
    type: z.literal('import_claude_skill_response'),
    payload: z.object({
        success: z.boolean(),
        skillId: z.string().optional(),
        error: z.string().optional(),
        warnings: z.array(z.string()).optional(),
        dependencyCheck: z.object({
            platformEligible: z.boolean(),
            satisfied: z.boolean(),
            missing: z.array(z.string()),
            canAutoInstall: z.boolean(),
            installPlans: z.array(z.object({
                kind: z.enum(['command', 'download']),
                label: z.string(),
                binary: z.string(),
                runner: z.enum(['brew', 'npm', 'uv', 'pip', 'go', 'winget', 'choco']).optional(),
                command: z.string().optional(),
                url: z.string().optional(),
                extract: z.boolean().optional(),
            })),
            installCommands: z.array(z.string()),
        }).optional(),
        installResults: z.array(z.object({
            kind: z.enum(['command', 'download']),
            label: z.string(),
            success: z.boolean(),
            skipped: z.boolean().optional(),
            error: z.string().optional(),
            output: z.string().optional(),
            binary: z.string().optional(),
            command: z.string().optional(),
            url: z.string().optional(),
            targetPath: z.string().optional(),
        })).optional(),
    }),
});

export const SetClaudeSkillEnabledCommandSchema = BaseCommandSchema.extend({
    type: z.literal('set_claude_skill_enabled'),
    payload: z.object({
        skillId: z.string(),
        enabled: z.boolean(),
    }),
});

export const SetClaudeSkillEnabledResponseSchema = BaseResponseSchema.extend({
    type: z.literal('set_claude_skill_enabled_response'),
    payload: z.object({
        success: z.boolean(),
        skillId: z.string(),
        error: z.string().optional(),
    }),
});

export const RemoveClaudeSkillCommandSchema = BaseCommandSchema.extend({
    type: z.literal('remove_claude_skill'),
    payload: z.object({
        skillId: z.string(),
        deleteFiles: z.boolean().default(true),
    }),
});

export const RemoveClaudeSkillResponseSchema = BaseResponseSchema.extend({
    type: z.literal('remove_claude_skill_response'),
    payload: z.object({
        success: z.boolean(),
        skillId: z.string(),
        error: z.string().optional(),
    }),
});

export const ListDirectivesCommandSchema = BaseCommandSchema.extend({
    type: z.literal('list_directives'),
    payload: z.object({}).optional(),
});

export const ListDirectivesResponseSchema = BaseResponseSchema.extend({
    type: z.literal('list_directives_response'),
    payload: z.object({
        directives: z.array(DirectiveSchema),
    }),
});

export const UpsertDirectiveCommandSchema = BaseCommandSchema.extend({
    type: z.literal('upsert_directive'),
    payload: z.object({
        directive: DirectiveSchema,
    }),
});

export const UpsertDirectiveResponseSchema = BaseResponseSchema.extend({
    type: z.literal('upsert_directive_response'),
    payload: z.object({
        success: z.boolean(),
        directive: DirectiveSchema.optional(),
        error: z.string().optional(),
    }),
});

export const RemoveDirectiveCommandSchema = BaseCommandSchema.extend({
    type: z.literal('remove_directive'),
    payload: z.object({
        directiveId: z.string(),
    }),
});

export const RemoveDirectiveResponseSchema = BaseResponseSchema.extend({
    type: z.literal('remove_directive_response'),
    payload: z.object({
        success: z.boolean(),
        directiveId: z.string(),
        error: z.string().optional(),
    }),
});


// ============================================================================
// Identity and Security Reporting Commands
// ============================================================================

/**
 * Register agent identity for audit and policy context.
 */
export const RegisterAgentIdentityCommandSchema = BaseCommandSchema.extend({
    type: z.literal('register_agent_identity'),
    payload: z.object({
        identity: AgentIdentitySchema,
    }),
});

export const RegisterAgentIdentityResponseSchema = BaseResponseSchema.extend({
    type: z.literal('register_agent_identity_response'),
    payload: z.object({
        success: z.boolean(),
        sessionId: z.string().uuid(),
        error: z.string().optional(),
    }),
});

/**
 * Record a delegation edge between agents.
 */
export const RecordAgentDelegationCommandSchema = BaseCommandSchema.extend({
    type: z.literal('record_agent_delegation'),
    payload: z.object({
        delegation: AgentDelegationSchema,
    }),
});

export const RecordAgentDelegationResponseSchema = BaseResponseSchema.extend({
    type: z.literal('record_agent_delegation_response'),
    payload: z.object({
        success: z.boolean(),
        parentSessionId: z.string().uuid(),
        childSessionId: z.string().uuid(),
        error: z.string().optional(),
    }),
});

/**
 * Report MCP gateway decision for audit/tracing.
 */
export const ReportMcpGatewayDecisionCommandSchema = BaseCommandSchema.extend({
    type: z.literal('report_mcp_gateway_decision'),
    payload: z.object({
        decision: McpGatewayDecisionSchema,
        taskId: z.string().uuid().optional(),
    }),
});

export const ReportMcpGatewayDecisionResponseSchema = BaseResponseSchema.extend({
    type: z.literal('report_mcp_gateway_decision_response'),
    payload: z.object({
        success: z.boolean(),
        error: z.string().optional(),
    }),
});

/**
 * Report runtime security alert for audit/tracing.
 */
export const ReportRuntimeSecurityAlertCommandSchema = BaseCommandSchema.extend({
    type: z.literal('report_runtime_security_alert'),
    payload: z.object({
        alert: RuntimeSecurityAlertSchema,
        taskId: z.string().uuid().optional(),
    }),
});

export const ReportRuntimeSecurityAlertResponseSchema = BaseResponseSchema.extend({
    type: z.literal('report_runtime_security_alert_response'),
    payload: z.object({
        success: z.boolean(),
        error: z.string().optional(),
    }),
});

// ============================================================================
// Repository Scanning & Validation Commands
// ============================================================================

/**
 * Validate a GitHub URL to check if it's a valid skill or MCP server.
 */
export const ValidateGitHubUrlCommandSchema = BaseCommandSchema.extend({
    type: z.literal('validate_github_url'),
    payload: z.object({
        url: z.string(),
        type: z.enum(['skill', 'mcp']),
    }),
});

export const ValidateGitHubUrlResponseSchema = BaseResponseSchema.extend({
    type: z.literal('validate_github_url_response'),
    payload: z.object({
        valid: z.boolean(),
        reason: z.string().optional(),
        preview: z.object({
            name: z.string(),
            description: z.string(),
            runtime: z.string().optional(),
            path: z.string().optional(),
            tools: z.array(z.string()).optional(),
        }).optional(),
    }),
});

/**
 * Scan default GitHub repositories for available skills and MCP servers.
 */
export const ScanDefaultReposCommandSchema = BaseCommandSchema.extend({
    type: z.literal('scan_default_repos'),
    payload: z.object({
        forceRefresh: z.boolean().default(false),
    }).optional(),
});

export const ScanDefaultReposResponseSchema = BaseResponseSchema.extend({
    type: z.literal('scan_default_repos_response'),
    payload: z.object({
        skills: z.array(z.object({
            name: z.string(),
            description: z.string(),
            path: z.string(),
            source: z.string(),
            runtime: z.enum(['python', 'node', 'shell', 'unknown']).optional(),
            hasScripts: z.boolean(),
        })).default([]),
        mcpServers: z.array(z.object({
            name: z.string(),
            description: z.string(),
            path: z.string(),
            source: z.string(),
            runtime: z.enum(['python', 'node', 'unknown']),
            tools: z.array(z.string()).optional(),
        })).default([]),
        errors: z.array(z.string()).default([]),
    }),
});

// ============================================================================
// Workspace Commands
// ============================================================================

/**
 * List available workspaces.
 */
export const ListWorkspacesCommandSchema = BaseCommandSchema.extend({
    type: z.literal('list_workspaces'),
    payload: z.object({}).optional(),
});

export const ListWorkspacesResponseSchema = BaseResponseSchema.extend({
    type: z.literal('list_workspaces_response'),
    payload: z.object({
        workspaces: z.array(z.object({
            id: z.string(),
            name: z.string(),
            path: z.string(),
            autoNamed: z.boolean().optional(),
            lastUsedAt: z.string().datetime().optional(),
        })).default([]),
    }),
});

/**
 * Create a new workspace.
 */
export const CreateWorkspaceCommandSchema = BaseCommandSchema.extend({
    type: z.literal('create_workspace'),
    payload: z.object({
        name: z.string(),
        path: z.string(),
    }),
});

export const CreateWorkspaceResponseSchema = BaseResponseSchema.extend({
    type: z.literal('create_workspace_response'),
    payload: z.object({
        success: z.boolean(),
        workspaceId: z.string().optional(),
        error: z.string().optional(),
    }),
});

/**
 * Delete a workspace.
 */
export const DeleteWorkspaceCommandSchema = BaseCommandSchema.extend({
    type: z.literal('delete_workspace'),
    payload: z.object({
        id: z.string(),
    }),
});

export const DeleteWorkspaceResponseSchema = BaseResponseSchema.extend({
    type: z.literal('delete_workspace_response'),
    payload: z.object({
        success: z.boolean(),
        error: z.string().optional(),
    }),
});

/**
 * Install content from GitHub into a workspace.
 */
export const InstallFromGitHubCommandSchema = BaseCommandSchema.extend({
    type: z.literal('install_from_github'),
    payload: z.object({
        workspacePath: z.string(),
        source: z.string(),
        targetType: z.enum(['skill', 'mcp']),
    }),
});

// ============================================================================
// Tool Reloading Commands
// ============================================================================

/**
 * Reload tools and capabilities from disk.
 * Useful for development to hot-reload changes without restarting sidecar.
 */
export const ReloadToolsCommandSchema = BaseCommandSchema.extend({
    type: z.literal('reload_tools'),
    payload: z.object({
        force: z.boolean().default(false),
    }).optional(),
});

export const ReloadToolsResponseSchema = BaseResponseSchema.extend({
    type: z.literal('reload_tools_response'),
    payload: z.object({
        success: z.boolean(),
        toolCount: z.number(),
        skillCount: z.number(),
        error: z.string().optional(),
    }),
});

export type ReloadToolsCommand = z.infer<typeof ReloadToolsCommandSchema>;
export type ReloadToolsResponse = z.infer<typeof ReloadToolsResponseSchema>;

export const UpdateWorkspaceCommandSchema = BaseCommandSchema.extend({
    type: z.literal('update_workspace'),
    payload: z.object({
        id: z.string(),
        updates: z.object({
            name: z.string().optional(),
            path: z.string().nullable().optional(),
            autoNamed: z.boolean().optional(),
        }),
    }),
});

export const UpdateWorkspaceResponseSchema = BaseResponseSchema.extend({
    type: z.literal('update_workspace_response'),
    payload: z.object({
        success: z.boolean(),
        error: z.string().optional(),
    }),
});

export const InstallFromGitHubResponseSchema = BaseResponseSchema.extend({
    type: z.literal('install_from_github_response'),
    payload: z.object({
        success: z.boolean(),
        path: z.string().optional(),
        filesDownloaded: z.number().optional(),
        importResult: ImportClaudeSkillResponseSchema.shape.payload.optional(),
        error: z.string().optional(),
    }),
});

// ============================================================================
// Core Skills Commands
// ============================================================================

export const GetTasksCommandSchema = BaseCommandSchema.extend({
    type: z.literal('get_tasks'),
    payload: z.object({
        workspacePath: z.string(),
        limit: z.number().optional(),
        status: z.array(z.string()).optional(),
    }),
});

export const GetTasksResponseSchema = BaseResponseSchema.extend({
    type: z.literal('get_tasks_response'),
    payload: z.object({
        success: z.boolean(),
        tasks: z.array(z.any()), // Using any for now to avoid circular deps with Task type
        count: z.number(),
        error: z.string().optional(),
    }),
});

const VoicePlaybackStateSchema = z.object({
    isSpeaking: z.boolean(),
    canStop: z.boolean(),
    previewText: z.string().optional(),
    fullTextLength: z.number().int().nonnegative().optional(),
    taskId: z.string().optional(),
    source: z.string().optional(),
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().optional(),
    reason: z.string().optional(),
    error: z.string().optional(),
});

export const GetVoiceStateCommandSchema = BaseCommandSchema.extend({
    type: z.literal('get_voice_state'),
    payload: z.object({}),
});

export const GetVoiceStateResponseSchema = BaseResponseSchema.extend({
    type: z.literal('get_voice_state_response'),
    payload: z.object({
        success: z.boolean(),
        state: VoicePlaybackStateSchema,
        error: z.string().optional(),
    }),
});

export const StopVoiceCommandSchema = BaseCommandSchema.extend({
    type: z.literal('stop_voice'),
    payload: z.object({}),
});

export const StopVoiceResponseSchema = BaseResponseSchema.extend({
    type: z.literal('stop_voice_response'),
    payload: z.object({
        success: z.boolean(),
        stopped: z.boolean(),
        state: VoicePlaybackStateSchema,
        error: z.string().optional(),
    }),
});

export const GetVoiceProviderStatusCommandSchema = BaseCommandSchema.extend({
    type: z.literal('get_voice_provider_status'),
    payload: z.object({}),
});

export const SpeechProviderRegistrationSchema = z.object({
    id: z.string(),
    kind: z.enum(['asr', 'tts']),
    toolName: z.string(),
    stopToolName: z.string().optional(),
    priority: z.number(),
    sourceSkill: z.string(),
    displayName: z.string(),
});

export const GetVoiceProviderStatusResponseSchema = BaseResponseSchema.extend({
    type: z.literal('get_voice_provider_status_response'),
    payload: z.object({
        success: z.boolean(),
        preferredAsr: z.enum(['custom', 'system']),
        preferredTts: z.enum(['custom', 'system']),
        hasCustomAsr: z.boolean(),
        hasCustomTts: z.boolean(),
        providers: z.object({
            asr: z.array(SpeechProviderRegistrationSchema),
            tts: z.array(SpeechProviderRegistrationSchema),
        }),
        error: z.string().optional(),
    }),
});

export const TranscribeVoiceCommandSchema = BaseCommandSchema.extend({
    type: z.literal('transcribe_voice'),
    payload: z.object({
        audioBase64: z.string(),
        mimeType: z.string().optional(),
        language: z.string().optional(),
    }),
});

export const TranscribeVoiceResponseSchema = BaseResponseSchema.extend({
    type: z.literal('transcribe_voice_response'),
    payload: z.object({
        success: z.boolean(),
        text: z.string().optional(),
        providerId: z.string().optional(),
        providerName: z.string().optional(),
        error: z.string().optional(),
    }),
});

// ============================================================================
// Autonomous Task Commands (OpenClaw-style)
// ============================================================================

export const StartAutonomousTaskCommandSchema = BaseCommandSchema.extend({
    type: z.literal('start_autonomous_task'),
    payload: z.object({
        taskId: z.string(),
        query: z.string(),
        runInBackground: z.boolean().optional(),
        autoSaveMemory: z.boolean().optional(),
    }),
});

export const GetAutonomousTaskStatusCommandSchema = BaseCommandSchema.extend({
    type: z.literal('get_autonomous_task_status'),
    payload: z.object({
        taskId: z.string(),
    }),
});

export const PauseAutonomousTaskCommandSchema = BaseCommandSchema.extend({
    type: z.literal('pause_autonomous_task'),
    payload: z.object({
        taskId: z.string(),
    }),
});

export const ResumeAutonomousTaskCommandSchema = BaseCommandSchema.extend({
    type: z.literal('resume_autonomous_task'),
    payload: z.object({
        taskId: z.string(),
        userInput: z.record(z.string()).optional(),
    }),
});

export const CancelAutonomousTaskCommandSchema = BaseCommandSchema.extend({
    type: z.literal('cancel_autonomous_task'),
    payload: z.object({
        taskId: z.string(),
    }),
});

export const ListAutonomousTasksCommandSchema = BaseCommandSchema.extend({
    type: z.literal('list_autonomous_tasks'),
    payload: z.object({}).optional(),
});

// ============================================================================
// Union Types
// ============================================================================

export const IpcCommandSchema = z.discriminatedUnion('type', [
    BootstrapRuntimeContextCommandSchema,
    StartTaskCommandSchema,
    CancelTaskCommandSchema,
    ClearTaskHistoryCommandSchema,
    SendTaskMessageCommandSchema,
    RequestEffectCommandSchema,
    ReportEffectResultCommandSchema,
    ProposePatchCommandSchema,
    ApplyPatchCommandSchema,
    RejectPatchCommandSchema,
    ReadFileCommandSchema,
    ListDirCommandSchema,
    ExecShellCommandSchema,
    CaptureScreenCommandSchema,
    GetPolicyConfigCommandSchema,
    ListToolpacksCommandSchema,
    GetToolpackCommandSchema,
    InstallToolpackCommandSchema,
    SetToolpackEnabledCommandSchema,
    RemoveToolpackCommandSchema,
    ListClaudeSkillsCommandSchema,
    GetClaudeSkillCommandSchema,
    ImportClaudeSkillCommandSchema,
    SetClaudeSkillEnabledCommandSchema,
    RemoveClaudeSkillCommandSchema,
    ListDirectivesCommandSchema,
    UpsertDirectiveCommandSchema,
    RemoveDirectiveCommandSchema,
    RegisterAgentIdentityCommandSchema,
    RecordAgentDelegationCommandSchema,
    ReportMcpGatewayDecisionCommandSchema,
    ReportRuntimeSecurityAlertCommandSchema,
    ValidateGitHubUrlCommandSchema,
    ScanDefaultReposCommandSchema,
    ListWorkspacesCommandSchema,
    CreateWorkspaceCommandSchema,
    UpdateWorkspaceCommandSchema,
    DeleteWorkspaceCommandSchema,
    InstallFromGitHubCommandSchema,

    ReloadToolsCommandSchema,
    GetTasksCommandSchema,
    GetVoiceStateCommandSchema,
    StopVoiceCommandSchema,
    GetVoiceProviderStatusCommandSchema,
    TranscribeVoiceCommandSchema,

    // Autonomous Task Commands
    StartAutonomousTaskCommandSchema,
    GetAutonomousTaskStatusCommandSchema,
    PauseAutonomousTaskCommandSchema,
    ResumeAutonomousTaskCommandSchema,
    CancelAutonomousTaskCommandSchema,
    ListAutonomousTasksCommandSchema,
]);

export const IpcResponseSchema = z.discriminatedUnion('type', [
    BootstrapRuntimeContextResponseSchema,
    StartTaskResponseSchema,
    CancelTaskResponseSchema,
    ClearTaskHistoryResponseSchema,
    SendTaskMessageResponseSchema,
    RequestEffectResponseSchema,
    ProposePatchResponseSchema,
    ApplyPatchResponseSchema,
    ReadFileResponseSchema,
    ListDirResponseSchema,
    ExecShellResponseSchema,
    CaptureScreenResponseSchema,
    GetPolicyConfigResponseSchema,
    ListToolpacksResponseSchema,
    GetToolpackResponseSchema,
    InstallToolpackResponseSchema,
    SetToolpackEnabledResponseSchema,
    RemoveToolpackResponseSchema,
    ListClaudeSkillsResponseSchema,
    GetClaudeSkillResponseSchema,
    ImportClaudeSkillResponseSchema,
    SetClaudeSkillEnabledResponseSchema,
    RemoveClaudeSkillResponseSchema,
    ListDirectivesResponseSchema,
    UpsertDirectiveResponseSchema,
    RemoveDirectiveResponseSchema,
    RegisterAgentIdentityResponseSchema,
    RecordAgentDelegationResponseSchema,
    ReportMcpGatewayDecisionResponseSchema,
    ReportRuntimeSecurityAlertResponseSchema,
    ValidateGitHubUrlResponseSchema,
    ScanDefaultReposResponseSchema,
    ListWorkspacesResponseSchema,
    CreateWorkspaceResponseSchema,
    UpdateWorkspaceResponseSchema,
    DeleteWorkspaceResponseSchema,
    InstallFromGitHubResponseSchema,
    ReloadToolsCommandSchema,
    ReloadToolsResponseSchema,
    GetTasksResponseSchema,
    GetVoiceStateResponseSchema,
    StopVoiceResponseSchema,
    GetVoiceProviderStatusResponseSchema,
    TranscribeVoiceResponseSchema,
]);

export type IpcCommand = z.infer<typeof IpcCommandSchema>;
export type IpcResponse = z.infer<typeof IpcResponseSchema>;

// Individual types
export type RuntimeBinaryInfo = z.infer<typeof RuntimeBinaryInfoSchema>;
export type ManagedServiceCapability = z.infer<typeof ManagedServiceCapabilitySchema>;
export type PlatformRuntimeContext = z.infer<typeof PlatformRuntimeContextSchema>;
export type BootstrapRuntimeContextCommand = z.infer<typeof BootstrapRuntimeContextCommandSchema>;
export type BootstrapRuntimeContextResponse = z.infer<typeof BootstrapRuntimeContextResponseSchema>;
export type StartTaskCommand = z.infer<typeof StartTaskCommandSchema>;
export type CancelTaskCommand = z.infer<typeof CancelTaskCommandSchema>;
export type ClearTaskHistoryCommand = z.infer<typeof ClearTaskHistoryCommandSchema>;
export type ClearTaskHistoryResponse = z.infer<typeof ClearTaskHistoryResponseSchema>;
export type SendTaskMessageCommand = z.infer<typeof SendTaskMessageCommandSchema>;
export type SendTaskMessageResponse = z.infer<typeof SendTaskMessageResponseSchema>;
export type RequestEffectCommand = z.infer<typeof RequestEffectCommandSchema>;
export type ApplyPatchCommand = z.infer<typeof ApplyPatchCommandSchema>;
export type ExecShellCommand = z.infer<typeof ExecShellCommandSchema>;
export type ToolpackRuntime = z.infer<typeof ToolpackRuntimeSchema>;
export type ToolpackSource = z.infer<typeof ToolpackSourceSchema>;
export type ToolpackManifest = z.infer<typeof ToolpackManifestSchema>;
export type ToolpackRecord = z.infer<typeof ToolpackRecordSchema>;
export type ListToolpacksCommand = z.infer<typeof ListToolpacksCommandSchema>;
export type ListToolpacksResponse = z.infer<typeof ListToolpacksResponseSchema>;
export type GetToolpackCommand = z.infer<typeof GetToolpackCommandSchema>;
export type GetToolpackResponse = z.infer<typeof GetToolpackResponseSchema>;
export type InstallToolpackCommand = z.infer<typeof InstallToolpackCommandSchema>;
export type InstallToolpackResponse = z.infer<typeof InstallToolpackResponseSchema>;
export type SetToolpackEnabledCommand = z.infer<typeof SetToolpackEnabledCommandSchema>;
export type SetToolpackEnabledResponse = z.infer<typeof SetToolpackEnabledResponseSchema>;
export type RemoveToolpackCommand = z.infer<typeof RemoveToolpackCommandSchema>;
export type RemoveToolpackResponse = z.infer<typeof RemoveToolpackResponseSchema>;
export type ClaudeSkillSource = z.infer<typeof ClaudeSkillSourceSchema>;
export type ClaudeSkillManifest = z.infer<typeof ClaudeSkillManifestSchema>;
export type ClaudeSkillRecord = z.infer<typeof ClaudeSkillRecordSchema>;
export type ListClaudeSkillsCommand = z.infer<typeof ListClaudeSkillsCommandSchema>;
export type ListClaudeSkillsResponse = z.infer<typeof ListClaudeSkillsResponseSchema>;
export type GetClaudeSkillCommand = z.infer<typeof GetClaudeSkillCommandSchema>;
export type GetClaudeSkillResponse = z.infer<typeof GetClaudeSkillResponseSchema>;
export type ImportClaudeSkillCommand = z.infer<typeof ImportClaudeSkillCommandSchema>;
export type ImportClaudeSkillResponse = z.infer<typeof ImportClaudeSkillResponseSchema>;
export type SetClaudeSkillEnabledCommand = z.infer<typeof SetClaudeSkillEnabledCommandSchema>;
export type SetClaudeSkillEnabledResponse = z.infer<typeof SetClaudeSkillEnabledResponseSchema>;
export type RemoveClaudeSkillCommand = z.infer<typeof RemoveClaudeSkillCommandSchema>;
export type Directive = z.infer<typeof DirectiveSchema>;
export type ListDirectivesCommand = z.infer<typeof ListDirectivesCommandSchema>;
export type ListDirectivesResponse = z.infer<typeof ListDirectivesResponseSchema>;
export type UpsertDirectiveCommand = z.infer<typeof UpsertDirectiveCommandSchema>;
export type UpsertDirectiveResponse = z.infer<typeof UpsertDirectiveResponseSchema>;
export type RemoveDirectiveCommand = z.infer<typeof RemoveDirectiveCommandSchema>;
export type RemoveDirectiveResponse = z.infer<typeof RemoveDirectiveResponseSchema>;
export type RemoveClaudeSkillResponse = z.infer<typeof RemoveClaudeSkillResponseSchema>;
export type RegisterAgentIdentityCommand = z.infer<typeof RegisterAgentIdentityCommandSchema>;
export type RegisterAgentIdentityResponse = z.infer<typeof RegisterAgentIdentityResponseSchema>;
export type RecordAgentDelegationCommand = z.infer<typeof RecordAgentDelegationCommandSchema>;
export type RecordAgentDelegationResponse = z.infer<typeof RecordAgentDelegationResponseSchema>;
export type ReportMcpGatewayDecisionCommand = z.infer<typeof ReportMcpGatewayDecisionCommandSchema>;
export type ReportMcpGatewayDecisionResponse = z.infer<typeof ReportMcpGatewayDecisionResponseSchema>;
export type ReportRuntimeSecurityAlertCommand = z.infer<typeof ReportRuntimeSecurityAlertCommandSchema>;
export type ReportRuntimeSecurityAlertResponse = z.infer<typeof ReportRuntimeSecurityAlertResponseSchema>;
export type ValidateGitHubUrlCommand = z.infer<typeof ValidateGitHubUrlCommandSchema>;
export type ValidateGitHubUrlResponse = z.infer<typeof ValidateGitHubUrlResponseSchema>;
export type ScanDefaultReposCommand = z.infer<typeof ScanDefaultReposCommandSchema>;
export type ScanDefaultReposResponse = z.infer<typeof ScanDefaultReposResponseSchema>;
export type ListWorkspacesCommand = z.infer<typeof ListWorkspacesCommandSchema>;
export type ListWorkspacesResponse = z.infer<typeof ListWorkspacesResponseSchema>;
export type CreateWorkspaceCommand = z.infer<typeof CreateWorkspaceCommandSchema>;
export type CreateWorkspaceResponse = z.infer<typeof CreateWorkspaceResponseSchema>;
export type UpdateWorkspaceCommand = z.infer<typeof UpdateWorkspaceCommandSchema>;
export type UpdateWorkspaceResponse = z.infer<typeof UpdateWorkspaceResponseSchema>;
export type DeleteWorkspaceCommand = z.infer<typeof DeleteWorkspaceCommandSchema>;
export type DeleteWorkspaceResponse = z.infer<typeof DeleteWorkspaceResponseSchema>;
export type InstallFromGitHubCommand = z.infer<typeof InstallFromGitHubCommandSchema>;
export type InstallFromGitHubResponse = z.infer<typeof InstallFromGitHubResponseSchema>;
export type GetTasksCommand = z.infer<typeof GetTasksCommandSchema>;
export type GetTasksResponse = z.infer<typeof GetTasksResponseSchema>;
export type GetVoiceStateCommand = z.infer<typeof GetVoiceStateCommandSchema>;
export type GetVoiceStateResponse = z.infer<typeof GetVoiceStateResponseSchema>;
export type StopVoiceCommand = z.infer<typeof StopVoiceCommandSchema>;
export type StopVoiceResponse = z.infer<typeof StopVoiceResponseSchema>;
export type GetVoiceProviderStatusCommand = z.infer<typeof GetVoiceProviderStatusCommandSchema>;
export type GetVoiceProviderStatusResponse = z.infer<typeof GetVoiceProviderStatusResponseSchema>;
export type TranscribeVoiceCommand = z.infer<typeof TranscribeVoiceCommandSchema>;
export type TranscribeVoiceResponse = z.infer<typeof TranscribeVoiceResponseSchema>;
