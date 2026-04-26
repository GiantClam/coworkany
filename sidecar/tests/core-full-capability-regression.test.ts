import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CORE_BASELINE_TOOL_IDS, CORE_TOOLPACK_ID } from '../src/data/coreToolpack';
import { createMastraAdditionalCommandHandler } from '../src/mastra/additionalCommands';
import { buildInternalRuntimeToolsets, countToolsInToolsets } from '../src/mastra/runtimeToolCatalog';
import { resolveRuntimeInternalTool } from '../src/mastra/internalToolResolver';
import { ToolpackStore } from '../src/storage/toolpackStore';

const tempDirs: string[] = [];
const ENV_KEYS = [
    'COWORKANY_RUNTIME_PROFILE',
    'COWORKANY_ENABLE_BUILTIN_SKILLS',
    'COWORKANY_ENABLE_BUILTIN_TOOLPACKS',
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

function createTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

function createCommand(type: string, payload: Record<string, unknown>): Record<string, unknown> {
    return {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type,
        payload,
    };
}

function createSkillFixture(): string {
    const skillDir = createTempDir('coworkany-core-regression-skill-');
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: core-regression-skill
version: 1.0.0
description: core regression fixture skill
---

# core-regression-skill

Used by regression tests to prove skills are installable outside the core runtime.
`);
    return skillDir;
}

function createToolpackFixture(): string {
    const toolpackDir = createTempDir('coworkany-core-regression-toolpack-');
    fs.writeFileSync(path.join(toolpackDir, 'mcp.json'), JSON.stringify({
        id: 'core-regression-toolpack',
        name: 'Core Regression Toolpack',
        version: '1.0.0',
        description: 'core regression fixture toolpack',
        runtime: 'internal',
        tools: ['search_web'],
        effects: ['network:outbound'],
    }, null, 2));
    return toolpackDir;
}

function createCoreShadowToolpackFixture(): string {
    const toolpackDir = createTempDir('coworkany-core-shadow-toolpack-');
    fs.writeFileSync(path.join(toolpackDir, 'mcp.json'), JSON.stringify({
        id: CORE_TOOLPACK_ID,
        name: 'Shadow Standard Tools',
        version: '1.0.0',
        description: 'invalid core shadow fixture',
        runtime: 'internal',
        tools: ['search_web'],
        effects: ['network:outbound'],
    }, null, 2));
    return toolpackDir;
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

describe('core/full capability regression path', () => {
    test('core profile starts with visible standard-tools only and can install skill/toolpack explicitly', async () => {
        setEnv({
            COWORKANY_RUNTIME_PROFILE: 'core',
            COWORKANY_ENABLE_BUILTIN_SKILLS: undefined,
            COWORKANY_ENABLE_BUILTIN_TOOLPACKS: undefined,
        });
        const workspaceRoot = createTempDir('coworkany-core-regression-workspace-');
        const appDataRoot = createTempDir('coworkany-core-regression-appdata-');
        const { handler, skillStore, toolpackStore } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const listedBefore = await handler(createCommand('list_toolpacks', { includeDisabled: true }));
        const toolpacksBefore = ((listedBefore?.payload as Record<string, unknown>)?.toolpacks ?? []) as Array<Record<string, unknown>>;
        expect(toolpacksBefore).toHaveLength(1);
        expect((toolpacksBefore[0]?.manifest as Record<string, unknown> | undefined)?.id).toBe(CORE_TOOLPACK_ID);
        expect(((toolpacksBefore[0]?.manifest as Record<string, unknown>).tools as string[])).toEqual([...CORE_BASELINE_TOOL_IDS]);

        const skillDir = createSkillFixture();
        const importedSkill = await handler(createCommand('import_claude_skill', { path: skillDir }));
        expect(importedSkill?.type).toBe('import_claude_skill_response');
        expect((importedSkill?.payload as Record<string, unknown>)?.success).toBe(true);
        expect(skillStore.get('core-regression-skill')?.enabled).toBe(true);

        const toolpackDir = createToolpackFixture();
        const installedToolpack = await handler(createCommand('install_toolpack', { path: toolpackDir }));
        expect(installedToolpack?.type).toBe('install_toolpack_response');
        expect((installedToolpack?.payload as Record<string, unknown>)?.success).toBe(true);
        expect(toolpackStore.getById('core-regression-toolpack')?.enabled).toBe(true);

        const toolsets = buildInternalRuntimeToolsets({
            toolpacks: toolpackStore.listEnabled(),
            resolveTool: resolveRuntimeInternalTool,
        });
        expect(toolsets[`internal:${CORE_TOOLPACK_ID}`]?.voice_speak).toBeUndefined();
        expect(toolsets[`internal:${CORE_TOOLPACK_ID}`]?.run_command).toBeDefined();
        expect(toolsets['internal:core-regression-toolpack']?.search_web).toBeDefined();
        expect(countToolsInToolsets(toolsets)).toBe(CORE_BASELINE_TOOL_IDS.length + 1);
    });

    test('core standard toolpack is immutable and cannot be shadowed by installs', async () => {
        setEnv({
            COWORKANY_RUNTIME_PROFILE: 'core',
            COWORKANY_ENABLE_BUILTIN_SKILLS: undefined,
            COWORKANY_ENABLE_BUILTIN_TOOLPACKS: undefined,
        });
        const workspaceRoot = createTempDir('coworkany-core-immutable-workspace-');
        const appDataRoot = createTempDir('coworkany-core-immutable-appdata-');
        const { handler, toolpackStore } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const disable = await handler(createCommand('set_toolpack_enabled', {
            toolpackId: CORE_TOOLPACK_ID,
            enabled: false,
        }));
        expect(disable?.type).toBe('set_toolpack_enabled_response');
        expect((disable?.payload as Record<string, unknown>)?.success).toBe(false);
        expect((disable?.payload as Record<string, unknown>)?.error).toBe('toolpack_not_mutable');
        expect(toolpackStore.listEnabled().some((toolpack) => toolpack.manifest.id === CORE_TOOLPACK_ID)).toBe(true);

        const shadowDir = createCoreShadowToolpackFixture();
        const installShadow = await handler(createCommand('install_toolpack', { path: shadowDir }));
        expect(installShadow?.type).toBe('install_toolpack_response');
        expect((installShadow?.payload as Record<string, unknown>)?.success).toBe(false);
        expect((installShadow?.payload as Record<string, unknown>)?.error).toBe('core_toolpack_immutable');

        const remove = await handler(createCommand('remove_toolpack', { toolpackId: CORE_TOOLPACK_ID }));
        expect(remove?.type).toBe('remove_toolpack_response');
        expect((remove?.payload as Record<string, unknown>)?.success).toBe(false);

        const listed = toolpackStore.list();
        expect(listed.filter((toolpack) => toolpack.manifest.id === CORE_TOOLPACK_ID)).toHaveLength(1);
        expect(listed.find((toolpack) => toolpack.manifest.id === CORE_TOOLPACK_ID)?.manifest.tools).toEqual([...CORE_BASELINE_TOOL_IDS]);
    });

    test('full profile keeps builtin skills/toolpacks while preserving the same core baseline', () => {
        setEnv({
            COWORKANY_RUNTIME_PROFILE: 'full',
            COWORKANY_ENABLE_BUILTIN_SKILLS: undefined,
            COWORKANY_ENABLE_BUILTIN_TOOLPACKS: undefined,
        });
        const workspaceRoot = createTempDir('coworkany-full-regression-workspace-');
        const toolpackStore = new ToolpackStore(workspaceRoot);
        const listed = toolpackStore.list();

        const standard = listed.find((toolpack) => toolpack.manifest.id === CORE_TOOLPACK_ID);
        expect(standard?.manifest.tools).toEqual([...CORE_BASELINE_TOOL_IDS]);
        expect(standard?.manifest.tools).not.toContain('voice_speak');
        expect(listed.some((toolpack) => toolpack.manifest.id === 'builtin-websearch')).toBe(true);
        expect(listed.some((toolpack) => toolpack.manifest.id === 'builtin-voice')).toBe(true);
    });
});
