import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExtensionGovernanceStore } from '../src/extensions/governanceStore';
import { buildExtensionGovernanceReview } from '../src/extensions/governance';

function createStorePath(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-extension-governance-store-'));
    return path.join(root, 'extension-governance.json');
}

describe('extension governance store', () => {
    test('records pending first-install reviews and persists them', () => {
        const storePath = createStorePath();
        const store = new ExtensionGovernanceStore(storePath);
        const review = buildExtensionGovernanceReview({
            extensionType: 'skill',
            extensionId: 'demo-skill',
            previous: undefined,
            next: {
                tools: ['Read'],
                effects: [],
                capabilities: [],
                bins: [],
                env: [],
                config: [],
            },
            blockOnPermissionExpansion: true,
        });

        const saved = store.recordReview(review, {
            decision: 'pending',
            quarantined: true,
        });
        const reloaded = new ExtensionGovernanceStore(storePath);
        const loaded = reloaded.get('skill', 'demo-skill');

        expect(saved.pendingReview).toBe(true);
        expect(saved.quarantined).toBe(true);
        expect(loaded?.pendingReview).toBe(true);
        expect(loaded?.quarantined).toBe(true);
        expect(loaded?.lastReviewReason).toBe('first_install_review');
    });

    test('markApproved clears pending state', () => {
        const storePath = createStorePath();
        const store = new ExtensionGovernanceStore(storePath);
        const review = buildExtensionGovernanceReview({
            extensionType: 'toolpack',
            extensionId: 'demo-pack',
            previous: {
                tools: ['read_file'],
                effects: ['filesystem:read'],
                capabilities: [],
                bins: [],
                env: [],
                config: [],
            },
            next: {
                tools: ['read_file', 'write_file'],
                effects: ['filesystem:read', 'filesystem:write'],
                capabilities: [],
                bins: [],
                env: [],
                config: [],
            },
            blockOnPermissionExpansion: true,
        });

        store.recordReview(review, {
            decision: 'pending',
            quarantined: false,
        });
        const approved = store.markApproved('toolpack', 'demo-pack');

        expect(approved?.pendingReview).toBe(false);
        expect(approved?.quarantined).toBe(false);
        expect(approved?.lastDecision).toBe('approved');
        expect(typeof approved?.approvedAt).toBe('string');
    });
});
