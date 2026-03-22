import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleCapabilityCommand, type CapabilityCommandDeps } from '../src/handlers/capabilities';

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

function createDeps(overrides: Partial<CapabilityCommandDeps> = {}): CapabilityCommandDeps {
    const governanceState = new Map<string, any>();
    const governanceStore = {
        get: (extensionType: 'skill' | 'toolpack', extensionId: string) => governanceState.get(`${extensionType}:${extensionId}`),
        recordReview: (review: any, input?: { decision?: 'pending' | 'approved'; quarantined?: boolean }) => {
            const pending = input?.decision === 'pending';
            const entry = {
                extensionType: review.extensionType,
                extensionId: review.extensionId,
                pendingReview: pending,
                quarantined: input?.quarantined === true,
                lastDecision: pending ? 'pending' : 'approved',
                lastReviewReason: review.reason,
                lastReviewSummary: review.summary,
                lastUpdatedAt: new Date().toISOString(),
                approvedAt: pending ? undefined : new Date().toISOString(),
            };
            governanceState.set(`${review.extensionType}:${review.extensionId}`, entry);
            return entry;
        },
        markApproved: (extensionType: 'skill' | 'toolpack', extensionId: string) => {
            const key = `${extensionType}:${extensionId}`;
            const existing = governanceState.get(key);
            if (!existing) return undefined;
            const approved = {
                ...existing,
                pendingReview: false,
                quarantined: false,
                lastDecision: 'approved',
                approvedAt: new Date().toISOString(),
                lastUpdatedAt: new Date().toISOString(),
            };
            governanceState.set(key, approved);
            return approved;
        },
        clear: (extensionType: 'skill' | 'toolpack', extensionId: string) => governanceState.delete(`${extensionType}:${extensionId}`),
    };

    return {
        skillStore: {
            list: () => [],
            get: () => undefined,
            install: () => {},
            setEnabled: () => true,
            uninstall: () => true,
        },
        toolpackStore: {
            list: () => [],
            getById: () => undefined,
            add: () => {},
            setEnabledById: () => true,
            removeById: () => true,
        },
        getExtensionGovernanceStore: () => governanceStore,
        getDirectiveManager: () => ({
            listDirectives: () => [],
            upsertDirective: (directive) => directive,
            removeDirective: () => true,
        }),
        importSkillFromDirectory: async () => ({ success: true, skillId: 'demo-skill' }),
        downloadSkillFromGitHub: async () => ({ success: true, path: '/tmp/skill', filesDownloaded: 1 }),
        downloadMcpFromGitHub: async () => ({ success: true, path: '/tmp/mcp', filesDownloaded: 1 }),
        validateSkillUrl: async () => ({ valid: true, sourceType: 'skill' }),
        validateMcpUrl: async () => ({ valid: true, sourceType: 'mcp' }),
        scanDefaultRepositories: async () => ({ skills: [], mcpServers: [], errors: [] }),
        ...overrides,
    };
}

