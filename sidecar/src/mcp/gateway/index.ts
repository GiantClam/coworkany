// sidecar/src/mcp/gateway/index.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
    ToolpackManifestSchema,
    type ToolpackManifest,
    type EffectType,
    type EffectRequest,
    type McpGatewayDecision,
} from '../../protocol';
import { PolicyBridge, createFilesystemWriteRequest, createShellWriteRequest } from '../../bridges';

// ============================================================================
// Types
// ============================================================================

type MCPServer = {
    name: string;
    transport: StdioClientTransport;
    client: Client;
    manifest: ToolpackManifest;
    riskScore: number;
    authenticated: boolean;
    healthStatus: 'healthy' | 'degraded' | 'down';
};

type ToolCallContext = {
    sessionId: string;
    toolName: string;
    serverName: string;
    arguments: Record<string, unknown>;
    effectType?: EffectType;
};

type PolicyDecision = {
    allow: boolean;
    reason?: string;
    scopeRestrictions?: {
        allowlist?: string[];
        denylist?: string[];
        redactPatterns?: string[];
    };
};

// ============================================================================
// MCP Gateway
// ============================================================================

export class MCPGateway {
    private servers = new Map<string, MCPServer>();
    private toolRegistry = new Map<string, { server: string; tool: Tool }>();
    private riskDatabase = new RiskDatabase();
    private auditLogger = new AuditLogger();
    private policyBridge: PolicyBridge | null = null;

    /**
     * Set the PolicyBridge for IPC with Tauri PolicyEngine
     */
    setPolicyBridge(bridge: PolicyBridge): void {
        this.policyBridge = bridge;
    }

    // =========================================================================
    // Server lifecycle
    // =========================================================================

    async registerServer(manifestInput: ToolpackManifest, workingDir: string): Promise<void> {
        const manifest = ToolpackManifestSchema.parse(manifestInput);

        if (manifest.signature) {
            const isValid = await this.verifySignature(manifest);
            if (!isValid) {
                throw new Error(`Invalid signature for toolpack: ${manifest.name}`);
            }
        }

        const riskScore = await this.riskDatabase.calculateRisk(manifest);
        if (riskScore > 80) {
            throw new Error(`Toolpack ${manifest.name} exceeds risk threshold: ${riskScore}`);
        }

        const entry = manifest.entry ?? manifest.name;
        const transport = new StdioClientTransport({
            command: this.getRuntimeCommand(manifest.runtime ?? 'node'),
            args: [entry],
            cwd: workingDir,
            env: {
                ...process.env,
                MCP_TOOLPACK_NAME: manifest.name,
            },
            stderr: 'pipe',
        });

        const client = new Client(
            {
                name: `gateway-${manifest.name}`,
                version: '1.0.0',
            },
            {
                capabilities: {},
            }
        );

        await client.connect(transport);
        const { tools } = await client.listTools();

        const server: MCPServer = {
            name: manifest.name,
            transport,
            client,
            manifest,
            riskScore,
            authenticated: true,
            healthStatus: 'healthy',
        };

        this.servers.set(manifest.name, server);

        for (const tool of tools) {
            const toolKey = `${manifest.name}:${tool.name}`;
            this.toolRegistry.set(toolKey, { server: manifest.name, tool });
        }
    }

    async unregisterServer(serverName: string): Promise<void> {
        const server = this.servers.get(serverName);
        if (!server) return;

        for (const [key, value] of this.toolRegistry.entries()) {
            if (value.server === serverName) {
                this.toolRegistry.delete(key);
            }
        }

        await server.client.close();
        this.servers.delete(serverName);
    }

    // =========================================================================
    // Tool execution
    // =========================================================================

    async callTool(context: ToolCallContext): Promise<unknown> {
        const toolEntry = this.toolRegistry.get(`${context.serverName}:${context.toolName}`);
        if (!toolEntry) {
            throw new Error(`Tool not found: ${context.serverName}:${context.toolName}`);
        }

        const server = this.servers.get(context.serverName);
        if (!server) {
            throw new Error(`Server not connected: ${context.serverName}`);
        }

        const startTime = Date.now();
        const policy = await this.enforcePolicy(context, server);
        const durationMs = Date.now() - startTime;

        // Report decision to Rust Policy Gate for audit
        await this.reportPolicyDecision(context, policy, server.riskScore, durationMs);

        if (!policy.allow) {
            this.auditLogger.logDenial(context, policy.reason);
            throw new Error(`Policy denied: ${policy.reason}`);
        }

        const sanitizedArgs = this.sanitizeArguments(context.arguments, policy.scopeRestrictions);

        try {
            const result = await server.client.callTool({
                name: context.toolName,
                arguments: sanitizedArgs,
            });

            this.auditLogger.logSuccess(context, result);
            return result.content;
        } catch (error) {
            this.auditLogger.logError(context, error);
            throw error;
        }
    }

