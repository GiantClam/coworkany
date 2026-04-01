import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    evaluateMarketplaceSourceTrust,
    loadMarketplaceTrustPolicy,
    MarketplaceAuditStore,
} from '../src/mastra/marketplaceGovernance';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (!dir) {
            continue;
        }
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('mastra marketplace governance', () => {
    test('loads trust policy and blocks sources based on owner + score', () => {
        const workspaceRoot = createTempDir('coworkany-marketplace-policy-');
        fs.mkdirSync(path.join(workspaceRoot, '.coworkany'), { recursive: true });
        fs.writeFileSync(path.join(workspaceRoot, '.coworkany', 'policy-settings.json'), JSON.stringify({
            marketplaceTrust: {
                mode: 'enforce',
                blockedOwners: ['blocked-owner'],
                trustedOwners: ['trusted-owner'],
                ownerScores: {
                    'low-owner': 10,
                },
                minTrustScore: 30,
            },
        }, null, 2), 'utf-8');

        const policy = loadMarketplaceTrustPolicy(workspaceRoot);
        const blocked = evaluateMarketplaceSourceTrust('github:blocked-owner/repo', policy);
        const lowScore = evaluateMarketplaceSourceTrust('github:low-owner/repo', policy);
        const trusted = evaluateMarketplaceSourceTrust('github:trusted-owner/repo', policy);

        expect(policy.mode).toBe('enforce');
        expect(blocked.allowed).toBe(false);
        expect(blocked.reason).toBe('marketplace_owner_blocked');
        expect(lowScore.allowed).toBe(false);
        expect(lowScore.reason).toBe('marketplace_trust_score_too_low');
        expect(trusted.allowed).toBe(true);
    });

    test('persists marketplace audit entries', () => {
        const appDataRoot = createTempDir('coworkany-marketplace-audit-');
        const store = new MarketplaceAuditStore(appDataRoot);
        const entry = store.append({
            action: 'install_from_github',
            source: 'github:demo/repo',
            targetType: 'skill',
            success: true,
            trust: {
                allowed: true,
                reason: 'marketplace_trust_allowed',
                trustScore: 90,
                owner: 'demo',
                repo: 'repo',
                normalizedSource: 'github:demo/repo',
            },
        });

        const reloaded = new MarketplaceAuditStore(appDataRoot);
        const listed = reloaded.list();
        expect(reloaded.get(entry.id)?.id).toBe(entry.id);
        expect(listed.length).toBe(1);
        expect(listed[0]?.action).toBe('install_from_github');
    });
});

