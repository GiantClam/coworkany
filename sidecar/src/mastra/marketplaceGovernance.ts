import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { parseGitHubSource } from '../utils/githubDownloader';

export type MarketplaceTrustMode = 'open' | 'enforce';

export type MarketplaceTrustPolicy = {
    mode: MarketplaceTrustMode;
    blockedOwners: Set<string>;
    trustedOwners: Set<string>;
    blockedSources: Set<string>;
    allowedSources: Set<string>;
    ownerScores: Record<string, number>;
    minTrustScore: number;
};

export type MarketplaceTrustDecision = {
    allowed: boolean;
    reason: string;
    trustScore: number;
    owner?: string;
    repo?: string;
    normalizedSource: string;
};

export type MarketplaceAuditEntry = {
    id: string;
    at: string;
    action: 'install_from_github' | 'rollback_marketplace_install';
    source: string;
    targetType: 'skill' | 'mcp';
    success: boolean;
    trust: MarketplaceTrustDecision;
    rollback?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    error?: string;
};

type RawMarketplaceTrust = {
    mode?: unknown;
    blockedOwners?: unknown;
    trustedOwners?: unknown;
    blockedSources?: unknown;
    allowedSources?: unknown;
    ownerScores?: unknown;
    minTrustScore?: unknown;
};

type RawPolicySettings = {
    marketplaceTrust?: unknown;
};

const MARKETPLACE_AUDIT_FILE = 'mastra-marketplace-audit-log.json';

function toStringSet(value: unknown): Set<string> {
    if (!Array.isArray(value)) {
        return new Set<string>();
    }
    return new Set(
        value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
    );
}

function parseCsv(raw: string | undefined): Set<string> {
    if (!raw) {
        return new Set<string>();
    }
    return toStringSet(raw.split(','));
}

function parseMode(value: unknown): MarketplaceTrustMode | undefined {
    return value === 'open' || value === 'enforce' ? value : undefined;
}

function parseMinTrustScore(value: unknown): number | undefined {
    const parsed = typeof value === 'number'
        ? value
        : (typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN);
    if (!Number.isFinite(parsed)) {
        return undefined;
    }
    return Math.max(0, Math.min(100, Math.floor(parsed)));
}

function parseOwnerScores(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const result: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        const normalizedKey = key.trim().toLowerCase();
        if (!normalizedKey) {
            continue;
        }
        const score = parseMinTrustScore(raw);
        if (typeof score === 'number') {
            result[normalizedKey] = score;
        }
    }
    return result;
}

function getPolicySettingsPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.coworkany', 'policy-settings.json');
}

function loadRawMarketplaceTrust(workspaceRoot: string): RawMarketplaceTrust {
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
        const trust = settings.marketplaceTrust;
        if (!trust || typeof trust !== 'object' || Array.isArray(trust)) {
            return {};
        }
        return trust as RawMarketplaceTrust;
    } catch {
        return {};
    }
}

function mergeSets(primary: Set<string>, secondary: Set<string>): Set<string> {
    return new Set<string>([...primary, ...secondary]);
}

function normalizeSourceForPolicy(source: string): string {
    const parsed = parseGitHubSource(source);
    if (!parsed) {
        return source.trim();
    }
    const base = `github:${parsed.owner}/${parsed.repo}`.toLowerCase();
    if (!parsed.path) {
        return base;
    }
    return `${base}/${parsed.path}`.toLowerCase();
}

export function loadMarketplaceTrustPolicy(
    workspaceRoot: string,
    env: Record<string, string | undefined> = process.env,
): MarketplaceTrustPolicy {
    const fileConfig = loadRawMarketplaceTrust(workspaceRoot);
    const mode = parseMode(env.COWORKANY_MARKETPLACE_TRUST_MODE ?? fileConfig.mode) ?? 'open';
    const blockedOwners = mergeSets(
        toStringSet(fileConfig.blockedOwners),
        parseCsv(env.COWORKANY_MARKETPLACE_BLOCKED_OWNERS),
    );
    const trustedOwners = mergeSets(
        toStringSet(fileConfig.trustedOwners),
        parseCsv(env.COWORKANY_MARKETPLACE_TRUSTED_OWNERS),
    );
    const blockedSources = mergeSets(
        toStringSet(fileConfig.blockedSources),
        parseCsv(env.COWORKANY_MARKETPLACE_BLOCKED_SOURCES),
    );
    const allowedSources = mergeSets(
        toStringSet(fileConfig.allowedSources),
        parseCsv(env.COWORKANY_MARKETPLACE_ALLOWED_SOURCES),
    );
    const ownerScores = parseOwnerScores(fileConfig.ownerScores);
    const minTrustScore = parseMinTrustScore(
        env.COWORKANY_MARKETPLACE_MIN_TRUST_SCORE ?? fileConfig.minTrustScore,
    ) ?? 0;
    return {
        mode,
        blockedOwners: new Set(Array.from(blockedOwners).map((item) => item.toLowerCase())),
        trustedOwners: new Set(Array.from(trustedOwners).map((item) => item.toLowerCase())),
        blockedSources: new Set(Array.from(blockedSources).map((item) => normalizeSourceForPolicy(item))),
        allowedSources: new Set(Array.from(allowedSources).map((item) => normalizeSourceForPolicy(item))),
        ownerScores,
        minTrustScore,
    };
}

