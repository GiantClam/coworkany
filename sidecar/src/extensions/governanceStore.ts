import * as fs from 'fs';
import * as path from 'path';
import type {
    ExtensionGovernanceReview,
    ExtensionGovernanceReviewReason,
} from './governance';

export type ExtensionGovernanceDecision = 'pending' | 'approved';

export type ExtensionGovernanceState = {
    extensionType: 'skill' | 'toolpack';
    extensionId: string;
    pendingReview: boolean;
    quarantined: boolean;
    lastDecision: ExtensionGovernanceDecision;
    lastReviewReason?: ExtensionGovernanceReviewReason;
    lastReviewSummary?: string;
    lastUpdatedAt: string;
    approvedAt?: string;
};

type GovernanceStoreFile = {
    version: number;
    states: Record<string, ExtensionGovernanceState>;
};

const STORE_VERSION = 1;

function buildKey(extensionType: 'skill' | 'toolpack', extensionId: string): string {
    return `${extensionType}:${extensionId}`;
}

function normalizeRecord(value: unknown): ExtensionGovernanceState | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const candidate = value as Partial<ExtensionGovernanceState>;
    if (candidate.extensionType !== 'skill' && candidate.extensionType !== 'toolpack') {
        return null;
    }
    if (typeof candidate.extensionId !== 'string' || candidate.extensionId.trim().length === 0) {
        return null;
    }
    if (typeof candidate.pendingReview !== 'boolean' || typeof candidate.quarantined !== 'boolean') {
        return null;
    }
    if (candidate.lastDecision !== 'pending' && candidate.lastDecision !== 'approved') {
        return null;
    }
    if (typeof candidate.lastUpdatedAt !== 'string' || candidate.lastUpdatedAt.length === 0) {
        return null;
    }
    return {
        extensionType: candidate.extensionType,
        extensionId: candidate.extensionId,
        pendingReview: candidate.pendingReview,
        quarantined: candidate.quarantined,
        lastDecision: candidate.lastDecision,
        lastReviewReason: candidate.lastReviewReason,
        lastReviewSummary: candidate.lastReviewSummary,
        lastUpdatedAt: candidate.lastUpdatedAt,
        approvedAt: candidate.approvedAt,
    };
}

export class ExtensionGovernanceStore {
    private readonly storagePath: string;
    private readonly states = new Map<string, ExtensionGovernanceState>();

    constructor(storagePath: string) {
        this.storagePath = storagePath;
        this.load();
    }

    private load(): void {
        this.states.clear();
        if (!fs.existsSync(this.storagePath)) {
            return;
        }

        try {
            const raw = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8')) as unknown;
            if (!raw || typeof raw !== 'object') {
                return;
            }

            const typed = raw as Partial<GovernanceStoreFile> & Record<string, unknown>;
            const source = typed.states && typeof typed.states === 'object'
                ? typed.states as Record<string, unknown>
                : typed as Record<string, unknown>;
            for (const [key, value] of Object.entries(source)) {
                const normalized = normalizeRecord(value);
                if (normalized) {
                    this.states.set(key, normalized);
                }
            }
        } catch (error) {
            console.error('[ExtensionGovernanceStore] Failed to load:', error);
        }
    }

    private save(): void {
        try {
            fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
            const payload: GovernanceStoreFile = {
                version: STORE_VERSION,
                states: Object.fromEntries(this.states),
            };
            fs.writeFileSync(this.storagePath, JSON.stringify(payload, null, 2));
        } catch (error) {
            console.error('[ExtensionGovernanceStore] Failed to save:', error);
        }
    }

    list(): ExtensionGovernanceState[] {
        return Array.from(this.states.values())
            .sort((left, right) => left.extensionType.localeCompare(right.extensionType) || left.extensionId.localeCompare(right.extensionId));
    }

    get(extensionType: 'skill' | 'toolpack', extensionId: string): ExtensionGovernanceState | undefined {
        return this.states.get(buildKey(extensionType, extensionId));
    }

    recordReview(
        review: ExtensionGovernanceReview,
        input?: {
            decision?: ExtensionGovernanceDecision;
            quarantined?: boolean;
            now?: Date;
        },
    ): ExtensionGovernanceState {
        const nowIso = (input?.now ?? new Date()).toISOString();
        const hasDefaultPending = review.reviewRequired;
        const defaultDecision: ExtensionGovernanceDecision = hasDefaultPending ? 'pending' : 'approved';
        const decision = input?.decision ?? defaultDecision;

        const pendingReview = decision === 'pending';
        const quarantined = pendingReview
            ? input?.quarantined ?? (review.reason === 'first_install_review')
            : false;

        const state: ExtensionGovernanceState = {
            extensionType: review.extensionType,
            extensionId: review.extensionId,
            pendingReview,
            quarantined,
            lastDecision: decision,
            lastReviewReason: review.reason,
            lastReviewSummary: review.summary,
            lastUpdatedAt: nowIso,
            approvedAt: pendingReview ? undefined : nowIso,
        };

        this.states.set(buildKey(review.extensionType, review.extensionId), state);
        this.save();
        return state;
    }

    markApproved(
        extensionType: 'skill' | 'toolpack',
        extensionId: string,
        now: Date = new Date(),
    ): ExtensionGovernanceState | undefined {
        const key = buildKey(extensionType, extensionId);
        const current = this.states.get(key);
        if (!current) {
            return undefined;
        }

        const approvedAt = now.toISOString();
        const next: ExtensionGovernanceState = {
            ...current,
            pendingReview: false,
            quarantined: false,
            lastDecision: 'approved',
            lastUpdatedAt: approvedAt,
            approvedAt,
        };

        this.states.set(key, next);
        this.save();
        return next;
    }

    clear(extensionType: 'skill' | 'toolpack', extensionId: string): boolean {
        const removed = this.states.delete(buildKey(extensionType, extensionId));
        if (removed) {
            this.save();
        }
        return removed;
    }
}
