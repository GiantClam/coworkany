import type { ClaudeSkillManifest } from '../storage/skillStore';

export type ExtensionPermissionSummary = {
    tools: string[];
    effects: string[];
    capabilities: string[];
    bins: string[];
    env: string[];
    config: string[];
};

export type ExtensionProvenance = {
    sourceType: 'built_in' | 'local_folder' | 'github' | 'skillhub' | 'clawhub' | 'unknown';
    sourceRef?: string;
    publisher?: string;
    homepage?: string;
    repository?: string;
    signaturePresent: boolean;
};

export type ExtensionTrustSummary = {
    level: 'trusted' | 'review_required' | 'untrusted';
    pendingReview: boolean;
    reasons: string[];
};

export type ExtensionPermissionDelta = {
    added: ExtensionPermissionSummary;
    removed: ExtensionPermissionSummary;
};

export type ExtensionGovernanceReviewReason =
    | 'none'
    | 'first_install_review'
    | 'permission_expansion';

export type ExtensionGovernanceReview = {
    extensionType: 'skill' | 'toolpack';
    extensionId: string;
    installKind: 'first_install' | 'update';
    reviewRequired: boolean;
    blocking: boolean;
    reason: ExtensionGovernanceReviewReason;
    summary: string;
    before?: ExtensionPermissionSummary;
    after: ExtensionPermissionSummary;
    delta?: ExtensionPermissionDelta;
};

type BuildExtensionGovernanceReviewInput = {
    extensionType: 'skill' | 'toolpack';
    extensionId: string;
    previous?: ExtensionPermissionSummary;
    next: ExtensionPermissionSummary;
    blockOnPermissionExpansion: boolean;
};

const EMPTY_PERMISSION_SUMMARY: ExtensionPermissionSummary = {
    tools: [],
    effects: [],
    capabilities: [],
    bins: [],
    env: [],
    config: [],
};

function normalizePermissionValues(values: unknown): string[] {
    if (!Array.isArray(values)) {
        return [];
    }

    const normalized = values
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0);

    return Array.from(new Set(normalized)).sort((left, right) => left.localeCompare(right));
}

function normalizeString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function summarizePermissionSummary(summary: ExtensionPermissionSummary): string {
    const parts: string[] = [];
    if (summary.tools.length > 0) parts.push(`tools: ${summary.tools.join(', ')}`);
    if (summary.effects.length > 0) parts.push(`effects: ${summary.effects.join(', ')}`);
    if (summary.capabilities.length > 0) parts.push(`capabilities: ${summary.capabilities.join(', ')}`);
    if (summary.bins.length > 0) parts.push(`bins: ${summary.bins.join(', ')}`);
    if (summary.env.length > 0) parts.push(`env: ${summary.env.join(', ')}`);
    if (summary.config.length > 0) parts.push(`config: ${summary.config.join(', ')}`);
    return parts.length > 0 ? parts.join(' | ') : 'no declared permissions';
}

function diffPermissionList(before: string[], after: string[]): { added: string[]; removed: string[] } {
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    const added = after.filter((value) => !beforeSet.has(value));
    const removed = before.filter((value) => !afterSet.has(value));
    return { added, removed };
}

export function diffExtensionPermissions(
    before: ExtensionPermissionSummary,
    after: ExtensionPermissionSummary
): ExtensionPermissionDelta {
    const tools = diffPermissionList(before.tools, after.tools);
    const effects = diffPermissionList(before.effects, after.effects);
    const capabilities = diffPermissionList(before.capabilities, after.capabilities);
    const bins = diffPermissionList(before.bins, after.bins);
    const env = diffPermissionList(before.env, after.env);
    const config = diffPermissionList(before.config, after.config);

    return {
        added: {
            tools: tools.added,
            effects: effects.added,
            capabilities: capabilities.added,
            bins: bins.added,
            env: env.added,
            config: config.added,
        },
        removed: {
            tools: tools.removed,
            effects: effects.removed,
            capabilities: capabilities.removed,
            bins: bins.removed,
            env: env.removed,
            config: config.removed,
        },
    };
}

export function hasPermissionExpansion(delta: ExtensionPermissionDelta): boolean {
    return (
        delta.added.tools.length > 0 ||
        delta.added.effects.length > 0 ||
        delta.added.capabilities.length > 0 ||
        delta.added.bins.length > 0 ||
        delta.added.env.length > 0 ||
        delta.added.config.length > 0
    );
}

export function summarizeSkillPermissions(manifest: Partial<ClaudeSkillManifest> | undefined): ExtensionPermissionSummary {
    if (!manifest) {
        return EMPTY_PERMISSION_SUMMARY;
    }

    return {
        tools: normalizePermissionValues(manifest.allowedTools),
        effects: [],
        capabilities: normalizePermissionValues([
            ...(manifest.requiredCapabilities ?? []),
            ...((manifest.requires?.capabilities ?? []) as string[]),
        ]),
        bins: normalizePermissionValues(manifest.requires?.bins),
        env: normalizePermissionValues(manifest.requires?.env),
        config: normalizePermissionValues(manifest.requires?.config),
    };
}

type LooseToolpackPermissionManifest = {
    tools?: unknown;
    effects?: unknown;
};