    getAvailableTools(): Array<{ server: string; tool: Tool }> {
        return Array.from(this.toolRegistry.values());
    }

    async healthCheck(): Promise<Map<string, 'healthy' | 'degraded' | 'down'>> {
        const status = new Map<string, 'healthy' | 'degraded' | 'down'>();

        for (const [name, server] of this.servers.entries()) {
            try {
                await server.client.listTools();
                server.healthStatus = 'healthy';
                status.set(name, 'healthy');
            } catch {
                server.healthStatus = 'down';
                status.set(name, 'down');
            }
        }

        return status;
    }

    // =========================================================================
    // Policy enforcement
    // =========================================================================

    private async enforcePolicy(
        context: ToolCallContext,
        server: MCPServer
    ): Promise<PolicyDecision> {
        if (server.healthStatus === 'down') {
            return { allow: false, reason: 'Server is down' };
        }

        const effectType = context.effectType ?? this.inferEffectType(context.toolName, context.arguments);
        if (effectType && !server.manifest.effects.includes(effectType)) {
            return {
                allow: false,
                reason: `Server not authorized for effect: ${effectType}`,
            };
        }

        if (server.riskScore > 60) {
            this.auditLogger.logWarning(context, `High-risk tool call (score ${server.riskScore})`);
        }

        // If PolicyBridge is configured, delegate to Tauri PolicyEngine
        if (this.policyBridge && effectType) {
            try {
                const effectRequest = this.buildEffectRequest(context, effectType, server);
                const response = await this.policyBridge.requestEffect(effectRequest);

                if (!response.approved) {
                    return {
                        allow: false,
                        reason: response.denialReason || 'Policy denied',
                    };
                }

                // Apply any scope restrictions from policy
                return {
                    allow: true,
                    scopeRestrictions: response.modifiedScope ? {
                        allowlist: response.modifiedScope.commandAllowlist,
                        denylist: response.modifiedScope.commandBlocklist,
                    } : this.buildRestrictions(effectType),
                };
            } catch (error) {
                this.auditLogger.logError(context, error);
                return {
                    allow: false,
                    reason: `Policy check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                };
            }
        }

        // Fallback to local policy (when PolicyBridge not configured)
        return {
            allow: true,
            scopeRestrictions: this.buildRestrictions(effectType),
        };
    }

    /**
     * Build an EffectRequest from tool call context
     */
    private buildEffectRequest(
        context: ToolCallContext,
        effectType: EffectType,
        server: MCPServer
    ): EffectRequest {
        const id = crypto.randomUUID();

        const payload: EffectRequest['payload'] = {
            description: `Tool call: ${context.toolName}`,
        };

        // Conditionally add properties to avoid spread type errors
        if (context.arguments.path) {
            payload.path = String(context.arguments.path);
        }
        if (context.arguments.command) {
            payload.command = String(context.arguments.command);
        }
        if (context.arguments.url) {
            payload.url = String(context.arguments.url);
        }

        return {
            id,
            timestamp: new Date().toISOString(),
            effectType,
            source: 'toolpack',
            sourceId: server.name,
            payload,
            context: {
                taskId: context.sessionId,
                toolName: `${server.name}:${context.toolName}`,
                reasoning: `MCP Toolpack ${server.name} invoked tool ${context.toolName}`,
            },
        };
    }

    private inferEffectType(
        toolName: string,
        args: Record<string, unknown>
    ): EffectType | undefined {
        void args;
        if (toolName.includes('write') || toolName.includes('create')) {
            return 'filesystem:write';
        }
        if (toolName.includes('execute') || toolName.includes('run')) {
            return 'shell:write';
        }
        if (toolName.includes('fetch') || toolName.includes('request')) {
            return 'network:outbound';
        }
        return undefined;
    }

    private buildRestrictions(effectType: EffectType | undefined): PolicyDecision['scopeRestrictions'] {
        if (!effectType) return undefined;
        return {
            redactPatterns: ['password', 'token', 'api_key', 'secret'],
        };
    }

    private sanitizeArguments(
        args: Record<string, unknown>,
        restrictions?: PolicyDecision['scopeRestrictions']
    ): Record<string, unknown> {
        if (!restrictions?.redactPatterns) return args;

        const sanitized: Record<string, unknown> = { ...args };
        for (const key of Object.keys(sanitized)) {
            if (typeof sanitized[key] === 'string') {
                for (const pattern of restrictions.redactPatterns) {
                    if (key.toLowerCase().includes(pattern.toLowerCase())) {
                        sanitized[key] = '[REDACTED]';
                    }
                }
            }
        }
        return sanitized;
    }

    // =========================================================================
    // Utilities
    // =========================================================================

    private getRuntimeCommand(runtime: ToolpackManifest['runtime'] | 'other'): string {
        switch (runtime) {
            case 'node':
                return 'node';
            case 'bun':
                return 'bun';
            case 'python':
                return 'python3';
            case 'other':
                throw new Error('Unsupported runtime: other');
            default:
                throw new Error(`Unsupported runtime: ${runtime}`);
        }
    }

    private async verifySignature(manifest: ToolpackManifest): Promise<boolean> {
        void manifest;
        return true;
    }

    /**
     * Report a policy decision to the Rust Policy Gate for audit logging.
     * This sends the decision via stdout IPC to be picked up by sidecar.rs.
     */
    private async reportPolicyDecision(
        context: ToolCallContext,
        decision: PolicyDecision,
        riskScore: number,
        durationMs: number
    ): Promise<void> {
        const report: McpGatewayDecision = {
            serverId: context.serverName,
            toolName: context.toolName,
            decision: decision.allow ? 'allow' : 'deny',
            riskScore: Math.min(10, Math.max(1, Math.ceil(riskScore / 10))),
            reason: decision.reason,
            durationMs,
        };

        // Send via stdout IPC - sidecar.rs will pick this up and forward to Rust Policy Gate
        const ipcCommand = {
            type: 'report_mcp_gateway_decision',
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            payload: { decision: report },
        };

        console.log(JSON.stringify(ipcCommand));
    }
}

// ============================================================================
// Risk database
// ============================================================================

class RiskDatabase {
    private knownRisks = new Map<string, number>([
        ['untrusted-shell-executor', 95],
        ['file-destroyer', 90],
    ]);

    async calculateRisk(manifest: ToolpackManifest): Promise<number> {
        if (this.knownRisks.has(manifest.name)) {
            return this.knownRisks.get(manifest.name) ?? 0;
        }

        let baseRisk = 0;
        const riskWeights: Record<string, number> = {
            'filesystem:read': 10,
            'filesystem:write': 60,
            'shell:read': 20,
            'shell:write': 80,
            'network:outbound': 40,
            'secrets:read': 90,
            'screen:capture': 30,
            'ui:control': 95,
        };

        for (const effect of manifest.effects) {
            baseRisk = Math.max(baseRisk, riskWeights[effect] ?? 0);
        }

        if (!manifest.signature) {
            baseRisk += 20;
        }

        return Math.min(baseRisk, 100);
    }

    async updateRiskScore(toolpackName: string, score: number): Promise<void> {
        this.knownRisks.set(toolpackName, score);
    }
}

// ============================================================================
// Audit logger
// ============================================================================

class AuditLogger {
    logSuccess(context: ToolCallContext, result: unknown): void {
        void result;
        console.log(`[Audit] SUCCESS: ${context.serverName}:${context.toolName}`);
    }

    logWarning(context: ToolCallContext, message: string): void {
        console.warn(`[Audit] WARNING: ${context.serverName}:${context.toolName} - ${message}`);
    }

    logDenial(context: ToolCallContext, reason?: string): void {
        console.error(`[Audit] DENIED: ${context.serverName}:${context.toolName} - ${reason ?? 'unknown'}`);
    }

    logError(context: ToolCallContext, error: unknown): void {
        console.error(`[Audit] ERROR: ${context.serverName}:${context.toolName}`, error);
    }
}