export function evaluateMarketplaceSourceTrust(
    source: string,
    policy: MarketplaceTrustPolicy,
): MarketplaceTrustDecision {
    const normalizedSource = normalizeSourceForPolicy(source);
    const parsed = parseGitHubSource(source);
    if (!parsed) {
        return {
            allowed: true,
            reason: 'local_or_non_github_source',
            trustScore: 100,
            normalizedSource,
        };
    }

    const owner = parsed.owner.toLowerCase();
    const repo = parsed.repo;
    if (policy.blockedOwners.has(owner)) {
        return {
            allowed: false,
            reason: 'marketplace_owner_blocked',
            trustScore: 0,
            owner,
            repo,
            normalizedSource,
        };
    }
    if (policy.blockedSources.has(normalizedSource)) {
        return {
            allowed: false,
            reason: 'marketplace_source_blocked',
            trustScore: 0,
            owner,
            repo,
            normalizedSource,
        };
    }

    let trustScore = 50;
    if (typeof policy.ownerScores[owner] === 'number') {
        trustScore = policy.ownerScores[owner]!;
    } else if (policy.trustedOwners.has(owner)) {
        trustScore = 90;
    }
    trustScore = Math.max(0, Math.min(100, Math.floor(trustScore)));

    if (
        policy.mode === 'enforce'
        && policy.allowedSources.size > 0
        && !policy.allowedSources.has(normalizedSource)
    ) {
        return {
            allowed: false,
            reason: 'marketplace_source_not_allowlisted',
            trustScore,
            owner,
            repo,
            normalizedSource,
        };
    }
    if (trustScore < policy.minTrustScore) {
        return {
            allowed: false,
            reason: 'marketplace_trust_score_too_low',
            trustScore,
            owner,
            repo,
            normalizedSource,
        };
    }
    return {
        allowed: true,
        reason: 'marketplace_trust_allowed',
        trustScore,
        owner,
        repo,
        normalizedSource,
    };
}

type AuditEnvelope = {
    entries: MarketplaceAuditEntry[];
};

export class MarketplaceAuditStore {
    private readonly filePath: string;
    private readonly entries: MarketplaceAuditEntry[] = [];

    constructor(appDataRoot: string) {
        this.filePath = path.join(appDataRoot, MARKETPLACE_AUDIT_FILE);
        this.load();
    }

    append(input: Omit<MarketplaceAuditEntry, 'id' | 'at'>): MarketplaceAuditEntry {
        const entry: MarketplaceAuditEntry = {
            id: `marketplace-audit-${randomUUID()}`,
            at: new Date().toISOString(),
            ...input,
        };
        this.entries.push(entry);
        this.save();
        return entry;
    }

    get(entryId: string): MarketplaceAuditEntry | undefined {
        const normalized = entryId.trim();
        if (!normalized) {
            return undefined;
        }
        return this.entries.find((entry) => entry.id === normalized);
    }

    list(input?: { limit?: number; action?: MarketplaceAuditEntry['action'] }): MarketplaceAuditEntry[] {
        const action = input?.action;
        const limit = typeof input?.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0
            ? Math.floor(input.limit)
            : undefined;
        const filtered = this.entries
            .filter((entry) => !action || entry.action === action)
            .slice()
            .sort((left, right) => right.at.localeCompare(left.at));
        return limit ? filtered.slice(0, limit) : filtered;
    }

    private load(): void {
        if (!fs.existsSync(this.filePath)) {
            return;
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as unknown;
            const envelope = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed as AuditEnvelope
                : { entries: [] };
            if (!Array.isArray(envelope.entries)) {
                return;
            }
            for (const rawEntry of envelope.entries) {
                if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
                    continue;
                }
                const entry = rawEntry as MarketplaceAuditEntry;
                if (
                    typeof entry.id !== 'string'
                    || typeof entry.at !== 'string'
                    || typeof entry.action !== 'string'
                    || typeof entry.source !== 'string'
                    || typeof entry.targetType !== 'string'
                    || typeof entry.success !== 'boolean'
                    || !entry.trust
                ) {
                    continue;
                }
                this.entries.push(entry);
            }
        } catch {
            // ignore malformed persisted audit log
        }
    }

    private save(): void {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            const tempPath = `${this.filePath}.tmp`;
            const envelope: AuditEnvelope = {
                entries: this.entries,
            };
            fs.writeFileSync(tempPath, JSON.stringify(envelope, null, 2), 'utf-8');
            fs.renameSync(tempPath, this.filePath);
        } catch {
            // no-op: audit write failures should not fail runtime actions
        }
    }
}

