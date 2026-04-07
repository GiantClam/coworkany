import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createMastraAdditionalCommandHandler } from '../src/mastra/additionalCommands';
import { SkillStore } from '../src/storage/skillStore';

function createCommand(
    type: string,
    payload: Record<string, unknown>,
): Record<string, unknown> {
    return {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type,
        payload,
    };
}

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

describe('mastra additional command handler', () => {
    test('handles workspace lifecycle commands', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-workspace-');
        const appDataRoot = createTempDir('coworkany-mastra-appdata-');
        const { handler } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const listBefore = await handler(createCommand('list_workspaces', {}));
        expect(listBefore?.type).toBe('list_workspaces_response');
        expect(((listBefore?.payload as Record<string, unknown>)?.workspaces as unknown[]).length).toBe(0);

        const createResponse = await handler(createCommand('create_workspace', {
            name: 'Mastra Workspace',
            path: 'default',
        }));
        expect(createResponse?.type).toBe('create_workspace_response');
        const createPayload = createResponse?.payload as Record<string, unknown>;
        expect(createPayload.success).toBe(true);
        const workspace = createPayload.workspace as Record<string, unknown>;
        const workspacePath = workspace.path as string;
        expect(workspacePath.startsWith(path.join(appDataRoot, 'workspaces'))).toBe(true);

        const listAfter = await handler(createCommand('list_workspaces', {}));
        const workspaces = (listAfter?.payload as Record<string, unknown>)?.workspaces as Array<Record<string, unknown>>;
        expect(workspaces.length).toBe(1);
        expect(workspaces[0]?.name).toBe('Mastra Workspace');
    });

    test('handles capability and directive management commands', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-capability-');
        const appDataRoot = createTempDir('coworkany-mastra-capability-appdata-');
        const { handler } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const toolpacks = await handler(createCommand('list_toolpacks', {
            includeDisabled: true,
        }));
        expect(toolpacks?.type).toBe('list_toolpacks_response');
        expect(Array.isArray((toolpacks?.payload as Record<string, unknown>)?.toolpacks)).toBe(true);

        const skills = await handler(createCommand('list_claude_skills', {
            includeDisabled: true,
        }));
        expect(skills?.type).toBe('list_claude_skills_response');
        expect(Array.isArray((skills?.payload as Record<string, unknown>)?.skills)).toBe(true);

        const listDirectives = await handler(createCommand('list_directives', {}));
        expect(listDirectives?.type).toBe('list_directives_response');
        const defaultDirectives = (listDirectives?.payload as Record<string, unknown>)?.directives as Array<Record<string, unknown>>;
        expect(defaultDirectives.length).toBeGreaterThan(0);

        const upsert = await handler(createCommand('upsert_directive', {
            directive: {
                id: 'mastra-test',
                name: 'Mastra Test',
                content: 'Test content',
                enabled: true,
                priority: 10,
            },
        }));
        expect(upsert?.type).toBe('upsert_directive_response');
        expect((upsert?.payload as Record<string, unknown>)?.success).toBe(true);

        const remove = await handler(createCommand('remove_directive', {
            directiveId: 'mastra-test',
        }));
        expect(remove?.type).toBe('remove_directive_response');
        expect((remove?.payload as Record<string, unknown>)?.success).toBe(true);
    });

    test('skill lifecycle commands install, toggle, and uninstall skill correctly', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-skill-lifecycle-');
        const appDataRoot = createTempDir('coworkany-mastra-skill-lifecycle-appdata-');
        const skillDir = createTempDir('coworkany-mastra-skill-lifecycle-source-');
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: lifecycle-skill
version: 1.0.0
description: lifecycle test skill
---

# lifecycle-skill
`);

        const { handler, skillStore } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const imported = await handler(createCommand('import_claude_skill', {
            path: skillDir,
        }));
        const importedPayload = (imported?.payload ?? {}) as Record<string, unknown>;
        expect(imported?.type).toBe('import_claude_skill_response');
        expect(importedPayload.success).toBe(true);
        expect(importedPayload.skillId).toBe('lifecycle-skill');
        expect(skillStore.get('lifecycle-skill')?.enabled).toBe(true);

        const disabled = await handler(createCommand('set_claude_skill_enabled', {
            skillId: 'lifecycle-skill',
            enabled: false,
        }));
        expect(disabled?.type).toBe('set_claude_skill_enabled_response');
        expect((disabled?.payload as Record<string, unknown>)?.success).toBe(true);
        expect(skillStore.get('lifecycle-skill')?.enabled).toBe(false);

        const reEnabled = await handler(createCommand('set_claude_skill_enabled', {
            skillId: 'lifecycle-skill',
            enabled: true,
        }));
        expect(reEnabled?.type).toBe('set_claude_skill_enabled_response');
        expect((reEnabled?.payload as Record<string, unknown>)?.success).toBe(true);
        expect(skillStore.get('lifecycle-skill')?.enabled).toBe(true);

        const removed = await handler(createCommand('remove_claude_skill', {
            skillId: 'lifecycle-skill',
            deleteFiles: true,
        }));
        expect(removed?.type).toBe('remove_claude_skill_response');
        expect((removed?.payload as Record<string, unknown>)?.success).toBe(true);
        expect(skillStore.get('lifecycle-skill')).toBeUndefined();
        expect(fs.existsSync(skillDir)).toBe(false);
    });

    test('toolpack lifecycle commands install, toggle, and remove toolpack correctly', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-toolpack-lifecycle-');
        const appDataRoot = createTempDir('coworkany-mastra-toolpack-lifecycle-appdata-');
        const toolpackDir = createTempDir('coworkany-mastra-toolpack-lifecycle-source-');
        fs.writeFileSync(path.join(toolpackDir, 'mcp.json'), JSON.stringify({
            id: 'lifecycle-toolpack',
            name: 'Lifecycle Toolpack',
            version: '1.0.0',
            description: 'lifecycle test toolpack',
            runtime: 'stdio',
            tools: ['tool_a', 'tool_b'],
            effects: [],
        }, null, 2));

        const { handler } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const installed = await handler(createCommand('install_toolpack', {
            path: toolpackDir,
        }));
        const installedPayload = (installed?.payload ?? {}) as Record<string, unknown>;
        expect(installed?.type).toBe('install_toolpack_response');
        expect(installedPayload.success).toBe(true);

        const listAfterInstall = await handler(createCommand('list_toolpacks', {
            includeDisabled: true,
        }));
        const listAfterInstallPayload = (listAfterInstall?.payload ?? {}) as Record<string, unknown>;
        const listedToolpacks = Array.isArray(listAfterInstallPayload.toolpacks)
            ? listAfterInstallPayload.toolpacks as Array<Record<string, unknown>>
            : [];
        expect(
            listedToolpacks.some((item) => {
                const manifest = ((item.manifest ?? {}) as Record<string, unknown>);
                return manifest.id === 'lifecycle-toolpack';
            }),
        ).toBe(true);

        const disabled = await handler(createCommand('set_toolpack_enabled', {
            toolpackId: 'lifecycle-toolpack',
            enabled: false,
        }));
        expect(disabled?.type).toBe('set_toolpack_enabled_response');
        expect((disabled?.payload as Record<string, unknown>)?.success).toBe(true);

        const reEnabled = await handler(createCommand('set_toolpack_enabled', {
            toolpackId: 'lifecycle-toolpack',
            enabled: true,
        }));
        expect(reEnabled?.type).toBe('set_toolpack_enabled_response');
        expect((reEnabled?.payload as Record<string, unknown>)?.success).toBe(true);

        const removed = await handler(createCommand('remove_toolpack', {
            toolpackId: 'lifecycle-toolpack',
        }));
        expect(removed?.type).toBe('remove_toolpack_response');
        expect((removed?.payload as Record<string, unknown>)?.success).toBe(true);

        const listAfterRemove = await handler(createCommand('list_toolpacks', {
            includeDisabled: true,
        }));
        const listAfterRemovePayload = (listAfterRemove?.payload ?? {}) as Record<string, unknown>;
        const toolpacksAfterRemove = Array.isArray(listAfterRemovePayload.toolpacks)
            ? listAfterRemovePayload.toolpacks as Array<Record<string, unknown>>
            : [];
        expect(
            toolpacksAfterRemove.some((item) => {
                const manifest = ((item.manifest ?? {}) as Record<string, unknown>);
                return manifest.id === 'lifecycle-toolpack';
            }),
        ).toBe(false);
    });

    test('scan_default_repos + validate_github_url + install_from_github(skill/mcp) are supported', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-marketplace-');
        const appDataRoot = createTempDir('coworkany-mastra-marketplace-appdata-');
        const sourceRoot = createTempDir('coworkany-mastra-marketplace-source-');
        const skillSourceDir = path.join(sourceRoot, 'skill-from-local-source');
        const mcpSourceDir = path.join(sourceRoot, 'mcp-from-local-source');
        fs.mkdirSync(skillSourceDir, { recursive: true });
        fs.mkdirSync(mcpSourceDir, { recursive: true });
        fs.writeFileSync(path.join(skillSourceDir, 'SKILL.md'), `---
name: marketplace-local-skill
version: 1.0.0
description: skill installed from local source through install_from_github
---

# marketplace-local-skill
`);
        fs.writeFileSync(path.join(mcpSourceDir, 'mcp.json'), JSON.stringify({
            id: 'marketplace-local-mcp',
            name: 'Marketplace Local MCP',
            version: '1.0.0',
            description: 'mcp installed from local source through install_from_github',
            runtime: 'stdio',
            tools: ['demo_tool'],
            effects: [],
        }, null, 2));

        const { handler, skillStore } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const scanResponse = await handler(createCommand('scan_default_repos', {}));
        const scanPayload = (scanResponse?.payload ?? {}) as Record<string, unknown>;
        expect(scanResponse?.type).toBe('scan_default_repos_response');
        expect(scanPayload.success).toBe(true);
        expect(Array.isArray(scanPayload.skills)).toBe(true);
        expect(Array.isArray(scanPayload.mcpServers)).toBe(true);

        const invalidValidateResponse = await handler(createCommand('validate_github_url', {
            url: 'not-a-github-url',
            type: 'skill',
        }));
        const invalidValidatePayload = (invalidValidateResponse?.payload ?? {}) as Record<string, unknown>;
        expect(invalidValidateResponse?.type).toBe('validate_github_url_response');
        expect(invalidValidatePayload.valid).toBe(false);

        const installSkillResponse = await handler(createCommand('install_from_github', {
            workspacePath: workspaceRoot,
            source: skillSourceDir,
            targetType: 'skill',
        }));
        const installSkillPayload = (installSkillResponse?.payload ?? {}) as Record<string, unknown>;
        expect(installSkillResponse?.type).toBe('install_from_github_response');
        expect(installSkillPayload.success).toBe(true);
        expect(installSkillPayload.skillId).toBe('marketplace-local-skill');
        expect(skillStore.get('marketplace-local-skill')?.enabled).toBe(true);

        const installMcpResponse = await handler(createCommand('install_from_github', {
            workspacePath: workspaceRoot,
            source: mcpSourceDir,
            targetType: 'mcp',
        }));
        const installMcpPayload = (installMcpResponse?.payload ?? {}) as Record<string, unknown>;
        expect(installMcpResponse?.type).toBe('install_from_github_response');
        expect(installMcpPayload.success).toBe(true);
        const mcpToolpack = (installMcpPayload.toolpack ?? {}) as Record<string, unknown>;
        const manifest = (mcpToolpack.manifest ?? {}) as Record<string, unknown>;
        expect(manifest.id).toBe('marketplace-local-mcp');
    });

    test('marketplace trust policy + audit + rollback commands are supported', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-marketplace-governance-');
        const appDataRoot = createTempDir('coworkany-mastra-marketplace-governance-appdata-');
        const localSkillDir = createTempDir('coworkany-mastra-marketplace-governance-skill-');
        fs.mkdirSync(path.join(workspaceRoot, '.coworkany'), { recursive: true });
        fs.writeFileSync(
            path.join(workspaceRoot, '.coworkany', 'policy-settings.json'),
            JSON.stringify({
                marketplaceTrust: {
                    mode: 'enforce',
                    blockedOwners: ['blocked-owner'],
                    minTrustScore: 20,
                },
            }, null, 2),
            'utf-8',
        );
        fs.writeFileSync(path.join(localSkillDir, 'SKILL.md'), `---
name: marketplace-rollback-skill
version: 1.0.0
description: skill for marketplace rollback test
---

# marketplace-rollback-skill
`);

        const { handler, skillStore } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const policyResponse = await handler(createCommand('get_marketplace_trust_policy', {}));
        const policyPayload = (policyResponse?.payload ?? {}) as Record<string, unknown>;
        const policy = (policyPayload.policy ?? {}) as Record<string, unknown>;
        expect(policyResponse?.type).toBe('get_marketplace_trust_policy_response');
        expect(policyPayload.success).toBe(true);
        expect(policy.mode).toBe('enforce');
        expect((policy.blockedOwners as string[]).includes('blocked-owner')).toBe(true);

        const validateBlocked = await handler(createCommand('validate_github_url', {
            url: 'github:blocked-owner/blocked-repo',
            type: 'skill',
        }));
        const validateBlockedPayload = (validateBlocked?.payload ?? {}) as Record<string, unknown>;
        expect(validateBlocked?.type).toBe('validate_github_url_response');
        expect(validateBlockedPayload.valid).toBe(false);
        expect(validateBlockedPayload.reason).toBe('marketplace_owner_blocked');

        const deniedInstall = await handler(createCommand('install_from_github', {
            workspacePath: workspaceRoot,
            source: 'github:blocked-owner/blocked-repo',
            targetType: 'skill',
        }));
        const deniedPayload = (deniedInstall?.payload ?? {}) as Record<string, unknown>;
        expect(deniedInstall?.type).toBe('install_from_github_response');
        expect(deniedPayload.success).toBe(false);
        expect(deniedPayload.error).toBe('marketplace_owner_blocked');
        expect(typeof deniedPayload.auditEntryId).toBe('string');

        const successInstall = await handler(createCommand('install_from_github', {
            workspacePath: workspaceRoot,
            source: localSkillDir,
            targetType: 'skill',
        }));
        const successPayload = (successInstall?.payload ?? {}) as Record<string, unknown>;
        const successAuditEntryId = String(successPayload.auditEntryId ?? '');
        expect(successInstall?.type).toBe('install_from_github_response');
        expect(successPayload.success).toBe(true);
        expect(successPayload.skillId).toBe('marketplace-rollback-skill');
        expect(skillStore.get('marketplace-rollback-skill')?.enabled).toBe(true);
        expect(successAuditEntryId).not.toBe('');

        const rollback = await handler(createCommand('rollback_marketplace_install', {
            entryId: successAuditEntryId,
        }));
        const rollbackPayload = (rollback?.payload ?? {}) as Record<string, unknown>;
        const rollbackResult = (rollbackPayload.result ?? {}) as Record<string, unknown>;
        expect(rollback?.type).toBe('rollback_marketplace_install_response');
        expect(rollbackPayload.success).toBe(true);
        expect(rollbackResult.targetType).toBe('skill');
        expect(rollbackResult.skillId).toBe('marketplace-rollback-skill');
        expect(skillStore.get('marketplace-rollback-skill')).toBeUndefined();

        const listAudit = await handler(createCommand('list_marketplace_audit_log', {
            limit: 20,
        }));
        const listAuditPayload = (listAudit?.payload ?? {}) as Record<string, unknown>;
        const entries = Array.isArray(listAuditPayload.entries)
            ? listAuditPayload.entries as Array<Record<string, unknown>>
            : [];
        expect(listAudit?.type).toBe('list_marketplace_audit_log_response');
        expect(entries.some((entry) => entry.action === 'install_from_github')).toBe(true);
        expect(entries.some((entry) => entry.action === 'rollback_marketplace_install')).toBe(true);
    });

    test('sync_managed_settings + rollback_managed_settings are supported', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-managed-settings-');
        const appDataRoot = createTempDir('coworkany-mastra-managed-settings-appdata-');
        fs.mkdirSync(path.join(workspaceRoot, '.coworkany'), { recursive: true });
        const policyPath = path.join(workspaceRoot, '.coworkany', 'policy-settings.json');
        const allowlistPath = path.join(workspaceRoot, '.coworkany', 'extension-allowlist.json');
        fs.writeFileSync(policyPath, JSON.stringify({ blockedSkillIds: ['before-sync'] }, null, 2), 'utf-8');
        fs.writeFileSync(allowlistPath, JSON.stringify({ allow: ['before-sync'] }, null, 2), 'utf-8');

        const serverId = `managed-sync-${randomUUID().slice(0, 8)}`;
        const { handler } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const syncResponse = await handler(createCommand('sync_managed_settings', {
            settings: {
                policySettings: { blockedSkillIds: ['after-sync'] },
                extensionAllowlist: { allow: ['after-sync'] },
                mcpServers: [{
                    id: serverId,
                    command: 'npx',
                    args: ['-y', 'demo-managed-sync'],
                    scope: 'project',
                    enabled: true,
                    approved: true,
                }],
            },
        }));
        const syncPayload = (syncResponse?.payload ?? {}) as Record<string, unknown>;
        const syncEntryId = String(syncPayload.syncEntryId ?? '');
        expect(syncResponse?.type).toBe('sync_managed_settings_response');
        expect(syncPayload.success).toBe(true);
        expect(syncEntryId).not.toBe('');
        expect(JSON.parse(fs.readFileSync(policyPath, 'utf-8')).blockedSkillIds[0]).toBe('after-sync');
        expect(JSON.parse(fs.readFileSync(allowlistPath, 'utf-8')).allow[0]).toBe('after-sync');

        const listServersAfterSync = await handler(createCommand('list_mcp_servers', {}));
        const listServersAfterSyncPayload = (listServersAfterSync?.payload ?? {}) as Record<string, unknown>;
        const serversAfterSync = Array.isArray(listServersAfterSyncPayload.servers)
            ? listServersAfterSyncPayload.servers as Array<Record<string, unknown>>
            : [];
        expect(serversAfterSync.some((server) => server.id === serverId)).toBe(true);

        const listSyncLog = await handler(createCommand('list_managed_settings_sync_log', { limit: 10 }));
        const listSyncLogPayload = (listSyncLog?.payload ?? {}) as Record<string, unknown>;
        const syncEntries = Array.isArray(listSyncLogPayload.entries)
            ? listSyncLogPayload.entries as Array<Record<string, unknown>>
            : [];
        expect(syncEntries.some((entry) => entry.id === syncEntryId && entry.action === 'sync')).toBe(true);

        const rollbackResponse = await handler(createCommand('rollback_managed_settings', {
            entryId: syncEntryId,
        }));
        const rollbackPayload = (rollbackResponse?.payload ?? {}) as Record<string, unknown>;
        expect(rollbackResponse?.type).toBe('rollback_managed_settings_response');
        expect(rollbackPayload.success).toBe(true);
        expect(JSON.parse(fs.readFileSync(policyPath, 'utf-8')).blockedSkillIds[0]).toBe('before-sync');
        expect(JSON.parse(fs.readFileSync(allowlistPath, 'utf-8')).allow[0]).toBe('before-sync');

        const listServersAfterRollback = await handler(createCommand('list_mcp_servers', {}));
        const listServersAfterRollbackPayload = (listServersAfterRollback?.payload ?? {}) as Record<string, unknown>;
        const serversAfterRollback = Array.isArray(listServersAfterRollbackPayload.servers)
            ? listServersAfterRollbackPayload.servers as Array<Record<string, unknown>>
            : [];
        expect(serversAfterRollback.some((server) => server.id === serverId)).toBe(false);

        const listRollbackLog = await handler(createCommand('list_managed_settings_sync_log', {
            limit: 10,
            action: 'rollback',
        }));
        const listRollbackLogPayload = (listRollbackLog?.payload ?? {}) as Record<string, unknown>;
        const rollbackEntries = Array.isArray(listRollbackLogPayload.entries)
            ? listRollbackLogPayload.entries as Array<Record<string, unknown>>
            : [];
        expect(rollbackEntries.some((entry) => entry.action === 'rollback' && entry.source === syncEntryId)).toBe(true);
    });

    test('returns null for commands it does not handle', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-unhandled-');
        const appDataRoot = createTempDir('coworkany-mastra-unhandled-appdata-');
        const { handler } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const result = await handler(createCommand('start_task', {
            taskId: randomUUID(),
            userQuery: 'hello',
        }));
        expect(result).toBeNull();
    });

    test('returns MCP connection status snapshot command', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-mcp-status-');
        const appDataRoot = createTempDir('coworkany-mastra-mcp-status-appdata-');
        const { handler } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const command = createCommand('get_mcp_connection_status', {});
        const response = await handler(command);
        const payload = (response?.payload ?? {}) as Record<string, unknown>;
        const snapshot = (payload.snapshot ?? {}) as Record<string, unknown>;

        expect(response?.type).toBe('get_mcp_connection_status_response');
        expect(response?.commandId).toBe(command.id);
        expect(payload.success).toBe(true);
        expect(typeof snapshot.enabled).toBe('boolean');
        expect(typeof snapshot.status).toBe('string');
    });

    test('supports MCP server scope governance commands', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-mcp-governance-');
        const appDataRoot = createTempDir('coworkany-mastra-mcp-governance-appdata-');
        const { handler } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const upsertResponse = await handler(createCommand('upsert_mcp_server', {
            server: {
                id: 'demo-user-server',
                command: 'npx',
                args: ['-y', 'demo-mcp'],
                scope: 'user',
                enabled: true,
            },
        }));
        const upsertPayload = (upsertResponse?.payload ?? {}) as Record<string, unknown>;
        expect(upsertResponse?.type).toBe('upsert_mcp_server_response');
        expect(upsertPayload.success).toBe(true);
        expect(Array.isArray(upsertPayload.blockedServerIds)).toBe(true);
        expect((upsertPayload.blockedServerIds as string[]).includes('demo-user-server')).toBe(true);

        const approvalResponse = await handler(createCommand('set_mcp_server_approval', {
            id: 'demo-user-server',
            approved: true,
        }));
        const approvalPayload = (approvalResponse?.payload ?? {}) as Record<string, unknown>;
        expect(approvalResponse?.type).toBe('set_mcp_server_approval_response');
        expect(approvalPayload.success).toBe(true);
        expect((approvalPayload.allowedServerIds as string[]).includes('demo-user-server')).toBe(true);

        const listResponse = await handler(createCommand('list_mcp_servers', {}));
        const listPayload = (listResponse?.payload ?? {}) as Record<string, unknown>;
        const servers = Array.isArray(listPayload.servers) ? listPayload.servers as Array<Record<string, unknown>> : [];
        expect(listResponse?.type).toBe('list_mcp_servers_response');
        expect(servers.some((server) => server.id === 'demo-user-server')).toBe(true);
    });

    test('auto installs local skill dependencies when importing', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-import-deps-');
        const appDataRoot = createTempDir('coworkany-mastra-import-deps-appdata-');
        const skillsRoot = createTempDir('coworkany-mastra-import-deps-skills-');
        const dependencyDir = path.join(skillsRoot, 'dep-skill');
        const mainDir = path.join(skillsRoot, 'main-skill');
        fs.mkdirSync(dependencyDir, { recursive: true });
        fs.mkdirSync(mainDir, { recursive: true });
        fs.writeFileSync(path.join(dependencyDir, 'SKILL.md'), `---
name: dep-skill
version: 1.0.0
description: dependency
---

# dep-skill
`);
        fs.writeFileSync(path.join(mainDir, 'SKILL.md'), `---
name: main-skill
version: 1.0.0
description: main
dependencies:
  - dep-skill
---

# main-skill
`);

        const { handler, skillStore } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const response = await handler(createCommand('import_claude_skill', {
            path: mainDir,
            autoInstallDependencies: true,
        }));
        const payload = (response?.payload ?? {}) as Record<string, unknown>;
        const installResults = Array.isArray(payload.installResults)
            ? payload.installResults as Array<Record<string, unknown>>
            : [];

        expect(response?.type).toBe('import_claude_skill_response');
        expect(payload.success).toBe(true);
        expect(payload.skillId).toBe('main-skill');
        expect(
            installResults.some((entry) =>
                entry.skillId === 'dep-skill' && entry.status === 'installed',
            ),
        ).toBe(true);
        expect(skillStore.get('dep-skill')?.enabled).toBe(true);
        expect(skillStore.get('main-skill')?.enabled).toBe(true);
    });

    test('auto installs transitive dependencies recursively', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-import-transitive-');
        const appDataRoot = createTempDir('coworkany-mastra-import-transitive-appdata-');
        const skillsRoot = createTempDir('coworkany-mastra-import-transitive-skills-');
        const depBDir = path.join(skillsRoot, 'dep-b');
        const depADir = path.join(skillsRoot, 'dep-a');
        const mainDir = path.join(skillsRoot, 'main-skill');
        fs.mkdirSync(depBDir, { recursive: true });
        fs.mkdirSync(depADir, { recursive: true });
        fs.mkdirSync(mainDir, { recursive: true });
        fs.writeFileSync(path.join(depBDir, 'SKILL.md'), `---
name: dep-b
version: 1.0.0
description: dependency b
---

# dep-b
`);
        fs.writeFileSync(path.join(depADir, 'SKILL.md'), `---
name: dep-a
version: 1.0.0
description: dependency a
dependencies:
  - dep-b
---

# dep-a
`);
        fs.writeFileSync(path.join(mainDir, 'SKILL.md'), `---
name: main-skill
version: 1.0.0
description: main
dependencies:
  - dep-a
---

# main-skill
`);

        const { handler, skillStore } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const response = await handler(createCommand('import_claude_skill', {
            path: mainDir,
            autoInstallDependencies: true,
        }));
        const payload = (response?.payload ?? {}) as Record<string, unknown>;
        const installResults = Array.isArray(payload.installResults)
            ? payload.installResults as Array<Record<string, unknown>>
            : [];

        expect(response?.type).toBe('import_claude_skill_response');
        expect(payload.success).toBe(true);
        expect(
            installResults.some((entry) =>
                entry.skillId === 'dep-a' && entry.status === 'installed',
            ),
        ).toBe(true);
        expect(
            installResults.some((entry) =>
                entry.skillId === 'dep-b' && entry.status === 'installed',
            ),
        ).toBe(true);
        expect(skillStore.get('dep-a')?.enabled).toBe(true);
        expect(skillStore.get('dep-b')?.enabled).toBe(true);
    });

    test('fails import when dependencies are missing and auto install is disabled', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-import-missing-deps-');
        const appDataRoot = createTempDir('coworkany-mastra-import-missing-deps-appdata-');
        const mainDir = createTempDir('coworkany-mastra-import-missing-main-');
        fs.writeFileSync(path.join(mainDir, 'SKILL.md'), `---
name: main-skill
version: 1.0.0
description: main
dependencies:
  - dep-skill
---

# main-skill
`);

        const { handler } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const response = await handler(createCommand('import_claude_skill', {
            path: mainDir,
            autoInstallDependencies: false,
        }));
        const payload = (response?.payload ?? {}) as Record<string, unknown>;

        expect(response?.type).toBe('import_claude_skill_response');
        expect(payload.success).toBe(false);
        expect(payload.error).toBe('skill_dependencies_missing');
    });

    test('fails import when dependency graph contains a cycle', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-import-cycle-');
        const appDataRoot = createTempDir('coworkany-mastra-import-cycle-appdata-');
        const skillsRoot = createTempDir('coworkany-mastra-import-cycle-skills-');
        const depADir = path.join(skillsRoot, 'dep-a');
        const depBDir = path.join(skillsRoot, 'dep-b');
        const mainDir = path.join(skillsRoot, 'main-skill');
        fs.mkdirSync(depADir, { recursive: true });
        fs.mkdirSync(depBDir, { recursive: true });
        fs.mkdirSync(mainDir, { recursive: true });
        fs.writeFileSync(path.join(depADir, 'SKILL.md'), `---
name: dep-a
version: 1.0.0
description: dependency a
dependencies:
  - dep-b
---

# dep-a
`);
        fs.writeFileSync(path.join(depBDir, 'SKILL.md'), `---
name: dep-b
version: 1.0.0
description: dependency b
dependencies:
  - dep-a
---

# dep-b
`);
        fs.writeFileSync(path.join(mainDir, 'SKILL.md'), `---
name: main-skill
version: 1.0.0
description: main
dependencies:
  - dep-a
---

# main-skill
`);

        const { handler } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const response = await handler(createCommand('import_claude_skill', {
            path: mainDir,
            autoInstallDependencies: true,
        }));
        const payload = (response?.payload ?? {}) as Record<string, unknown>;
        const dependencyCheck = (payload.dependencyCheck ?? {}) as Record<string, unknown>;

        expect(payload.success).toBe(false);
        expect(payload.error).toBe('skill_dependency_cycle');
        expect(Array.isArray(dependencyCheck.cycles)).toBe(true);
    });

    test('enforces dependency constraints when toggling skills', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-set-enabled-deps-');
        const appDataRoot = createTempDir('coworkany-mastra-set-enabled-deps-appdata-');
        const skillsRoot = createTempDir('coworkany-mastra-set-enabled-skills-');
        const dependencyDir = path.join(skillsRoot, 'dep-skill');
        const mainDir = path.join(skillsRoot, 'main-skill');
        fs.mkdirSync(dependencyDir, { recursive: true });
        fs.mkdirSync(mainDir, { recursive: true });
        fs.writeFileSync(path.join(dependencyDir, 'SKILL.md'), `---
name: dep-skill
version: 1.0.0
description: dependency
---

# dep-skill
`);
        fs.writeFileSync(path.join(mainDir, 'SKILL.md'), `---
name: main-skill
version: 1.0.0
description: main
dependencies:
  - dep-skill
---

# main-skill
`);

        const { handler } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const imported = await handler(createCommand('import_claude_skill', {
            path: mainDir,
            autoInstallDependencies: true,
        }));
        expect((imported?.payload as Record<string, unknown>)?.success).toBe(true);

        const disableDependencyBlocked = await handler(createCommand('set_claude_skill_enabled', {
            skillId: 'dep-skill',
            enabled: false,
        }));
        const disableDependencyBlockedPayload = (disableDependencyBlocked?.payload ?? {}) as Record<string, unknown>;
        expect(disableDependencyBlockedPayload.success).toBe(false);
        expect(disableDependencyBlockedPayload.error).toBe('skill_required_by_dependents');

        const disableMain = await handler(createCommand('set_claude_skill_enabled', {
            skillId: 'main-skill',
            enabled: false,
        }));
        expect((disableMain?.payload as Record<string, unknown>)?.success).toBe(true);

        const disableDependency = await handler(createCommand('set_claude_skill_enabled', {
            skillId: 'dep-skill',
            enabled: false,
        }));
        expect((disableDependency?.payload as Record<string, unknown>)?.success).toBe(true);

        const reEnableMain = await handler(createCommand('set_claude_skill_enabled', {
            skillId: 'main-skill',
            enabled: true,
        }));
        const reEnableMainPayload = (reEnableMain?.payload ?? {}) as Record<string, unknown>;
        expect(reEnableMainPayload.success).toBe(false);
        expect(reEnableMainPayload.error).toBe('skill_dependencies_missing');
    });

    test('blocks skill import when policy marks skill as blocked', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-import-policy-');
        const appDataRoot = createTempDir('coworkany-mastra-import-policy-appdata-');
        const blockedDir = createTempDir('coworkany-mastra-import-policy-skill-');
        fs.mkdirSync(path.join(workspaceRoot, '.coworkany'), { recursive: true });
        fs.writeFileSync(
            path.join(workspaceRoot, '.coworkany', 'policy-settings.json'),
            JSON.stringify({
                blockedSkillIds: ['blocked-skill'],
            }),
            'utf-8',
        );
        fs.writeFileSync(path.join(blockedDir, 'SKILL.md'), `---
name: blocked-skill
version: 1.0.0
description: blocked
---

# blocked-skill
`);

        const { handler } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const response = await handler(createCommand('import_claude_skill', {
            path: blockedDir,
        }));
        const payload = (response?.payload ?? {}) as Record<string, unknown>;

        expect(response?.type).toBe('import_claude_skill_response');
        expect(payload.success).toBe(false);
        expect(payload.error).toBe('skill_blocked_by_policy');
    });

    test('reloads policy snapshot between commands after on-disk policy change', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-policy-reload-');
        const appDataRoot = createTempDir('coworkany-mastra-policy-reload-appdata-');
        const skillDir = createTempDir('coworkany-mastra-policy-reload-skill-');
        fs.mkdirSync(path.join(workspaceRoot, '.coworkany'), { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: dynamic-skill
version: 1.0.0
description: dynamic policy check
---

# dynamic-skill
`);

        const { handler } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const imported = await handler(createCommand('import_claude_skill', {
            path: skillDir,
        }));
        expect((imported?.payload as Record<string, unknown>)?.success).toBe(true);

        const disabled = await handler(createCommand('set_claude_skill_enabled', {
            skillId: 'dynamic-skill',
            enabled: false,
        }));
        expect((disabled?.payload as Record<string, unknown>)?.success).toBe(true);

        fs.writeFileSync(
            path.join(workspaceRoot, '.coworkany', 'policy-settings.json'),
            JSON.stringify({
                blockedSkillIds: ['dynamic-skill'],
            }),
            'utf-8',
        );

        const reEnable = await handler(createCommand('set_claude_skill_enabled', {
            skillId: 'dynamic-skill',
            enabled: true,
        }));
        const payload = (reEnable?.payload ?? {}) as Record<string, unknown>;
        expect(payload.success).toBe(false);
        expect(payload.error).toBe('skill_blocked_by_policy');
    });

    test('blocks enabling a skill when existing registry has dependency cycle', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-enable-cycle-');
        const appDataRoot = createTempDir('coworkany-mastra-enable-cycle-appdata-');
        const skillDirA = createTempDir('coworkany-mastra-enable-cycle-a-');
        const skillDirB = createTempDir('coworkany-mastra-enable-cycle-b-');
        fs.writeFileSync(path.join(skillDirA, 'SKILL.md'), `---
name: cycle-a
version: 1.0.0
description: cycle a
dependencies:
  - cycle-b
---

# cycle-a
`);
        fs.writeFileSync(path.join(skillDirB, 'SKILL.md'), `---
name: cycle-b
version: 1.0.0
description: cycle b
dependencies:
  - cycle-a
---

# cycle-b
`);

        const { handler, skillStore } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });
        const manifestA = SkillStore.loadFromDirectory(skillDirA);
        const manifestB = SkillStore.loadFromDirectory(skillDirB);
        if (!manifestA || !manifestB) {
            throw new Error('failed to load cyclic skill fixtures');
        }
        skillStore.install(manifestA);
        skillStore.install(manifestB);

        const response = await handler(createCommand('set_claude_skill_enabled', {
            skillId: 'cycle-a',
            enabled: true,
        }));
        const payload = (response?.payload ?? {}) as Record<string, unknown>;
        const dependencyCheck = (payload.dependencyCheck ?? {}) as Record<string, unknown>;

        expect(payload.success).toBe(false);
        expect(payload.error).toBe('skill_dependency_cycle');
        expect(Array.isArray(dependencyCheck.cycles)).toBe(true);
    });
});