export function summarizeToolpackPermissions(manifest: LooseToolpackPermissionManifest | undefined): ExtensionPermissionSummary {
    if (!manifest) {
        return EMPTY_PERMISSION_SUMMARY;
    }

    return {
        tools: normalizePermissionValues(manifest.tools),
        effects: normalizePermissionValues(manifest.effects),
        capabilities: [],
        bins: [],
        env: [],
        config: [],
    };
}

type LooseToolpackManifest = {
    author?: unknown;
    homepage?: unknown;
    repository?: unknown;
    signature?: unknown;
};

export function summarizeToolpackProvenance(
    manifest: LooseToolpackManifest | undefined,
    input?: {
        isBuiltin?: boolean;
        sourceType?: ExtensionProvenance['sourceType'];
        sourceRef?: string;
    }
): ExtensionProvenance {
    const sourceType = input?.isBuiltin ? 'built_in' : (input?.sourceType ?? 'local_folder');
    return {
        sourceType,
        sourceRef: normalizeString(input?.sourceRef),
        publisher: normalizeString(manifest?.author),
        homepage: normalizeString(manifest?.homepage),
        repository: normalizeString(manifest?.repository),
        signaturePresent: Boolean(manifest?.signature),
    };
}

export function summarizeToolpackTrust(
    manifest: LooseToolpackManifest | undefined,
    input?: {
        isBuiltin?: boolean;
    }
): ExtensionTrustSummary {
    if (input?.isBuiltin) {
        return {
            level: 'trusted',
            pendingReview: false,
            reasons: ['builtin_toolpack'],
        };
    }

    if (normalizeString(manifest?.signature)) {
        return {
            level: 'trusted',
            pendingReview: false,
            reasons: ['signed_toolpack_manifest'],
        };
    }

    return {
        level: 'review_required',
        pendingReview: true,
        reasons: ['unsigned_toolpack_manifest'],
    };
}

function readSkillRepository(manifest: Partial<ClaudeSkillManifest> | undefined): string | undefined {
    if (!manifest || !manifest.metadata || typeof manifest.metadata !== 'object') {
        return undefined;
    }
    const metadata = manifest.metadata as Record<string, unknown>;
    return normalizeString(metadata.repository) ?? normalizeString(metadata.source);
}

export function summarizeSkillProvenance(
    manifest: Partial<ClaudeSkillManifest> | undefined,
    input?: {
        isBuiltin?: boolean;
        sourceType?: ExtensionProvenance['sourceType'];
        sourceRef?: string;
    }
): ExtensionProvenance {
    const sourceType = input?.isBuiltin ? 'built_in' : (input?.sourceType ?? 'local_folder');
    const sourceRef = normalizeString(input?.sourceRef) ?? normalizeString(manifest?.directory);
    return {
        sourceType,
        sourceRef,
        publisher: normalizeString(manifest?.author),
        homepage: normalizeString(manifest?.homepage),
        repository: readSkillRepository(manifest),
        signaturePresent: false,
    };
}

export function summarizeSkillTrust(
    manifest: Partial<ClaudeSkillManifest> | undefined,
    input?: {
        isBuiltin?: boolean;
    }
): ExtensionTrustSummary {
    if (input?.isBuiltin) {
        return {
            level: 'trusted',
            pendingReview: false,
            reasons: ['builtin_skill'],
        };
    }

    const hasPublisher = typeof normalizeString(manifest?.author) === 'string';
    const hasHomepage = typeof normalizeString(manifest?.homepage) === 'string';
    const hasRepository = typeof readSkillRepository(manifest) === 'string';
    if (hasPublisher && (hasHomepage || hasRepository)) {
        return {
            level: 'review_required',
            pendingReview: true,
            reasons: ['third_party_skill_with_declared_provenance'],
        };
    }

    return {
        level: 'untrusted',
        pendingReview: true,
        reasons: ['third_party_skill_missing_provenance'],
    };
}


export function buildExtensionGovernanceReview(
    input: BuildExtensionGovernanceReviewInput
): ExtensionGovernanceReview {
    const previous = input.previous;
    const next = input.next;
    const installKind: ExtensionGovernanceReview['installKind'] = previous ? 'update' : 'first_install';

    if (!previous) {
        return {
            extensionType: input.extensionType,
            extensionId: input.extensionId,
            installKind,
            reviewRequired: true,
            blocking: false,
            reason: 'first_install_review',
            summary: `First install review required for ${input.extensionType} "${input.extensionId}": ${summarizePermissionSummary(next)}.`,
            after: next,
        };
    }

    const delta = diffExtensionPermissions(previous, next);
    const expanded = hasPermissionExpansion(delta);
    if (!expanded) {
        return {
            extensionType: input.extensionType,
            extensionId: input.extensionId,
            installKind,
            reviewRequired: false,
            blocking: false,
            reason: 'none',
            summary: `No permission expansion detected for ${input.extensionType} "${input.extensionId}".`,
            before: previous,
            after: next,
            delta,
        };
    }

    const addedSummary = summarizePermissionSummary(delta.added);
    return {
        extensionType: input.extensionType,
        extensionId: input.extensionId,
        installKind,
        reviewRequired: true,
        blocking: input.blockOnPermissionExpansion,
        reason: 'permission_expansion',
        summary: `Permission expansion detected for ${input.extensionType} "${input.extensionId}": ${addedSummary}.`,
        before: previous,
        after: next,
        delta,
    };
}
