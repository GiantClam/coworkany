import * as fs from 'fs';
import * as path from 'path';
import {
    loadWorkspaceExtensionAllowlistPolicy,
    type WorkspaceExtensionAllowlistPolicy,
} from '../extensions/workspaceExtensionAllowlist';

type RawPolicySettings = {
    blockedSkillIds?: unknown;
    blockedToolpackIds?: unknown;
};

export type PluginPolicySnapshot = {
    allowlist: WorkspaceExtensionAllowlistPolicy;
    blockedSkillIds: Set<string>;
    blockedToolpackIds: Set<string>;
};

export type PluginPolicyDecision = {
    allowed: boolean;
    reason?: 'skill_blocked_by_policy' | 'toolpack_blocked_by_policy' | 'workspace_extension_not_allowlisted';
};

function normalizeIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const dedup = new Set<string>();
    for (const item of value) {
        if (typeof item !== 'string') {
            continue;
        }
        const normalized = item.trim();
        if (!normalized) {
            continue;
        }
        dedup.add(normalized);
    }
    return Array.from(dedup).sort((left, right) => left.localeCompare(right));
}

function parseCsv(raw: string | undefined): string[] {
    if (!raw) {
        return [];
    }
    return normalizeIds(raw.split(',').map((item) => item.trim()).filter((item) => item.length > 0));
}

function getPolicySettingsPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.coworkany', 'policy-settings.json');
}

function loadRawPolicySettings(workspaceRoot: string): RawPolicySettings {
    const settingsPath = getPolicySettingsPath(workspaceRoot);
    if (!fs.existsSync(settingsPath)) {
        return {};
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        return parsed as RawPolicySettings;
    } catch {
        return {};
    }
}

function mergedSet(base: string[], override: string[]): Set<string> {
    return new Set<string>([...base, ...override]);
}

export function loadPluginPolicySnapshot(
    workspaceRoot: string,
    env: Record<string, string | undefined> = process.env,
): PluginPolicySnapshot {
    const allowlist = loadWorkspaceExtensionAllowlistPolicy(workspaceRoot);
    const settings = loadRawPolicySettings(workspaceRoot);
    const blockedSkillIds = mergedSet(
        normalizeIds(settings.blockedSkillIds),
        parseCsv(env.COWORKANY_POLICY_BLOCKED_SKILLS),
    );
    const blockedToolpackIds = mergedSet(
        normalizeIds(settings.blockedToolpackIds),
        parseCsv(env.COWORKANY_POLICY_BLOCKED_TOOLPACKS),
    );
    return {
        allowlist,
        blockedSkillIds,
        blockedToolpackIds,
    };
}

export function evaluateSkillPolicy(
    input: { skillId: string; isBuiltin?: boolean },
    snapshot: PluginPolicySnapshot,
): PluginPolicyDecision {
    if (input.isBuiltin) {
        return { allowed: true };
    }
    if (snapshot.blockedSkillIds.has(input.skillId)) {
        return {
            allowed: false,
            reason: 'skill_blocked_by_policy',
        };
    }
    if (
        snapshot.allowlist.mode === 'enforce'
        && !snapshot.allowlist.allowedSkills.includes(input.skillId)
    ) {
        return {
            allowed: false,
            reason: 'workspace_extension_not_allowlisted',
        };
    }
    return { allowed: true };
}

export function evaluateToolpackPolicy(
    input: { toolpackId: string; isBuiltin?: boolean },
    snapshot: PluginPolicySnapshot,
): PluginPolicyDecision {
    if (input.isBuiltin) {
        return { allowed: true };
    }
    if (snapshot.blockedToolpackIds.has(input.toolpackId)) {
        return {
            allowed: false,
            reason: 'toolpack_blocked_by_policy',
        };
    }
    if (
        snapshot.allowlist.mode === 'enforce'
        && !snapshot.allowlist.allowedToolpacks.includes(input.toolpackId)
    ) {
        return {
            allowed: false,
            reason: 'workspace_extension_not_allowlisted',
        };
    }
    return { allowed: true };
}
