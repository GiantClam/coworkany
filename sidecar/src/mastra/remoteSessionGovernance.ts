import * as fs from 'fs';
import * as path from 'path';

export type RemoteSessionConflictStrategy = 'reject' | 'takeover' | 'takeover_if_stale';

export type RemoteSessionGovernancePolicy = {
    conflictStrategy: RemoteSessionConflictStrategy;
    staleAfterMs: number;
    enforceTenantIsolation: boolean;
    requireTenantIdForManaged: boolean;
    requireEndpointIdForManaged: boolean;
    enforceEndpointIsolation: boolean;
    enforceManagedIdentityImmutable: boolean;
    requireTenantIdForManagedCommands: boolean;
};

type RawRemoteSessionGovernance = {
    conflictStrategy?: unknown;
    staleAfterMs?: unknown;
    enforceTenantIsolation?: unknown;
    requireTenantIdForManaged?: unknown;
    requireEndpointIdForManaged?: unknown;
    enforceEndpointIsolation?: unknown;
    enforceManagedIdentityImmutable?: unknown;
    requireTenantIdForManagedCommands?: unknown;
};

type RawPolicySettings = {
    remoteSessionGovernance?: unknown;
};

export const DEFAULT_REMOTE_SESSION_GOVERNANCE_POLICY: RemoteSessionGovernancePolicy = {
    conflictStrategy: 'reject',
    staleAfterMs: 5 * 60 * 1000,
    enforceTenantIsolation: false,
    requireTenantIdForManaged: false,
    requireEndpointIdForManaged: false,
    enforceEndpointIsolation: false,
    enforceManagedIdentityImmutable: false,
    requireTenantIdForManagedCommands: false,
};

function parseBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
        return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
        return false;
    }
    return undefined;
}

function parseBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number'
        ? value
        : (typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    if (parsed < min) {
        return min;
    }
    if (parsed > max) {
        return max;
    }
    return Math.floor(parsed);
}

function parseConflictStrategy(value: unknown): RemoteSessionConflictStrategy | undefined {
    if (value === 'reject' || value === 'takeover' || value === 'takeover_if_stale') {
        return value;
    }
    return undefined;
}

function getPolicySettingsPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.coworkany', 'policy-settings.json');
}

function loadRawRemoteSessionGovernance(workspaceRoot: string): RawRemoteSessionGovernance {
    const settingsPath = getPolicySettingsPath(workspaceRoot);
    if (!fs.existsSync(settingsPath)) {
        return {};
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        const settings = parsed as RawPolicySettings;
        const governance = settings.remoteSessionGovernance;
        if (!governance || typeof governance !== 'object' || Array.isArray(governance)) {
            return {};
        }
        return governance as RawRemoteSessionGovernance;
    } catch {
        return {};
    }
}

export function loadRemoteSessionGovernancePolicy(
    workspaceRoot: string,
    env: Record<string, string | undefined> = process.env,
): RemoteSessionGovernancePolicy {
    const fileConfig = loadRawRemoteSessionGovernance(workspaceRoot);
    const conflictStrategy = parseConflictStrategy(
        env.COWORKANY_REMOTE_SESSION_CONFLICT_STRATEGY ?? fileConfig.conflictStrategy,
    ) ?? DEFAULT_REMOTE_SESSION_GOVERNANCE_POLICY.conflictStrategy;
    const staleAfterMs = parseBoundedInt(
        env.COWORKANY_REMOTE_SESSION_STALE_AFTER_MS ?? fileConfig.staleAfterMs,
        DEFAULT_REMOTE_SESSION_GOVERNANCE_POLICY.staleAfterMs,
        1_000,
        7 * 24 * 60 * 60 * 1000,
    );
    const enforceTenantIsolation = parseBoolean(
        env.COWORKANY_REMOTE_SESSION_ENFORCE_TENANT_ISOLATION ?? fileConfig.enforceTenantIsolation,
    ) ?? DEFAULT_REMOTE_SESSION_GOVERNANCE_POLICY.enforceTenantIsolation;
    const requireTenantIdForManaged = parseBoolean(
        env.COWORKANY_REMOTE_SESSION_REQUIRE_TENANT_ID_FOR_MANAGED ?? fileConfig.requireTenantIdForManaged,
    ) ?? DEFAULT_REMOTE_SESSION_GOVERNANCE_POLICY.requireTenantIdForManaged;
    const enforceEndpointIsolation = parseBoolean(
        env.COWORKANY_REMOTE_SESSION_ENFORCE_ENDPOINT_ISOLATION ?? fileConfig.enforceEndpointIsolation,
    ) ?? DEFAULT_REMOTE_SESSION_GOVERNANCE_POLICY.enforceEndpointIsolation;
    const requireEndpointIdForManaged = parseBoolean(
        env.COWORKANY_REMOTE_SESSION_REQUIRE_ENDPOINT_ID_FOR_MANAGED ?? fileConfig.requireEndpointIdForManaged,
    ) ?? DEFAULT_REMOTE_SESSION_GOVERNANCE_POLICY.requireEndpointIdForManaged;
    const enforceManagedIdentityImmutable = parseBoolean(
        env.COWORKANY_REMOTE_SESSION_ENFORCE_MANAGED_IDENTITY_IMMUTABLE ?? fileConfig.enforceManagedIdentityImmutable,
    ) ?? DEFAULT_REMOTE_SESSION_GOVERNANCE_POLICY.enforceManagedIdentityImmutable;
    const requireTenantIdForManagedCommands = parseBoolean(
        env.COWORKANY_REMOTE_SESSION_REQUIRE_TENANT_ID_FOR_MANAGED_COMMANDS
            ?? fileConfig.requireTenantIdForManagedCommands,
    ) ?? DEFAULT_REMOTE_SESSION_GOVERNANCE_POLICY.requireTenantIdForManagedCommands;
    return {
        conflictStrategy,
        staleAfterMs,
        enforceTenantIsolation,
        requireTenantIdForManaged,
        requireEndpointIdForManaged,
        enforceEndpointIsolation,
        enforceManagedIdentityImmutable,
        requireTenantIdForManagedCommands,
    };
}