describe('capability commands handler', () => {
    test('install_toolpack returns a first-install governance review summary', async () => {
        const installDir = makeTempDir('capability-toolpack-install-');
        fs.writeFileSync(path.join(installDir, 'toolpack.json'), JSON.stringify({
            id: 'local-pack',
            name: 'Local Pack',
            version: '1.0.0',
            runtime: 'node',
            tools: ['read_file'],
            effects: ['filesystem:read'],
        }));

        const setEnabledCalls: Array<{ toolpackId: string; enabled: boolean }> = [];
        const response = await handleCapabilityCommand({
            id: 'cmd-toolpack-first-install',
            type: 'install_toolpack',
            payload: {
                source: 'local_folder',
                path: installDir,
                allowUnsigned: true,
            },
        } as any, createDeps({
            toolpackStore: {
                list: () => [],
                getById: () => undefined,
                add: () => {},
                setEnabledById: (toolpackId, enabled) => {
                    setEnabledCalls.push({ toolpackId, enabled });
                    return true;
                },
                removeById: () => true,
            },
        }));

        expect(response?.type).toBe('install_toolpack_response');
        expect((response as any).payload.success).toBe(true);
        expect((response as any).payload.governanceReview).toMatchObject({
            extensionType: 'toolpack',
            extensionId: 'local-pack',
            installKind: 'first_install',
            reviewRequired: true,
            blocking: false,
            reason: 'first_install_review',
        });
        expect((response as any).payload.governanceState).toMatchObject({
            extensionType: 'toolpack',
            extensionId: 'local-pack',
            pendingReview: true,
            quarantined: true,
            lastDecision: 'pending',
        });
        expect(setEnabledCalls).toEqual([{ toolpackId: 'local-pack', enabled: false }]);
    });

    test('install_toolpack blocks permission-expansion updates until explicitly approved', async () => {
        const installDir = makeTempDir('capability-toolpack-update-');
        fs.writeFileSync(path.join(installDir, 'toolpack.json'), JSON.stringify({
            id: 'demo-pack',
            name: 'Demo Pack',
            version: '2.0.0',
            runtime: 'node',
            tools: ['read_file'],
            effects: ['filesystem:read', 'network:outbound'],
        }));

        let addCalls = 0;
        const deps = createDeps({
            toolpackStore: {
                list: () => [],
                getById: () => ({
                    manifest: {
                        id: 'demo-pack',
                        name: 'Demo Pack',
                        version: '1.0.0',
                        tools: ['read_file'],
                        effects: ['filesystem:read'],
                    },
                } as any),
                add: () => {
                    addCalls += 1;
                },
                setEnabledById: () => true,
                removeById: () => true,
            },
        });

        const blocked = await handleCapabilityCommand({
            id: 'cmd-toolpack-update-blocked',
            type: 'install_toolpack',
            payload: {
                source: 'local_folder',
                path: installDir,
                allowUnsigned: true,
            },
        } as any, deps);

        expect((blocked as any).payload.success).toBe(false);
        expect((blocked as any).payload.error).toBe('toolpack_permission_expansion_requires_review');
        expect((blocked as any).payload.governanceReview).toMatchObject({
            extensionType: 'toolpack',
            extensionId: 'demo-pack',
            installKind: 'update',
            reviewRequired: true,
            blocking: true,
            reason: 'permission_expansion',
        });
        expect((blocked as any).payload.governanceState).toMatchObject({
            extensionType: 'toolpack',
            extensionId: 'demo-pack',
            pendingReview: true,
            quarantined: false,
            lastDecision: 'pending',
        });
        expect(addCalls).toBe(0);

        const approved = await handleCapabilityCommand({
            id: 'cmd-toolpack-update-approved',
            type: 'install_toolpack',
            payload: {
                source: 'local_folder',
                path: installDir,
                allowUnsigned: true,
                approvePermissionExpansion: true,
            },
        } as any, deps);

        expect((approved as any).payload.success).toBe(true);
        expect((approved as any).payload.governanceReview).toMatchObject({
            extensionType: 'toolpack',
            extensionId: 'demo-pack',
            installKind: 'update',
            reviewRequired: true,
            blocking: false,
            reason: 'permission_expansion',
        });
        expect((approved as any).payload.governanceState).toMatchObject({
            extensionType: 'toolpack',
            extensionId: 'demo-pack',
            pendingReview: false,
            quarantined: false,
            lastDecision: 'approved',
        });
        expect(addCalls).toBe(1);
    });

    test('forwards import_claude_skill to injected importer with auto-install enabled by default', async () => {
        const calls: Array<{ inputPath: string; autoInstallDependencies?: boolean }> = [];
        const deps = createDeps({
            importSkillFromDirectory: async (inputPath, autoInstallDependencies) => {
                calls.push({ inputPath, autoInstallDependencies });
                return { success: true, skillId: 'custom-skill' };
            },
        });

        const response = await handleCapabilityCommand({
            id: 'cmd-1',
            type: 'import_claude_skill',
            payload: {
                source: 'local_folder',
                path: '/tmp/custom-skill',
            },
        } as any, deps);

        expect(calls).toEqual([
            { inputPath: '/tmp/custom-skill', autoInstallDependencies: true },
        ]);
        expect(response?.type).toBe('import_claude_skill_response');
        expect((response as any).payload).toEqual({ success: true, skillId: 'custom-skill' });
    });

    test('install_from_github for skill merges download and import failures into response payload', async () => {
        const deps = createDeps({
            downloadSkillFromGitHub: async () => ({
                success: true,
                path: '/tmp/skill-from-github',
                filesDownloaded: 4,
            }),
            importSkillFromDirectory: async () => ({
                success: false,
                error: 'missing_skill_manifest',
            }),
        });

        const response = await handleCapabilityCommand({
            id: 'cmd-2',
            type: 'install_from_github',
            payload: {
                workspacePath: '/tmp/workspace',
                source: 'owner/repo',
                targetType: 'skill',
            },
        } as any, deps);

        expect(response?.type).toBe('install_from_github_response');
        expect((response as any).payload).toEqual({
            success: false,
            path: '/tmp/skill-from-github',
            filesDownloaded: 4,
            importResult: {
                success: false,
                error: 'missing_skill_manifest',
            },
            error: 'missing_skill_manifest',
        });
    });

    test('install_from_github for mcp registers downloaded manifest into toolpack store', async () => {
        const installedDir = makeTempDir('capability-mcp-');
        fs.writeFileSync(path.join(installedDir, 'manifest.json'), JSON.stringify({
            id: 'demo-mcp',
            name: 'Demo MCP',
            version: '1.0.0',
            runtime: 'node',
            tools: ['demo_tool'],
        }));

        const added: Array<{ manifest: any; workingDir: string }> = [];
        const deps = createDeps({
            downloadMcpFromGitHub: async () => ({
                success: true,
                path: installedDir,
                filesDownloaded: 2,
            }),
            toolpackStore: {
                list: () => [],
                getById: () => undefined,
                add: (manifest, workingDir) => {
                    added.push({ manifest, workingDir });
                },
                setEnabledById: () => true,
                removeById: () => true,
            },
        });

        const response = await handleCapabilityCommand({
            id: 'cmd-3',
            type: 'install_from_github',
            payload: {
                workspacePath: '/tmp/workspace',
                source: 'owner/mcp-repo',
                targetType: 'mcp',
            },
        } as any, deps);

        expect(response?.type).toBe('install_from_github_response');
        expect((response as any).payload.success).toBe(true);
        expect(added).toHaveLength(1);
        expect(added[0]?.workingDir).toBe(installedDir);
        expect(added[0]?.manifest.name).toBe('Demo MCP');
    });

    test('remove_claude_skill deletes installed files unless deleteFiles is false', async () => {
        const skillDir = makeTempDir('capability-skill-');
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# test');

        const deps = createDeps({
            skillStore: {
                list: () => [],
                get: () => ({
                    manifest: {
                        directory: skillDir,
                    },
                } as any),
                install: () => {},
                setEnabled: () => true,
                uninstall: () => true,
            },
        });

        const response = await handleCapabilityCommand({
            id: 'cmd-4',
            type: 'remove_claude_skill',
            payload: {
                skillId: 'demo-skill',
            },
        } as any, deps);

        expect(response?.type).toBe('remove_claude_skill_response');
        expect((response as any).payload.success).toBe(true);
        expect(fs.existsSync(skillDir)).toBe(false);
    });

    test('directive commands round-trip through directive manager', async () => {
        const directives = new Map<string, any>();
        const deps = createDeps({
            getDirectiveManager: () => ({
                listDirectives: () => Array.from(directives.values()),
                upsertDirective: (directive) => {
                    directives.set(directive.id, directive);
                    return directive;
                },
                removeDirective: (directiveId) => directives.delete(directiveId),
            }),
        });

        const upsertResponse = await handleCapabilityCommand({
            id: 'cmd-5',
            type: 'upsert_directive',
            payload: {
                directive: {
                    id: 'strict',
                    name: 'Strict',
                    content: 'Be precise',
                    enabled: true,
                    priority: 2,
                },
            },
        } as any, deps);

        const listResponse = await handleCapabilityCommand({
            id: 'cmd-6',
            type: 'list_directives',
            payload: {},
        } as any, deps);

        const removeResponse = await handleCapabilityCommand({
            id: 'cmd-7',
            type: 'remove_directive',
            payload: {
                directiveId: 'strict',
            },
        } as any, deps);

        expect(upsertResponse?.type).toBe('upsert_directive_response');
        expect((listResponse as any).payload.directives).toHaveLength(1);
        expect(removeResponse?.type).toBe('remove_directive_response');
        expect((removeResponse as any).payload.success).toBe(true);
    });

    test('validate_github_url dispatches to the correct validator by target type', async () => {
        const calls: string[] = [];
        const deps = createDeps({
            validateSkillUrl: async (url) => {
                calls.push(`skill:${url}`);
                return { valid: true, sourceType: 'skill' };
            },
            validateMcpUrl: async (url) => {
                calls.push(`mcp:${url}`);
                return { valid: true, sourceType: 'mcp' };
            },
        });

        const skillResponse = await handleCapabilityCommand({
            id: 'cmd-8',
            type: 'validate_github_url',
            payload: {
                url: 'https://github.com/example/skill',
                type: 'skill',
            },
        } as any, deps);

        const mcpResponse = await handleCapabilityCommand({
            id: 'cmd-9',
            type: 'validate_github_url',
            payload: {
                url: 'https://github.com/example/mcp',
                type: 'mcp',
            },
        } as any, deps);

        expect(calls).toEqual([
            'skill:https://github.com/example/skill',
            'mcp:https://github.com/example/mcp',
        ]);
        expect(skillResponse?.type).toBe('validate_github_url_response');
        expect((skillResponse as any).payload.sourceType).toBe('skill');
        expect((mcpResponse as any).payload.sourceType).toBe('mcp');
    });

    test('list_claude_skills exposes provenance trust and permission summaries', async () => {
        const deps = createDeps({
            skillStore: {
                list: () => [{
                    manifest: {
                        name: 'Third Party Skill',
                        version: '1.2.3',
                        description: 'demo',
                        directory: '/tmp/skills/third-party',
                        allowedTools: ['Read', 'Write'],
                        author: 'Acme',
                        homepage: 'https://example.com/skill',
                        requires: {
                            tools: [],
                            capabilities: ['filesystem:write'],
                            bins: ['python3'],
                            env: ['OPENAI_API_KEY'],
                            config: [],
                        },
                    },
                    enabled: true,
                    installedAt: new Date().toISOString(),
                    isBuiltin: false,
                } as any],
                get: () => undefined,
                install: () => {},
                setEnabled: () => true,
                uninstall: () => true,
            },
        });

        const response = await handleCapabilityCommand({
            id: 'cmd-list-skills-governance',
            type: 'list_claude_skills',
            payload: {},
        } as any, deps);

        const first = (response as any)?.payload?.skills?.[0];
        expect(first?.provenance?.sourceType).toBe('local_folder');
        expect(first?.provenance?.publisher).toBe('Acme');
        expect(first?.trust?.level).toBe('review_required');
        expect(first?.trust?.pendingReview).toBe(true);
        expect(first?.permissions?.tools).toContain('Read');
        expect(first?.permissions?.capabilities).toContain('filesystem:write');
        expect(first?.permissions?.bins).toContain('python3');
    });

    test('set_claude_skill_enabled blocks non-allowlisted skills when workspace allowlist enforcement is enabled', async () => {
        const response = await handleCapabilityCommand({
            id: 'cmd-skill-allowlist-block',
            type: 'set_claude_skill_enabled',
            payload: {
                skillId: 'blocked-skill',
                enabled: true,
            },
        } as any, createDeps({
            skillStore: {
                list: () => [],
                get: () => ({
                    manifest: {
                        name: 'blocked-skill',
                    },
                    isBuiltin: false,
                } as any),
                install: () => {},
                setEnabled: () => true,
                uninstall: () => true,
            },
            getWorkspaceExtensionAllowlistPolicy: () => ({
                mode: 'enforce',
                allowedSkills: ['approved-skill'],
                allowedToolpacks: [],
            }),
        }));

        expect(response?.type).toBe('set_claude_skill_enabled_response');
        expect((response as any).payload).toMatchObject({
            success: false,
            skillId: 'blocked-skill',
            error: 'workspace_extension_not_allowlisted',
        });
    });

    test('set_toolpack_enabled blocks non-allowlisted toolpacks when workspace allowlist enforcement is enabled', async () => {
        const response = await handleCapabilityCommand({
            id: 'cmd-toolpack-allowlist-block',
            type: 'set_toolpack_enabled',
            payload: {
                toolpackId: 'blocked-toolpack',
                enabled: true,
            },
        } as any, createDeps({
            toolpackStore: {
                list: () => [],
                getById: () => ({
                    manifest: {
                        id: 'blocked-toolpack',
                    },
                    isBuiltin: false,
                } as any),
                add: () => {},
                setEnabledById: () => true,
                removeById: () => true,
            },
            getWorkspaceExtensionAllowlistPolicy: () => ({
                mode: 'enforce',
                allowedSkills: [],
                allowedToolpacks: ['approved-toolpack'],
            }),
        }));

        expect(response?.type).toBe('set_toolpack_enabled_response');
        expect((response as any).payload).toMatchObject({
            success: false,
            toolpackId: 'blocked-toolpack',
            error: 'workspace_extension_not_allowlisted',
        });
    });

    test('approve_extension_governance explicitly approves pending toolpack review and re-enables the extension', async () => {
        const installDir = makeTempDir('capability-toolpack-approve-');
        fs.writeFileSync(path.join(installDir, 'toolpack.json'), JSON.stringify({
            id: 'governed-pack',
            name: 'Governed Pack',
            version: '1.0.0',
            runtime: 'node',
            tools: ['read_file'],
            effects: ['filesystem:read'],
        }));

        const setEnabledCalls: Array<{ toolpackId: string; enabled: boolean }> = [];
        let installed = false;
        const deps = createDeps({
            toolpackStore: {
                list: () => [],
                getById: () => installed
                    ? ({
                        manifest: {
                            id: 'governed-pack',
                            name: 'Governed Pack',
                            version: '1.0.0',
                            tools: ['read_file'],
                            effects: ['filesystem:read'],
                        },
                    } as any)
                    : undefined,
                add: () => {
                    installed = true;
                },
                setEnabledById: (toolpackId, enabled) => {
                    setEnabledCalls.push({ toolpackId, enabled });
                    return true;
                },
                removeById: () => true,
            },
        });

        const installResponse = await handleCapabilityCommand({
            id: 'cmd-governance-install',
            type: 'install_toolpack',
            payload: {
                source: 'local_folder',
                path: installDir,
                allowUnsigned: true,
            },
        } as any, deps);

        expect((installResponse as any)?.payload?.governanceState?.pendingReview).toBe(true);
        expect((installResponse as any)?.payload?.governanceState?.quarantined).toBe(true);

        const approveResponse = await handleCapabilityCommand({
            id: 'cmd-governance-approve',
            type: 'approve_extension_governance',
            payload: {
                extensionType: 'toolpack',
                extensionId: 'governed-pack',
            },
        } as any, deps);

        expect(approveResponse?.type).toBe('approve_extension_governance_response');
        expect((approveResponse as any).payload.success).toBe(true);
        expect((approveResponse as any).payload.governanceState).toMatchObject({
            extensionType: 'toolpack',
            extensionId: 'governed-pack',
            pendingReview: false,
            quarantined: false,
            lastDecision: 'approved',
        });
        expect(setEnabledCalls).toEqual([
            { toolpackId: 'governed-pack', enabled: false },
            { toolpackId: 'governed-pack', enabled: true },
        ]);
    });
});
