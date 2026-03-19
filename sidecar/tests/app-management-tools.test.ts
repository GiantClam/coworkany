import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SkillStore } from '../src/storage/skillStore';
import { WorkspaceStore } from '../src/storage/workspaceStore';
import { createAppManagementTools } from '../src/tools/appManagement';

const tempPaths: string[] = [];

afterEach(() => {
    while (tempPaths.length > 0) {
        const target = tempPaths.pop();
        if (target) {
            fs.rmSync(target, { recursive: true, force: true });
        }
    }
});

function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempPaths.push(dir);
    return dir;
}

function buildTools(options?: {
    applyLlmConfig?: (config: Record<string, unknown>) => void;
    importSkillFromDirectory?: (inputPath: string, autoInstallDependencies?: boolean) => Promise<any>;
}) {
    const workspaceRoot = makeTempDir('coworkany-app-tools-workspace-');
    const appDataRoot = makeTempDir('coworkany-app-tools-data-');
    const skillStore = new SkillStore(workspaceRoot);
    const workspaceStore = new WorkspaceStore(appDataRoot);
    const tools = createAppManagementTools({
        workspaceRoot,
        getResolvedAppDataRoot: () => appDataRoot,
        skillStore,
        workspaceStore,
        applyLlmConfig: options?.applyLlmConfig as any,
        importSkillFromDirectory: options?.importSkillFromDirectory,
    });

    return {
        workspaceRoot,
        appDataRoot,
        skillStore,
        workspaceStore,
        tools,
    };
}

function getTool(tools: ReturnType<typeof buildTools>['tools'], name: string) {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) {
        throw new Error(`Tool not found: ${name}`);
    }
    return tool;
}

const TOOL_CONTEXT = {
    workspacePath: '/tmp',
    taskId: 'task-test',
};

describe('app management tools', () => {
    test('get_coworkany_config redacts secrets by default and reveals them when requested', async () => {
        const fixture = buildTools();
        fs.writeFileSync(
            path.join(fixture.appDataRoot, 'llm-config.json'),
            JSON.stringify({
                provider: 'anthropic',
                search: {
                    provider: 'serper',
                    serperApiKey: 'serper-secret-value',
                },
            })
        );

        const tool = getTool(fixture.tools, 'get_coworkany_config');
        const redacted = await tool.handler({ field_path: 'search.serperApiKey' }, TOOL_CONTEXT);
        const revealed = await tool.handler({ field_path: 'search.serperApiKey', reveal_secret: true }, TOOL_CONTEXT);

        expect(redacted.found).toBe(true);
        expect(redacted.value).toBe('[REDACTED]');
        expect(revealed.value).toBe('serper-secret-value');
    });

    test('update_coworkany_config writes to app-data llm-config.json and applies runtime config', async () => {
        const applied: Array<Record<string, unknown>> = [];
        const fixture = buildTools({
            applyLlmConfig: (config) => {
                applied.push(config);
            },
        });

        const tool = getTool(fixture.tools, 'update_coworkany_config');
        const response = await tool.handler(
            {
                field_path: 'search.serperApiKey',
                value: 'new-secret',
                reveal_secret: true,
            },
            TOOL_CONTEXT
        );

        const saved = JSON.parse(
            fs.readFileSync(path.join(fixture.appDataRoot, 'llm-config.json'), 'utf-8')
        ) as Record<string, any>;

        expect(response.success).toBe(true);
        expect(response.updatedValue).toBe('new-secret');
        expect(saved.search.serperApiKey).toBe('new-secret');
        expect(applied).toHaveLength(1);
        expect(applied[0]?.search).toEqual({
            serperApiKey: 'new-secret',
        });
    });

    test('workspace tools create, list, update, and delete managed workspaces', async () => {
        const fixture = buildTools();
        const createTool = getTool(fixture.tools, 'create_coworkany_workspace');
        const listTool = getTool(fixture.tools, 'list_coworkany_workspaces');
        const updateTool = getTool(fixture.tools, 'update_coworkany_workspace');
        const deleteTool = getTool(fixture.tools, 'delete_coworkany_workspace');

        const created = await createTool.handler({ name: 'Demo Workspace', path: 'default' }, TOOL_CONTEXT);
        const workspaceId = created.workspace.id as string;
        const workspacePath = created.workspace.path as string;
        const listed = await listTool.handler({}, TOOL_CONTEXT);
        const updated = await updateTool.handler({ id: workspaceId, updates: { name: 'Renamed Workspace' } }, TOOL_CONTEXT);
        const deleted = await deleteTool.handler({ id: workspaceId }, TOOL_CONTEXT);

        expect(created.success).toBe(true);
        expect(workspacePath).toStartWith(path.join(fixture.appDataRoot, 'workspaces'));
        expect(fs.existsSync(path.join(workspacePath, '.coworkany', 'skills'))).toBe(true);
        expect(listed.workspaces).toHaveLength(1);
        expect(updated.workspace.name).toBe('Renamed Workspace');
        expect(deleted.success).toBe(true);
        expect(fixture.workspaceStore.list()).toHaveLength(0);
    });

    test('skill tools install, disable, inspect, and remove local skills', async () => {
        const fixture = buildTools();
        const skillDir = makeTempDir('coworkany-app-tool-skill-');
        fs.writeFileSync(
            path.join(skillDir, 'SKILL.md'),
            `---
name: Demo Managed Skill
version: 1.0.0
description: Demo managed skill
---

# Demo Managed Skill
`
        );

        const installTool = getTool(fixture.tools, 'install_coworkany_skill');
        const setEnabledTool = getTool(fixture.tools, 'set_coworkany_skill_enabled');
        const getToolById = getTool(fixture.tools, 'get_coworkany_skill');
        const removeTool = getTool(fixture.tools, 'remove_coworkany_skill');

        const installed = await installTool.handler({ path: skillDir }, TOOL_CONTEXT);
        const disabled = await setEnabledTool.handler({ skill_id: 'Demo Managed Skill', enabled: false }, TOOL_CONTEXT);
        const inspected = await getToolById.handler({ skill_id: 'Demo Managed Skill' }, TOOL_CONTEXT);
        const removed = await removeTool.handler({ skill_id: 'Demo Managed Skill' }, TOOL_CONTEXT);

        expect(installed.success).toBe(true);
        expect(installed.skillId).toBe('Demo Managed Skill');
        expect(disabled.success).toBe(true);
        expect(inspected.found).toBe(true);
        expect(inspected.skill.enabled).toBe(false);
        expect(removed.success).toBe(true);
        expect(removed.filesDeleted).toBe(true);
        expect(fs.existsSync(skillDir)).toBe(false);
    });
});
