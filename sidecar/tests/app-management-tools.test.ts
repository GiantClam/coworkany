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
    downloadSkillFromGitHub?: (source: string, workspacePath: string) => Promise<any>;
    searchClawHubSkills?: (query: string, limit?: number) => Promise<any>;
    installSkillFromClawHub?: (skillName: string, targetDir: string) => Promise<any>;
    getSkillhubExecutable?: () => string | undefined;
    getExtensionGovernanceStore?: () => { get: (...args: any[]) => any; markApproved: (...args: any[]) => any };
    onSkillsUpdated?: () => void;
}) {
    const workspaceRoot = makeTempDir('coworkany-app-tools-workspace-');
    const appDataRoot = makeTempDir('coworkany-app-tools-data-');
    const skillStore = new SkillStore(workspaceRoot);
    const workspaceStore = new WorkspaceStore(appDataRoot);
    const tools = createAppManagementTools({
        workspaceRoot,
        getResolvedAppDataRoot: () => appDataRoot,
        skillStore,
        getExtensionGovernanceStore: options?.getExtensionGovernanceStore as any,
        workspaceStore,
        applyLlmConfig: options?.applyLlmConfig as any,
        importSkillFromDirectory: options?.importSkillFromDirectory,
        downloadSkillFromGitHub: options?.downloadSkillFromGitHub,
        searchClawHubSkills: options?.searchClawHubSkills,
        installSkillFromClawHub: options?.installSkillFromClawHub,
        getSkillhubExecutable: options?.getSkillhubExecutable,
        onSkillsUpdated: options?.onSkillsUpdated,
    });

    return {
        workspaceRoot,
        appDataRoot,
        skillStore,
        workspaceStore,
        tools,
    };
}

