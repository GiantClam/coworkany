import * as fs from 'fs';
import * as path from 'path';

export type WorkspaceExtensionAllowlistMode = 'off' | 'enforce';

export type WorkspaceExtensionAllowlistPolicy = {
    mode: WorkspaceExtensionAllowlistMode;
    allowedSkills: string[];
    allowedToolpacks: string[];
    updatedAt?: string;
};

type RawWorkspaceExtensionAllowlistPolicy = Partial<WorkspaceExtensionAllowlistPolicy>;

function normalizeList(values: unknown): string[] {
    if (!Array.isArray(values)) {
        return [];
    }

    return Array.from(new Set(
        values
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean)
    ));
}

export function createDefaultWorkspaceExtensionAllowlistPolicy(): WorkspaceExtensionAllowlistPolicy {
    return {
        mode: 'off',
        allowedSkills: [],
        allowedToolpacks: [],
    };
}

export function getWorkspaceExtensionAllowlistPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.coworkany', 'extension-allowlist.json');
}

export function normalizeWorkspaceExtensionAllowlistPolicy(
    value: unknown,
): WorkspaceExtensionAllowlistPolicy {
    const candidate = (value && typeof value === 'object'
        ? value as RawWorkspaceExtensionAllowlistPolicy
        : {}) as RawWorkspaceExtensionAllowlistPolicy;

    return {
        mode: candidate.mode === 'enforce' ? 'enforce' : 'off',
        allowedSkills: normalizeList(candidate.allowedSkills),
        allowedToolpacks: normalizeList(candidate.allowedToolpacks),
        updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : undefined,
    };
}

export function loadWorkspaceExtensionAllowlistPolicy(workspaceRoot: string): WorkspaceExtensionAllowlistPolicy {
    const policyPath = getWorkspaceExtensionAllowlistPath(workspaceRoot);
    if (!fs.existsSync(policyPath)) {
        return createDefaultWorkspaceExtensionAllowlistPolicy();
    }

    try {
        const raw = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));
        return normalizeWorkspaceExtensionAllowlistPolicy(raw);
    } catch {
        return createDefaultWorkspaceExtensionAllowlistPolicy();
    }
}

export function saveWorkspaceExtensionAllowlistPolicy(
    workspaceRoot: string,
    policy: Partial<WorkspaceExtensionAllowlistPolicy>,
): WorkspaceExtensionAllowlistPolicy {
    const policyPath = getWorkspaceExtensionAllowlistPath(workspaceRoot);
    const previous = loadWorkspaceExtensionAllowlistPolicy(workspaceRoot);
    const next = normalizeWorkspaceExtensionAllowlistPolicy({
        ...previous,
        ...policy,
        updatedAt: new Date().toISOString(),
    });

    fs.mkdirSync(path.dirname(policyPath), { recursive: true });
    fs.writeFileSync(policyPath, JSON.stringify(next, null, 2), 'utf-8');
    return next;
}

export function isWorkspaceExtensionAllowed(
    policy: WorkspaceExtensionAllowlistPolicy,
    input: {
        extensionType: 'skill' | 'toolpack';
        extensionId: string;
        isBuiltin?: boolean;
    },
): boolean {
    if (input.isBuiltin) {
        return true;
    }

    if (policy.mode !== 'enforce') {
        return true;
    }

    if (input.extensionType === 'skill') {
        return policy.allowedSkills.includes(input.extensionId);
    }

    return policy.allowedToolpacks.includes(input.extensionId);
}
