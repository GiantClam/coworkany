import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SkillStore } from '../src/storage/skillStore';
import { ToolpackStore } from '../src/storage/toolpackStore';
import { WorkspaceStore } from '../src/storage/workspaceStore';

const tempDirs: string[] = [];
const ENV_KEYS = [
    'COWORKANY_RUNTIME_PROFILE',
    'COWORKANY_ENABLE_BUILTIN_SKILLS',
    'COWORKANY_ENABLE_BUILTIN_TOOLPACKS',
    'COWORKANY_DEFAULT_TOOLPACKS',
] as const;
const ORIGINAL_ENV = new Map<string, string | undefined>(
    ENV_KEYS.map((key) => [key, process.env[key]]),
);

function restoreEnv(): void {
    for (const key of ENV_KEYS) {
        const original = ORIGINAL_ENV.get(key);
        if (typeof original === 'string') {
            process.env[key] = original;
        } else {
            delete process.env[key];
        }
    }
}

function setEnv(values: Partial<Record<typeof ENV_KEYS[number], string | undefined>>): void {
    restoreEnv();
    for (const [key, value] of Object.entries(values)) {
        if (typeof value === 'string') {
            process.env[key] = value;
        } else {
            delete process.env[key];
        }
    }
}

function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    restoreEnv();
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('runtime capability profile builtin isolation', () => {
    test('core profile disables builtin skill/toolpack injection by default', () => {
        setEnv({
            COWORKANY_RUNTIME_PROFILE: 'core',
            COWORKANY_ENABLE_BUILTIN_SKILLS: undefined,
            COWORKANY_ENABLE_BUILTIN_TOOLPACKS: undefined,
        });
        const workspaceRoot = makeTempDir('coworkany-runtime-profile-workspace-');
        const skillStore = new SkillStore(workspaceRoot);
        const toolpackStore = new ToolpackStore(workspaceRoot);

        const builtinSkills = skillStore.list().filter((skill) => skill.isBuiltin === true);
        const builtinToolpacks = toolpackStore.list().filter((toolpack) => toolpack.isBuiltin === true);

        expect(builtinSkills).toHaveLength(0);
        expect(builtinToolpacks).toHaveLength(0);
        expect(toolpackStore.listEnabled().some((toolpack) => toolpack.manifest.id === 'standard-tools')).toBe(true);
    });

    test('core profile can opt back into builtin skill/toolpack injection explicitly', () => {
        setEnv({
            COWORKANY_RUNTIME_PROFILE: 'core',
            COWORKANY_ENABLE_BUILTIN_SKILLS: '1',
            COWORKANY_ENABLE_BUILTIN_TOOLPACKS: '1',
        });
        const workspaceRoot = makeTempDir('coworkany-runtime-profile-optin-');
        const skillStore = new SkillStore(workspaceRoot);
        const toolpackStore = new ToolpackStore(workspaceRoot);

        expect(skillStore.list().some((skill) => skill.isBuiltin === true)).toBe(true);
        expect(toolpackStore.list().some((toolpack) => toolpack.isBuiltin === true)).toBe(true);
        expect(toolpackStore.list().some((toolpack) => toolpack.manifest.id === 'builtin-websearch')).toBe(true);
    });

    test('workspace default toolpacks follow runtime profile and explicit override', () => {
        const appDataCore = makeTempDir('coworkany-runtime-profile-app-core-');
        setEnv({
            COWORKANY_RUNTIME_PROFILE: 'core',
            COWORKANY_DEFAULT_TOOLPACKS: undefined,
        });
        const coreStore = new WorkspaceStore(appDataCore);
        const coreWorkspace = coreStore.create('Core Workspace', makeTempDir('coworkany-workspace-core-'));
        expect(coreWorkspace.defaultToolpacks).toEqual([]);

        const appDataOverride = makeTempDir('coworkany-runtime-profile-app-override-');
        setEnv({
            COWORKANY_RUNTIME_PROFILE: 'core',
            COWORKANY_DEFAULT_TOOLPACKS: 'builtin-filesystem,builtin-websearch',
        });
        const overrideStore = new WorkspaceStore(appDataOverride);
        const overrideWorkspace = overrideStore.create('Override Workspace', makeTempDir('coworkany-workspace-override-'));
        expect(overrideWorkspace.defaultToolpacks).toEqual(['builtin-filesystem', 'builtin-websearch']);
    });
});
