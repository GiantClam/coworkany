import * as fs from 'fs';
import * as path from 'path';

export type WorkspaceExtensionAllowlistMode = 'off' | 'enforce';

export type WorkspaceExtensionAllowlistPolicy = {
    mode: WorkspaceExtensionAllowlistMode;
    allowedSkills: string[];
    allowedToolpacks: string[];
};

const DEFAULT_POLICY: WorkspaceExtensionAllowlistPolicy = {
    mode: 'off',
    allowedSkills: [],
    allowedToolpacks: [],
};

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const entries = new Set<string>();
    for (const item of value) {
        if (typeof item !== 'string') {
            continue;
        }
        const normalized = item.trim();
        if (normalized.length === 0) {
            continue;
        }
        entries.add(normalized);
    }
    return Array.from(entries).sort((left, right) => left.localeCompare(right));
}

export function getWorkspaceExtensionAllowlistPath(repositoryRoot: string): string {
    return path.join(repositoryRoot, '.coworkany', 'extension-allowlist.json');
}

export function loadWorkspaceExtensionAllowlistPolicy(repositoryRoot: string): WorkspaceExtensionAllowlistPolicy {
    const policyPath = getWorkspaceExtensionAllowlistPath(repositoryRoot);
    if (!fs.existsSync(policyPath)) {
        return { ...DEFAULT_POLICY };
    }

    const raw = JSON.parse(fs.readFileSync(policyPath, 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ...DEFAULT_POLICY };
    }
    const root = raw as {
        mode?: unknown;
        allowedSkills?: unknown;
        allowedToolpacks?: unknown;
    };
    const mode: WorkspaceExtensionAllowlistMode = root.mode === 'enforce' ? 'enforce' : 'off';
    return {
        mode,
        allowedSkills: normalizeStringList(root.allowedSkills),
        allowedToolpacks: normalizeStringList(root.allowedToolpacks),
    };
}
