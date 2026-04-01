import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export type McpServerScope = 'managed' | 'project' | 'user';

export type McpServerDefinition = {
    id: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    scope: McpServerScope;
    enabled: boolean;
    approved: boolean;
    source: 'builtin' | 'workspace';
    description?: string;
};

export type McpServerPolicyDecision = {
    id: string;
    allowed: boolean;
    reason: 'disabled' | 'approval_required' | 'allowed';
    scope: McpServerScope;
};

export type McpServerSecuritySnapshot = {
    servers: McpServerDefinition[];
    decisions: McpServerPolicyDecision[];
    allowedServerIds: string[];
    blockedServerIds: string[];
    signature: string;
    updatedAt: string;
};

type PersistedRecord = {
    id: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    scope?: McpServerScope;
    enabled?: boolean;
    approved?: boolean;
    description?: string;
};

const STORE_RELATIVE_PATH = path.join('.coworkany', 'mcp-servers.json');

function normalizeServerId(value: string): string {
    return value.trim().toLowerCase();
}

function isValidServerId(value: string): boolean {
    return /^[a-z0-9._-]{2,64}$/u.test(value);
}

function sanitizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

function sanitizeEnvRecord(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const output: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        if (typeof raw !== 'string') {
            continue;
        }
        const envKey = key.trim();
        if (!envKey) {
            continue;
        }
        output[envKey] = raw;
    }
    return Object.keys(output).length > 0 ? output : undefined;
}

function toScope(value: unknown): McpServerScope {
    return value === 'managed' || value === 'user' ? value : 'project';
}

function createBuiltinServers(): McpServerDefinition[] {
    return [{
        id: 'playwright',
        command: 'npx',
        args: ['-y', '@playwright/mcp@latest'],
        scope: 'managed',
        enabled: true,
        approved: true,
        source: 'builtin',
        description: 'Managed Playwright MCP server',
    }];
}

function toPersistedRecord(entry: McpServerDefinition): PersistedRecord {
    return {
        id: entry.id,
        command: entry.command,
        args: entry.args,
        env: entry.env,
        scope: entry.scope,
        enabled: entry.enabled,
        approved: entry.approved,
        description: entry.description,
    };
}

