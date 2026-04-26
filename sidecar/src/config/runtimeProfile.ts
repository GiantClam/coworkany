export type RuntimeCapabilityProfile = 'full' | 'core';

function toNonEmpty(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function parseBooleanLike(value: unknown): boolean | null {
    const normalized = toNonEmpty(value)?.toLowerCase();
    if (!normalized) {
        return null;
    }
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }
    return null;
}

export function resolveRuntimeCapabilityProfile(
    env: NodeJS.ProcessEnv = process.env,
): RuntimeCapabilityProfile {
    const raw = toNonEmpty(env.COWORKANY_RUNTIME_PROFILE)?.toLowerCase();
    if (raw === 'core' || raw === 'minimal' || raw === 'loop') {
        return 'core';
    }
    return 'full';
}

export function areBuiltinSkillsEnabled(
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    const explicit = parseBooleanLike(env.COWORKANY_ENABLE_BUILTIN_SKILLS);
    if (explicit !== null) {
        return explicit;
    }
    return resolveRuntimeCapabilityProfile(env) !== 'core';
}

export function areBuiltinToolpacksEnabled(
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    const explicit = parseBooleanLike(env.COWORKANY_ENABLE_BUILTIN_TOOLPACKS);
    if (explicit !== null) {
        return explicit;
    }
    return resolveRuntimeCapabilityProfile(env) !== 'core';
}

function normalizeToolpackId(value: string): string {
    const trimmed = value.trim();
    if (trimmed === 'websearch') {
        return 'builtin-websearch';
    }
    return trimmed;
}

export function getDefaultWorkspaceToolpackIds(
    env: NodeJS.ProcessEnv = process.env,
): string[] {
    const explicit = toNonEmpty(env.COWORKANY_DEFAULT_TOOLPACKS);
    if (explicit) {
        const normalized = explicit
            .split(',')
            .map((token) => normalizeToolpackId(token))
            .filter((token) => token.length > 0);
        return Array.from(new Set(normalized));
    }
    if (resolveRuntimeCapabilityProfile(env) === 'core') {
        return [];
    }
    return ['builtin-websearch'];
}
