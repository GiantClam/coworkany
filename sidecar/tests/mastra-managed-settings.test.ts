import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    applyManagedSettingsFiles,
    ManagedSettingsSyncStore,
    readManagedSettingsPayload,
    restoreManagedSettingsFiles,
} from '../src/mastra/managedSettings';

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

describe('mastra managed settings', () => {
    test('supports inline payload and file apply/restore', () => {
        const workspaceRoot = createTempDir('coworkany-managed-settings-workspace-');
        fs.mkdirSync(path.join(workspaceRoot, '.coworkany'), { recursive: true });
        const policyPath = path.join(workspaceRoot, '.coworkany', 'policy-settings.json');
        const allowlistPath = path.join(workspaceRoot, '.coworkany', 'extension-allowlist.json');
        fs.writeFileSync(policyPath, JSON.stringify({ blockedSkillIds: ['before'] }, null, 2), 'utf-8');
        fs.writeFileSync(allowlistPath, JSON.stringify({ allow: ['before'] }, null, 2), 'utf-8');

        const parsed = readManagedSettingsPayload({
            workspaceRoot,
            payload: {
                settings: {
                    policySettings: { blockedSkillIds: ['after'] },
                    extensionAllowlist: { allow: ['after'] },
                },
            },
        });
        expect(parsed.success).toBe(true);
        if (!parsed.settings) {
            throw new Error('expected managed settings payload');
        }

        const applied = applyManagedSettingsFiles({
            workspaceRoot,
            settings: parsed.settings,
        });
        expect(applied.applied.policySettingsUpdated).toBe(true);
        expect(applied.applied.extensionAllowlistUpdated).toBe(true);
        expect(JSON.parse(fs.readFileSync(policyPath, 'utf-8')).blockedSkillIds[0]).toBe('after');
        expect(JSON.parse(fs.readFileSync(allowlistPath, 'utf-8')).allow[0]).toBe('after');

        const restored = restoreManagedSettingsFiles({
            workspaceRoot,
            rollback: applied.rollback,
        });
        expect(restored.policySettingsRestored).toBe(true);
        expect(restored.extensionAllowlistRestored).toBe(true);
        expect(JSON.parse(fs.readFileSync(policyPath, 'utf-8')).blockedSkillIds[0]).toBe('before');
        expect(JSON.parse(fs.readFileSync(allowlistPath, 'utf-8')).allow[0]).toBe('before');
    });

    test('records sync and rollback entries in history store', () => {
        const appDataRoot = createTempDir('coworkany-managed-settings-log-');
        const store = new ManagedSettingsSyncStore(appDataRoot);
        const syncEntry = store.append({
            action: 'sync',
            source: 'inline_payload',
            success: true,
            rollback: {
                policySettingsRaw: '{}',
            },
            applied: {
                policySettingsUpdated: true,
                extensionAllowlistUpdated: false,
                mcpServerCount: 1,
            },
        });
        store.append({
            action: 'rollback',
            source: syncEntry.id,
            success: true,
            rollback: {},
            applied: {
                policySettingsUpdated: false,
                extensionAllowlistUpdated: false,
                mcpServerCount: 0,
            },
        });

        const reloaded = new ManagedSettingsSyncStore(appDataRoot);
        const entries = reloaded.list();
        expect(entries.length).toBe(2);
        expect(entries.some((entry) => entry.action === 'sync')).toBe(true);
        expect(entries.some((entry) => entry.action === 'rollback')).toBe(true);
        expect(reloaded.get(syncEntry.id)?.action).toBe('sync');
    });
});