function computeSignature(payload: unknown): string {
    return createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

function evaluatePolicy(entry: McpServerDefinition): McpServerPolicyDecision {
    if (!entry.enabled) {
        return {
            id: entry.id,
            allowed: false,
            reason: 'disabled',
            scope: entry.scope,
        };
    }
    if (entry.scope === 'user' && entry.approved !== true) {
        return {
            id: entry.id,
            allowed: false,
            reason: 'approval_required',
            scope: entry.scope,
        };
    }
    return {
        id: entry.id,
        allowed: true,
        reason: 'allowed',
        scope: entry.scope,
    };
}

export class McpServerSecurityStore {
    private readonly storePath: string;
    private readonly entries = new Map<string, McpServerDefinition>();
    private updatedAt = new Date(0).toISOString();

    constructor(workspaceRoot: string) {
        this.storePath = path.join(workspaceRoot, STORE_RELATIVE_PATH);
        this.reload();
    }

    reload(): void {
        this.entries.clear();
        for (const builtin of createBuiltinServers()) {
            this.entries.set(builtin.id, builtin);
        }
        if (!fs.existsSync(this.storePath)) {
            this.updatedAt = new Date().toISOString();
            return;
        }
        try {
            const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf-8')) as unknown;
            const records = raw && typeof raw === 'object' && !Array.isArray(raw)
                ? raw as Record<string, unknown>
                : {};
            for (const [key, value] of Object.entries(records)) {
                if (!value || typeof value !== 'object' || Array.isArray(value)) {
                    continue;
                }
                const row = value as PersistedRecord;
                const id = normalizeServerId(typeof row.id === 'string' ? row.id : key);
                if (!isValidServerId(id)) {
                    continue;
                }
                const command = typeof row.command === 'string' ? row.command.trim() : '';
                if (!command) {
                    continue;
                }
                const args = sanitizeStringArray(row.args);
                this.entries.set(id, {
                    id,
                    command,
                    args,
                    env: sanitizeEnvRecord(row.env),
                    scope: toScope(row.scope),
                    enabled: row.enabled !== false,
                    approved: row.approved === true,
                    source: 'workspace',
                    description: typeof row.description === 'string' ? row.description : undefined,
                });
            }
            this.updatedAt = new Date().toISOString();
        } catch (error) {
            console.warn('[McpServerSecurityStore] Failed to load store:', error);
        }
    }

    list(): McpServerDefinition[] {
        return Array.from(this.entries.values()).sort((left, right) => left.id.localeCompare(right.id));
    }

    upsert(input: {
        id: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
        scope?: McpServerScope;
        enabled?: boolean;
        approved?: boolean;
        description?: string;
    }): { success: boolean; error?: string; server?: McpServerDefinition } {
        const id = normalizeServerId(input.id);
        if (!isValidServerId(id)) {
            return { success: false, error: 'invalid_server_id' };
        }
        const command = input.command.trim();
        if (!command) {
            return { success: false, error: 'missing_command' };
        }
        const existing = this.entries.get(id);
        if (existing?.source === 'builtin') {
            return { success: false, error: 'cannot_override_builtin_server' };
        }
        const scope = input.scope ?? existing?.scope ?? 'project';
        const next: McpServerDefinition = {
            id,
            command,
            args: sanitizeStringArray(input.args ?? existing?.args ?? []),
            env: sanitizeEnvRecord(input.env ?? existing?.env),
            scope,
            enabled: input.enabled ?? existing?.enabled ?? true,
            approved: scope === 'managed' ? true : (input.approved ?? existing?.approved ?? false),
            source: 'workspace',
            description: typeof input.description === 'string'
                ? input.description
                : existing?.description,
        };
        this.entries.set(id, next);
        this.save();
        return { success: true, server: next };
    }

    setEnabled(idInput: string, enabled: boolean): { success: boolean; error?: string; server?: McpServerDefinition } {
        const id = normalizeServerId(idInput);
        const existing = this.entries.get(id);
        if (!existing) {
            return { success: false, error: 'server_not_found' };
        }
        const next = {
            ...existing,
            enabled,
        };
        this.entries.set(id, next);
        this.save();
        return { success: true, server: next };
    }

    setApproval(idInput: string, approved: boolean): { success: boolean; error?: string; server?: McpServerDefinition } {
        const id = normalizeServerId(idInput);
        const existing = this.entries.get(id);
        if (!existing) {
            return { success: false, error: 'server_not_found' };
        }
        if (existing.scope === 'managed') {
            return { success: false, error: 'managed_server_approval_immutable' };
        }
        const next = {
            ...existing,
            approved,
        };
        this.entries.set(id, next);
        this.save();
        return { success: true, server: next };
    }

    remove(idInput: string): { success: boolean; error?: string } {
        const id = normalizeServerId(idInput);
        const existing = this.entries.get(id);
        if (!existing) {
            return { success: false, error: 'server_not_found' };
        }
        if (existing.source === 'builtin') {
            return { success: false, error: 'cannot_remove_builtin_server' };
        }
        this.entries.delete(id);
        this.save();
        return { success: true };
    }

    buildSnapshot(): McpServerSecuritySnapshot {
        const servers = this.list();
        const decisions = servers.map((entry) => evaluatePolicy(entry));
        const allowedServerIds = decisions.filter((entry) => entry.allowed).map((entry) => entry.id);
        const blockedServerIds = decisions.filter((entry) => !entry.allowed).map((entry) => entry.id);
        return {
            servers,
            decisions,
            allowedServerIds,
            blockedServerIds,
            signature: computeSignature({
                servers,
                decisions,
            }),
            updatedAt: this.updatedAt,
        };
    }

    private save(): void {
        try {
            const dir = path.dirname(this.storePath);
            fs.mkdirSync(dir, { recursive: true });
            const persisted: Record<string, PersistedRecord> = {};
            for (const entry of this.entries.values()) {
                if (entry.source === 'builtin') {
                    continue;
                }
                persisted[entry.id] = toPersistedRecord(entry);
            }
            fs.writeFileSync(this.storePath, JSON.stringify(persisted, null, 2), 'utf-8');
            this.updatedAt = new Date().toISOString();
        } catch (error) {
            console.warn('[McpServerSecurityStore] Failed to save store:', error);
        }
    }
}

export function toMastraServerMap(snapshot: McpServerSecuritySnapshot): Record<string, {
    command: string;
    args: string[];
    env?: Record<string, string>;
}> {
    const allowed = new Set(snapshot.allowedServerIds);
    const output: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
    for (const server of snapshot.servers) {
        if (!allowed.has(server.id)) {
            continue;
        }
        output[server.id] = {
            command: server.command,
            args: server.args,
            env: server.env,
        };
    }
    return output;
}
