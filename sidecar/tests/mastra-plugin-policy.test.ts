import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    evaluateSkillPolicy,
    evaluateToolpackPolicy,
    loadPluginPolicySnapshot,
} from '../src/mastra/pluginPolicy';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const current = tempDirs.pop();
        if (!current) {
            continue;
        }
        fs.rmSync(current, { recursive: true, force: true });
    }
});

describe('mastra plugin policy', () => {
    test('loads policy from workspace settings and env overrides', () => {
        const workspaceRoot = createTempDir('coworkany-plugin-policy-');
        fs.mkdirSync(path.join(workspaceRoot, '.coworkany'), { recursive: true });
        fs.writeFileSync(
            path.join(workspaceRoot, '.coworkany', 'policy-settings.json'),
            JSON.stringify({
                blockedSkillIds: ['blocked-from-file'],
                blockedToolpackIds: ['blocked-toolpack-file'],
            }),
            'utf-8',
        );
        fs.writeFileSync(
            path.join(workspaceRoot, '.coworkany', 'extension-allowlist.json'),
            JSON.stringify({
                mode: 'enforce',
                allowedSkills: ['allowed-skill'],
                allowedToolpacks: ['allowed-toolpack'],
            }),
            'utf-8',
        );

        const snapshot = loadPluginPolicySnapshot(workspaceRoot, {
            COWORKANY_POLICY_BLOCKED_SKILLS: 'blocked-from-env',
            COWORKANY_POLICY_BLOCKED_TOOLPACKS: 'blocked-toolpack-env',
        });

        expect(snapshot.allowlist.mode).toBe('enforce');
        expect(snapshot.blockedSkillIds.has('blocked-from-file')).toBe(true);
        expect(snapshot.blockedSkillIds.has('blocked-from-env')).toBe(true);
        expect(snapshot.blockedToolpackIds.has('blocked-toolpack-file')).toBe(true);
        expect(snapshot.blockedToolpackIds.has('blocked-toolpack-env')).toBe(true);
    });

    test('enforces skill policy for blocklist and allowlist', () => {
        const snapshot = {
            allowlist: {
                mode: 'enforce' as const,
                allowedSkills: ['allowed-skill'],
                allowedToolpacks: [],
            },
            blockedSkillIds: new Set<string>(['blocked-skill']),
            blockedToolpackIds: new Set<string>(),
        };

        expect(evaluateSkillPolicy({ skillId: 'builtin-skill', isBuiltin: true }, snapshot).allowed).toBe(true);
        expect(evaluateSkillPolicy({ skillId: 'blocked-skill' }, snapshot)).toEqual({
            allowed: false,
            reason: 'skill_blocked_by_policy',
        });
        expect(evaluateSkillPolicy({ skillId: 'non-allowlisted' }, snapshot)).toEqual({
            allowed: false,
            reason: 'workspace_extension_not_allowlisted',
        });
        expect(evaluateSkillPolicy({ skillId: 'allowed-skill' }, snapshot).allowed).toBe(true);
    });

    test('enforces toolpack policy for blocklist and allowlist', () => {
        const snapshot = {
            allowlist: {
                mode: 'enforce' as const,
                allowedSkills: [],
                allowedToolpacks: ['allowed-toolpack'],
            },
            blockedSkillIds: new Set<string>(),
            blockedToolpackIds: new Set<string>(['blocked-toolpack']),
        };

        expect(evaluateToolpackPolicy({ toolpackId: 'builtin-pack', isBuiltin: true }, snapshot).allowed).toBe(true);
        expect(evaluateToolpackPolicy({ toolpackId: 'blocked-toolpack' }, snapshot)).toEqual({
            allowed: false,
            reason: 'toolpack_blocked_by_policy',
        });
        expect(evaluateToolpackPolicy({ toolpackId: 'other' }, snapshot)).toEqual({
            allowed: false,
            reason: 'workspace_extension_not_allowlisted',
        });
        expect(evaluateToolpackPolicy({ toolpackId: 'allowed-toolpack' }, snapshot).allowed).toBe(true);
    });
});
