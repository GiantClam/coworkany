import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    DEFAULT_REMOTE_SESSION_GOVERNANCE_POLICY,
    loadRemoteSessionGovernancePolicy,
} from '../src/mastra/remoteSessionGovernance';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('remote session governance policy loader', () => {
    test('returns defaults when policy file/env are absent', () => {
        const workspace = createTempDir('coworkany-remote-governance-default-');
        const policy = loadRemoteSessionGovernancePolicy(workspace, {});
        expect(policy).toEqual(DEFAULT_REMOTE_SESSION_GOVERNANCE_POLICY);
    });

    test('reads governance policy from policy-settings.json and allows env override', () => {
        const workspace = createTempDir('coworkany-remote-governance-file-');
        const configDir = path.join(workspace, '.coworkany');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'policy-settings.json'), JSON.stringify({
            remoteSessionGovernance: {
                conflictStrategy: 'takeover_if_stale',
                staleAfterMs: 45_000,
                enforceTenantIsolation: true,
                requireTenantIdForManaged: true,
                requireEndpointIdForManaged: true,
                enforceEndpointIsolation: false,
                enforceManagedIdentityImmutable: true,
                requireTenantIdForManagedCommands: false,
            },
        }, null, 2), 'utf-8');

        const policy = loadRemoteSessionGovernancePolicy(workspace, {
            COWORKANY_REMOTE_SESSION_CONFLICT_STRATEGY: 'takeover',
            COWORKANY_REMOTE_SESSION_ENFORCE_ENDPOINT_ISOLATION: 'true',
            COWORKANY_REMOTE_SESSION_REQUIRE_TENANT_ID_FOR_MANAGED_COMMANDS: 'true',
        });
        expect(policy.conflictStrategy).toBe('takeover');
        expect(policy.staleAfterMs).toBe(45_000);
        expect(policy.enforceTenantIsolation).toBe(true);
        expect(policy.requireTenantIdForManaged).toBe(true);
        expect(policy.requireEndpointIdForManaged).toBe(true);
        expect(policy.enforceEndpointIsolation).toBe(true);
        expect(policy.enforceManagedIdentityImmutable).toBe(true);
        expect(policy.requireTenantIdForManagedCommands).toBe(true);
    });
});
