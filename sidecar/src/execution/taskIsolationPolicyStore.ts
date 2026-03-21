import { createHash } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import type {
    MemoryIsolationPolicy,
    MemoryScope,
    SessionIsolationPolicy,
    TenantIsolationPolicy,
} from '../orchestration/workRequestSchema';

export type ResolvedTaskIsolationPolicy = {
    workspacePath: string;
    sessionIsolationPolicy: SessionIsolationPolicy;
    memoryIsolationPolicy: MemoryIsolationPolicy;
    tenantIsolationPolicy: TenantIsolationPolicy;
    resolvedTenant: {
        workspaceTenantKey: string;
        userTenantKey: string;
    };
};

const taskPolicies = new Map<string, ResolvedTaskIsolationPolicy>();

function defaultSessionIsolationPolicy(): SessionIsolationPolicy {
    return {
        workspaceBindingMode: 'frozen_workspace_only',
        followUpScope: 'same_task_only',
        allowWorkspaceOverride: false,
        supersededContractHandling: 'tombstone_prior_contracts',
        staleEvidenceHandling: 'evict_on_refreeze',
        notes: [],
    };
}

function defaultMemoryIsolationPolicy(): MemoryIsolationPolicy {
    return {
        classificationMode: 'scope_tagged',
        readScopes: ['task', 'workspace', 'user_preference'],
        writeScopes: ['task', 'workspace'],
        defaultWriteScope: 'workspace',
        notes: [],
    };
}

function defaultTenantIsolationPolicy(): TenantIsolationPolicy {
    return {
        workspaceBoundaryMode: 'same_workspace_only',
        userBoundaryMode: 'current_local_user_only',
        allowCrossWorkspaceMemory: false,
        allowCrossWorkspaceFollowUp: false,
        allowCrossUserMemory: false,
        notes: [],
    };
}

function buildWorkspaceTenantKey(workspacePath: string): string {
    const normalized = path.resolve(workspacePath);
    return createHash('sha1').update(normalized).digest('hex');
}

function buildUserTenantKey(): string {
    const username = os.userInfo().username || 'unknown-user';
    return createHash('sha1').update(username).digest('hex');
}

export function setTaskIsolationPolicy(input: {
    taskId: string;
    workspacePath: string;
    sessionIsolationPolicy?: SessionIsolationPolicy;
    memoryIsolationPolicy?: MemoryIsolationPolicy;
    tenantIsolationPolicy?: TenantIsolationPolicy;
}): ResolvedTaskIsolationPolicy {
    const policy: ResolvedTaskIsolationPolicy = {
        workspacePath: path.resolve(input.workspacePath),
        sessionIsolationPolicy: input.sessionIsolationPolicy ?? defaultSessionIsolationPolicy(),
        memoryIsolationPolicy: input.memoryIsolationPolicy ?? defaultMemoryIsolationPolicy(),
        tenantIsolationPolicy: input.tenantIsolationPolicy ?? defaultTenantIsolationPolicy(),
        resolvedTenant: {
            workspaceTenantKey: buildWorkspaceTenantKey(input.workspacePath),
            userTenantKey: buildUserTenantKey(),
        },
    };
    taskPolicies.set(input.taskId, policy);
    return policy;
}

export function getTaskIsolationPolicy(taskId: string): ResolvedTaskIsolationPolicy | undefined {
    return taskPolicies.get(taskId);
}

export function clearTaskIsolationPolicy(taskId: string): void {
    taskPolicies.delete(taskId);
}

export function assertWorkspaceOverrideAllowed(taskId: string, candidateWorkspacePath: string): string | null {
    const policy = getTaskIsolationPolicy(taskId);
    if (!policy) {
        return null;
    }

    const nextWorkspacePath = path.resolve(candidateWorkspacePath);
    if (policy.sessionIsolationPolicy.allowWorkspaceOverride) {
        return null;
    }

    if (nextWorkspacePath !== policy.workspacePath) {
        return `Task session ${taskId} is bound to ${policy.workspacePath} and cannot switch to ${nextWorkspacePath}.`;
    }

    return null;
}

export function resolveAllowedMemoryReadScopes(taskId: string, requestedScopes?: MemoryScope[]): MemoryScope[] {
    const policy = getTaskIsolationPolicy(taskId);
    const allowed = new Set(policy?.memoryIsolationPolicy.readScopes ?? defaultMemoryIsolationPolicy().readScopes);
    const requested = requestedScopes && requestedScopes.length > 0
        ? requestedScopes
        : Array.from(allowed);

    const denied = requested.filter((scope) => !allowed.has(scope));
    if (denied.length > 0) {
        throw new Error(`Memory read scope denied for task session ${taskId}: ${denied.join(', ')}`);
    }

    return Array.from(new Set(requested));
}

export function resolveAllowedMemoryWriteScope(taskId: string, requestedScope?: MemoryScope): MemoryScope {
    const policy = getTaskIsolationPolicy(taskId);
    const memoryPolicy = policy?.memoryIsolationPolicy ?? defaultMemoryIsolationPolicy();
    const scope = requestedScope ?? memoryPolicy.defaultWriteScope;

    if (!memoryPolicy.writeScopes.includes(scope)) {
        throw new Error(`Memory write scope denied for task session ${taskId}: ${scope}`);
    }

    return scope;
}

export function buildMemoryMetadataForScope(input: {
    taskId: string;
    workspacePath: string;
    scope: MemoryScope;
}): Record<string, unknown> {
    const policy = getTaskIsolationPolicy(input.taskId);
    const workspacePath = path.resolve(input.workspacePath);
    const workspaceTenantKey = policy?.resolvedTenant.workspaceTenantKey ?? buildWorkspaceTenantKey(workspacePath);
    const userTenantKey = policy?.resolvedTenant.userTenantKey ?? buildUserTenantKey();

    const base: Record<string, unknown> = {
        memory_scope: input.scope,
        workspace_path: workspacePath,
        workspace_tenant_key: workspaceTenantKey,
        user_tenant_key: userTenantKey,
    };

    if (input.scope === 'task') {
        base.task_id = input.taskId;
    }

    return base;
}

export function buildMemoryRelativePathPrefix(input: {
    taskId: string;
    workspacePath: string;
    scope: MemoryScope;
}): string {
    const metadata = buildMemoryMetadataForScope(input);
    switch (input.scope) {
        case 'task':
            return path.join('task', String(metadata.task_id));
        case 'workspace':
            return path.join('workspace', String(metadata.workspace_tenant_key));
        case 'user_preference':
            return path.join('user', String(metadata.user_tenant_key));
        case 'system':
            return 'system';
    }
}

export function buildMemoryMetadataFilters(input: {
    taskId: string;
    workspacePath: string;
    scope: MemoryScope;
}): Record<string, string> {
    const metadata = buildMemoryMetadataForScope(input);
    const filters: Record<string, string> = {
        memory_scope: String(metadata.memory_scope),
    };

    if (input.scope === 'task') {
        filters.task_id = String(metadata.task_id);
        filters.workspace_tenant_key = String(metadata.workspace_tenant_key);
        return filters;
    }

    if (input.scope === 'workspace') {
        filters.workspace_tenant_key = String(metadata.workspace_tenant_key);
        return filters;
    }

    if (input.scope === 'user_preference') {
        filters.user_tenant_key = String(metadata.user_tenant_key);
        return filters;
    }

    return filters;
}
