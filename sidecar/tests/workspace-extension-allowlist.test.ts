import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    getWorkspaceExtensionAllowlistPath,
    isWorkspaceExtensionAllowed,
    loadWorkspaceExtensionAllowlistPolicy,
    saveWorkspaceExtensionAllowlistPolicy,
} from '../src/extensions/workspaceExtensionAllowlist';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-ext-allowlist-'));
}

describe('workspace extension allowlist policy', () => {
    test('loads default policy when file is missing', () => {
        const workspaceRoot = makeTempDir();
        const policy = loadWorkspaceExtensionAllowlistPolicy(workspaceRoot);
        expect(policy).toEqual({
            mode: 'off',
            allowedSkills: [],
            allowedToolpacks: [],
        });
    });

    test('persists and reloads enforce policy', () => {
        const workspaceRoot = makeTempDir();
        const saved = saveWorkspaceExtensionAllowlistPolicy(workspaceRoot, {
            mode: 'enforce',
            allowedSkills: ['alpha-skill', 'alpha-skill', ''],
            allowedToolpacks: ['tp-one'],
        });
        const reloaded = loadWorkspaceExtensionAllowlistPolicy(workspaceRoot);

        expect(saved.mode).toBe('enforce');
        expect(saved.allowedSkills).toEqual(['alpha-skill']);
        expect(saved.allowedToolpacks).toEqual(['tp-one']);
        expect(reloaded.mode).toBe('enforce');
        expect(reloaded.allowedSkills).toEqual(['alpha-skill']);
        expect(fs.existsSync(getWorkspaceExtensionAllowlistPath(workspaceRoot))).toBe(true);
    });

    test('allows built-ins and blocks non-allowlisted extension ids in enforce mode', () => {
        const policy = {
            mode: 'enforce' as const,
            allowedSkills: ['approved-skill'],
            allowedToolpacks: ['approved-toolpack'],
        };

        expect(isWorkspaceExtensionAllowed(policy, {
            extensionType: 'skill',
            extensionId: 'approved-skill',
            isBuiltin: false,
        })).toBe(true);
        expect(isWorkspaceExtensionAllowed(policy, {
            extensionType: 'skill',
            extensionId: 'blocked-skill',
            isBuiltin: false,
        })).toBe(false);
        expect(isWorkspaceExtensionAllowed(policy, {
            extensionType: 'toolpack',
            extensionId: 'builtin-websearch',
            isBuiltin: true,
        })).toBe(true);
    });
});