function createFakeSkillhubCli(slug = 'skill-vetter'): string {
    const cliDir = makeTempDir('coworkany-fake-skillhub-');
    const cliPath = path.join(cliDir, 'skillhub');
    fs.writeFileSync(
        cliPath,
        `#!/bin/sh
set -eu
if [ "$1" = "--skip-self-upgrade" ]; then
  shift
fi
if [ "$1" = "search" ]; then
  echo '{"results":[{"slug":"${slug}","name":"${slug}","description":"Vet installed skills"}]}'
  exit 0
fi
if [ "$1" = "--dir" ]; then
  INSTALL_DIR="$2"
  shift 2
fi
if [ "$1" = "install" ]; then
  TARGET="$2"
  mkdir -p "$INSTALL_DIR/$TARGET"
  cat > "$INSTALL_DIR/$TARGET/SKILL.md" <<'EOF'
---
name: ${slug}
version: 1.0.0
description: Vet installed skills
triggers:
  - vet skill
  - check skills
---

# ${slug}
EOF
  exit 0
fi
echo "unsupported" >&2
exit 1
`,
        'utf-8'
    );
    fs.chmodSync(cliPath, 0o755);
    return cliPath;
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

    test('extension allowlist tools read and persist workspace policy', async () => {
        const fixture = buildTools();
        const getToolByName = getTool(fixture.tools, 'get_coworkany_extension_allowlist');
        const setToolByName = getTool(fixture.tools, 'set_coworkany_extension_allowlist');

        const initial = await getToolByName.handler({}, TOOL_CONTEXT);
        const updated = await setToolByName.handler({
            mode: 'enforce',
            allowed_skill_ids: ['Approved Skill'],
            allowed_toolpack_ids: ['approved-toolpack'],
        }, TOOL_CONTEXT);
        const reloaded = await getToolByName.handler({}, TOOL_CONTEXT);

        expect(initial.policy.mode).toBe('off');
        expect(updated.success).toBe(true);
        expect(updated.policy.mode).toBe('enforce');
        expect(updated.policy.allowedSkills).toEqual(['Approved Skill']);
        expect(updated.policy.allowedToolpacks).toEqual(['approved-toolpack']);
        expect(reloaded.policy.mode).toBe('enforce');
    });

    test('skill tools keep skills enabled after install until user disables or uninstalls', async () => {
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
        const listTool = getTool(fixture.tools, 'list_coworkany_skills');
        const removeTool = getTool(fixture.tools, 'remove_coworkany_skill');

        const installed = await installTool.handler({ path: skillDir }, TOOL_CONTEXT);
        const inspectedAfterInstall = await getToolById.handler({ skill_id: 'Demo Managed Skill' }, TOOL_CONTEXT);
        const listedAfterInstall = await listTool.handler({}, TOOL_CONTEXT);
        const disabled = await setEnabledTool.handler({ skill_id: 'Demo Managed Skill', enabled: false }, TOOL_CONTEXT);
        const inspectedAfterDisable = await getToolById.handler({ skill_id: 'Demo Managed Skill' }, TOOL_CONTEXT);
        const reEnabled = await setEnabledTool.handler({ skill_id: 'Demo Managed Skill', enabled: true }, TOOL_CONTEXT);
        const inspectedAfterReEnable = await getToolById.handler({ skill_id: 'Demo Managed Skill' }, TOOL_CONTEXT);
        const removed = await removeTool.handler({ skill_id: 'Demo Managed Skill' }, TOOL_CONTEXT);
        const inspectedAfterRemove = await getToolById.handler({ skill_id: 'Demo Managed Skill' }, TOOL_CONTEXT);

        expect(installed.success).toBe(true);
        expect(installed.skillId).toBe('Demo Managed Skill');
        expect(inspectedAfterInstall.found).toBe(true);
        expect(inspectedAfterInstall.skill.enabled).toBe(true);
        expect(
            listedAfterInstall.skills.some((skill: any) => skill.id === 'Demo Managed Skill' && skill.enabled === true),
        ).toBe(true);
        expect(disabled.success).toBe(true);
        expect(inspectedAfterDisable.found).toBe(true);
        expect(inspectedAfterDisable.skill.enabled).toBe(false);
        expect(reEnabled.success).toBe(true);
        expect(inspectedAfterReEnable.found).toBe(true);
        expect(inspectedAfterReEnable.skill.enabled).toBe(true);
        expect(removed.success).toBe(true);
        expect(removed.filesDeleted).toBe(true);
        expect(inspectedAfterRemove.found).toBe(false);
        expect(fs.existsSync(skillDir)).toBe(false);
    });

    test('set_coworkany_skill_enabled blocks non-allowlisted skill enablement in enforce mode', async () => {
        const fixture = buildTools();
        const skillDir = makeTempDir('coworkany-app-tool-allowlist-skill-');
        fs.writeFileSync(
            path.join(skillDir, 'SKILL.md'),
            `---
name: Blocked Managed Skill
version: 1.0.0
description: Blocked by allowlist
---

# Blocked Managed Skill
`
        );

        const installTool = getTool(fixture.tools, 'install_coworkany_skill');
        const setEnabledTool = getTool(fixture.tools, 'set_coworkany_skill_enabled');
        const setAllowlistTool = getTool(fixture.tools, 'set_coworkany_extension_allowlist');

        const installed = await installTool.handler({ path: skillDir }, TOOL_CONTEXT);
        expect(installed.success).toBe(true);
        await setAllowlistTool.handler({
            mode: 'enforce',
            allowed_skill_ids: ['Approved Skill'],
        }, TOOL_CONTEXT);

        const enableAttempt = await setEnabledTool.handler(
            { skill_id: 'Blocked Managed Skill', enabled: true },
            TOOL_CONTEXT,
        );

        expect(enableAttempt.success).toBe(false);
        expect(enableAttempt.error).toBe('workspace_extension_not_allowlisted');
    });

    test('approve skill governance review explicitly approves pending review and re-enables skill', async () => {
        const states = new Map<string, any>();
        const fixture = buildTools({
            getExtensionGovernanceStore: () => ({
                get: (_type, id) => states.get(id),
                markApproved: (_type, id) => {
                    const current = states.get(id);
                    if (!current) return undefined;
                    const approved = {
                        ...current,
                        pendingReview: false,
                        quarantined: false,
                        lastDecision: 'approved',
                        approvedAt: new Date().toISOString(),
                        lastUpdatedAt: new Date().toISOString(),
                    };
                    states.set(id, approved);
                    return approved;
                },
            }),
        });
        const skillDir = makeTempDir('coworkany-app-tool-approve-skill-');
        fs.writeFileSync(
            path.join(skillDir, 'SKILL.md'),
            `---
name: Pending Managed Skill
version: 1.0.0
description: Pending managed skill
---

# Pending Managed Skill
`
        );

        const installTool = getTool(fixture.tools, 'install_coworkany_skill');
        const approveTool = getTool(fixture.tools, 'approve_coworkany_skill_governance_review');

        const installed = await installTool.handler({ path: skillDir }, TOOL_CONTEXT);
        expect(installed.success).toBe(true);
        fixture.skillStore.setEnabled('Pending Managed Skill', false);
        states.set('Pending Managed Skill', {
            extensionType: 'skill',
            extensionId: 'Pending Managed Skill',
            pendingReview: true,
            quarantined: true,
            lastDecision: 'pending',
            lastReviewReason: 'first_install_review',
            lastReviewSummary: 'First install review required',
            lastUpdatedAt: new Date().toISOString(),
        });

        const approved = await approveTool.handler({ skill_id: 'Pending Managed Skill' }, TOOL_CONTEXT);

        expect(approved.success).toBe(true);
        expect(approved.enabled).toBe(true);
        expect(approved.governanceState.pendingReview).toBe(false);
        expect(approved.governanceState.lastDecision).toBe('approved');
    });

    test('marketplace install tool installs and enables a skill from GitHub source', async () => {
        const fixture = buildTools({
            downloadSkillFromGitHub: async (_source, workspacePath) => {
                const skillDir = path.join(workspacePath, '.coworkany', 'skills', 'repo-skill');
                fs.mkdirSync(skillDir, { recursive: true });
                fs.writeFileSync(
                    path.join(skillDir, 'SKILL.md'),
                    `---
name: Repo Skill
version: 1.0.0
description: Repo managed skill
triggers:
  - repo skill
---

# Repo Skill
`,
                    'utf-8'
                );
                return {
                    success: true,
                    path: skillDir,
                    filesDownloaded: 1,
                };
            },
        });

        const tool = getTool(fixture.tools, 'install_coworkany_skill_from_marketplace');
        const response = await tool.handler(
            {
                source: 'openai/repo-skill',
                marketplace: 'github',
            },
            TOOL_CONTEXT
        );

        expect(response.success).toBe(true);
        expect(response.marketplace).toBe('github');
        expect(response.skillId).toBe('Repo Skill');
        expect(response.enabled).toBe(true);
        expect(response.source).toBe('github:openai/repo-skill');
        expect(response.message).toContain('已从 github 安装并启用技能');
    });

    test('marketplace install message surfaces governance review summary and permission expansion delta', async () => {
        let skillStoreRef: SkillStore | undefined;
        const fixture = buildTools({
            downloadSkillFromGitHub: async (_source, workspacePath) => {
                const skillDir = path.join(workspacePath, '.coworkany', 'skills', 'governed-repo-skill');
                fs.mkdirSync(skillDir, { recursive: true });
                fs.writeFileSync(
                    path.join(skillDir, 'SKILL.md'),
                    `---
name: Governed Repo Skill
version: 2.0.0
description: Repo skill with governance review
---

# Governed Repo Skill
`,
                    'utf-8'
                );
                return {
                    success: true,
                    path: skillDir,
                    filesDownloaded: 1,
                };
            },
            importSkillFromDirectory: async (inputPath) => {
                const manifest = SkillStore.loadFromDirectory(inputPath);
                if (manifest) {
                    skillStoreRef?.install(manifest as any);
                }
                return {
                    success: true,
                    skillId: manifest?.name,
                    governanceReview: {
                        extensionType: 'skill',
                        extensionId: manifest?.name ?? 'Governed Repo Skill',
                        installKind: 'update',
                        reviewRequired: true,
                        blocking: false,
                        reason: 'permission_expansion',
                        summary: '权限扩展需要显式批准后再上线。',
                        before: {
                            tools: ['read_file'],
                            effects: ['filesystem:read'],
                            capabilities: [],
                            bins: [],
                            env: [],
                            config: [],
                        },
                        after: {
                            tools: ['read_file', 'write_file'],
                            effects: ['filesystem:read', 'filesystem:write'],
                            capabilities: ['codegen'],
                            bins: [],
                            env: ['OPENAI_API_KEY'],
                            config: ['approval.mode'],
                        },
                        delta: {
                            added: {
                                tools: ['write_file'],
                                effects: ['filesystem:write'],
                                capabilities: ['codegen'],
                                bins: [],
                                env: ['OPENAI_API_KEY'],
                                config: ['approval.mode'],
                            },
                            removed: {
                                tools: [],
                                effects: [],
                                capabilities: [],
                                bins: [],
                                env: [],
                                config: [],
                            },
                        },
                    },
                    governanceState: {
                        extensionType: 'skill',
                        extensionId: manifest?.name ?? 'Governed Repo Skill',
                        pendingReview: true,
                        quarantined: true,
                        lastDecision: 'pending',
                        lastReviewReason: 'permission_expansion',
                        lastReviewSummary: '权限扩展需要审批',
                        lastUpdatedAt: new Date().toISOString(),
                    },
                };
            },
        });
        skillStoreRef = fixture.skillStore;

        const tool = getTool(fixture.tools, 'install_coworkany_skill_from_marketplace');
        const response = await tool.handler(
            {
                source: 'openai/governed-repo-skill',
                marketplace: 'github',
            },
            TOOL_CONTEXT
        );

        expect(response.success).toBe(true);
        expect(response.message).toContain('治理审查：权限扩展需要显式批准后再上线。');
        expect(response.message).toContain('权限增量：');
        expect(response.message).toContain('tools:write_file');
        expect(response.message).toContain('effects:filesystem:write');
        expect(response.message).toContain('env:OPENAI_API_KEY');
    });

    test('marketplace install tool searches skillhub, installs the selected skill, and returns usage guidance', async () => {
        const fixture = buildTools({
            getSkillhubExecutable: () => createFakeSkillhubCli(),
        });

        const tool = getTool(fixture.tools, 'install_coworkany_skill_from_marketplace');
        const response = await tool.handler(
            {
                source: 'skill-vetter',
                marketplace: 'skillhub',
            },
            TOOL_CONTEXT
        );

        expect(response.success).toBe(true);
        expect(response.marketplace).toBe('skillhub');
        expect(response.skillId).toBe('skill-vetter');
        expect(response.enabled).toBe(true);
        expect(Array.isArray(response.usageGuidance)).toBe(true);
        expect(response.message).toContain('skillhub');
        expect(response.message).toContain('SKILL.md');
    });

    test('marketplace install tool searches clawhub, installs the selected skill, and returns usage guidance', async () => {
        const fixture = buildTools({
            searchClawHubSkills: async () => [{
                name: 'claw-vetter',
                description: 'Vet OpenClaw skills',
                author: 'OpenClaw Community',
                version: '1.0.0',
                downloads: 42,
                stars: 7,
                tags: ['vet'],
                repoUrl: 'https://example.com/openclaw/claw-vetter',
                files: ['SKILL.md'],
            }],
            installSkillFromClawHub: async (skillName, targetDir) => {
                const skillDir = path.join(targetDir, skillName);
                fs.mkdirSync(skillDir, { recursive: true });
                fs.writeFileSync(
                    path.join(skillDir, 'SKILL.md'),
                    `---
name: Claw Vetter
version: 1.0.0
description: Vet clawhub skills
triggers:
  - claw vet
---

# Claw Vetter
`,
                    'utf-8'
                );
                return {
                    success: true,
                    path: skillDir,
                };
            },
        });

        const tool = getTool(fixture.tools, 'install_coworkany_skill_from_marketplace');
        const response = await tool.handler(
            {
                source: 'claw-vetter',
                marketplace: 'clawhub',
            },
            TOOL_CONTEXT
        );

        expect(response.success).toBe(true);
        expect(response.marketplace).toBe('clawhub');
        expect(response.skillId).toBe('Claw Vetter');
        expect(response.enabled).toBe(true);
        expect(Array.isArray(response.usageGuidance)).toBe(true);
        expect(response.message).toContain('clawhub');
        expect(response.message).toContain('SKILL.md');
    });
});
