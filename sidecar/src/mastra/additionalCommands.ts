import * as fs from 'fs';
import * as path from 'path';
import { handleCapabilityCommand, handleWorkspaceCommand } from '../handlers';
import type { SkillImportResponsePayload } from '../handlers';
import type { IpcCommand } from '../protocol';
import { SkillStore, ToolpackStore, createWorkspaceStoreFacade } from '../storage';
import { DirectiveManager } from '../directives/directiveManager';
import { ExtensionGovernanceStore } from '../extensions/governanceStore';
import { buildExtensionGovernanceReview, summarizeSkillPermissions } from '../extensions/governance';
import { loadWorkspaceExtensionAllowlistPolicy } from '../extensions/workspaceExtensionAllowlist';
import { autoInstallSkillDependencies, inspectSkillDependencies } from '../claude_skills/dependencyInstaller';
import {
    downloadMcpFromGitHub,
    downloadSkillFromGitHub,
    scanDefaultRepositories,
    validateMcpUrl,
    validateSkillUrl,
} from '../utils';

export type AdditionalCommandHandler = (raw: unknown) => Promise<Record<string, unknown> | null>;

type AdditionalCommandRuntime = {
    workspaceRoot: string;
    appDataRoot: string;
    skillStore: SkillStore;
};

function getResolvedAppDataRoot(root: string): string {
    fs.mkdirSync(root, { recursive: true });
    return root;
}

function registerFilesystemSkills(skillStore: SkillStore, workspaceRoot: string): void {
    const skillsDir = path.join(workspaceRoot, '.coworkany', 'skills');
    if (!fs.existsSync(skillsDir)) {
        return;
    }
    const manifests = SkillStore.scanDirectory(skillsDir);
    let changed = false;
    for (const manifest of manifests) {
        if (!skillStore.get(manifest.name)) {
            skillStore.install(manifest);
            changed = true;
        }
    }
    if (changed) {
        skillStore.save();
    }
}

async function importSkillFromDirectory(
    inputPath: string,
    autoInstallDependencies: boolean,
    approvePermissionExpansion: boolean,
    runtime: AdditionalCommandRuntime,
    extensionGovernanceStore: ExtensionGovernanceStore,
): Promise<SkillImportResponsePayload> {
    const manifest = SkillStore.loadFromDirectory(inputPath);
    if (!manifest) {
        return {
            success: false,
            error: 'missing_skill_manifest',
        };
    }

    const existingSkill = runtime.skillStore.get(manifest.name);
    const governanceReview = buildExtensionGovernanceReview({
        extensionType: 'skill',
        extensionId: manifest.name,
        previous: existingSkill ? summarizeSkillPermissions(existingSkill.manifest) : undefined,
        next: summarizeSkillPermissions(manifest),
        blockOnPermissionExpansion: !approvePermissionExpansion,
    });

    if (governanceReview.blocking) {
        const governanceState = extensionGovernanceStore.recordReview(governanceReview, {
            decision: 'pending',
            quarantined: false,
        });
        return {
            success: false,
            error: 'skill_permission_expansion_requires_review',
            governanceReview,
            governanceState,
        };
    }

    const dependencyCheck = inspectSkillDependencies(manifest);
    const installOutcome = autoInstallDependencies
        ? await autoInstallSkillDependencies(manifest, {
            appDataDir: runtime.appDataRoot,
        })
        : {
            before: dependencyCheck,
            after: dependencyCheck,
            attempts: [],
        };
    const warnings: string[] = [];
    if (!installOutcome.after.satisfied) {
        warnings.push(`Missing skill dependencies: ${installOutcome.after.missing.join(', ')}`);
    }

    runtime.skillStore.install(manifest);
    const governanceState = extensionGovernanceStore.recordReview(governanceReview, {
        decision: governanceReview.reason === 'first_install_review' ? 'pending' : 'approved',
        quarantined: false,
    });
    const allowlistPolicy = loadWorkspaceExtensionAllowlistPolicy(runtime.workspaceRoot);
    if (allowlistPolicy.mode === 'enforce' && !allowlistPolicy.allowedSkills.includes(manifest.name)) {
        runtime.skillStore.setEnabled(manifest.name, false);
        warnings.push(`Workspace extension allowlist denied automatic enable for skill "${manifest.name}".`);
    }

    return {
        success: true,
        skillId: manifest.name,
        warnings: warnings.length > 0 ? warnings : undefined,
        dependencyCheck: installOutcome.after,
        installResults: installOutcome.attempts.length > 0 ? installOutcome.attempts : undefined,
        governanceReview,
        governanceState,
    };
}

export function createMastraAdditionalCommandHandler(input?: {
    workspaceRoot?: string;
    appDataRoot?: string;
}): {
    handler: AdditionalCommandHandler;
    skillStore: SkillStore;
} {
    const workspaceRoot = input?.workspaceRoot ?? process.cwd();
    const appDataRoot = input?.appDataRoot
        ?? process.env.COWORKANY_APP_DATA_DIR?.trim()
        ?? path.join(workspaceRoot, '.coworkany');

    const runtime: AdditionalCommandRuntime = {
        workspaceRoot,
        appDataRoot,
        skillStore: new SkillStore(workspaceRoot),
    };
    const toolpackStore = new ToolpackStore(workspaceRoot);
    const workspaceStore = createWorkspaceStoreFacade(() => getResolvedAppDataRoot(appDataRoot));
    const directiveManager = new DirectiveManager(workspaceRoot);
    const extensionGovernanceStore = new ExtensionGovernanceStore(
        path.join(getResolvedAppDataRoot(appDataRoot), 'extension-governance.json'),
    );

    registerFilesystemSkills(runtime.skillStore, runtime.workspaceRoot);

    const handler: AdditionalCommandHandler = async (raw: unknown) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return null;
        }
        const command = raw as IpcCommand;
        if (typeof command.type !== 'string' || typeof command.id !== 'string') {
            return null;
        }

        const workspaceResponse = await handleWorkspaceCommand(command, {
            workspaceStore,
            getResolvedAppDataRoot: () => getResolvedAppDataRoot(appDataRoot),
        });
        if (workspaceResponse) {
            return workspaceResponse as Record<string, unknown>;
        }

        const capabilityResponse = await handleCapabilityCommand(command, {
            skillStore: runtime.skillStore,
            toolpackStore,
            getExtensionGovernanceStore: () => extensionGovernanceStore,
            getWorkspaceExtensionAllowlistPolicy: () => loadWorkspaceExtensionAllowlistPolicy(runtime.workspaceRoot),
            getDirectiveManager: () => directiveManager,
            importSkillFromDirectory: async (
                inputPath: string,
                autoInstallDependencies = true,
                approvePermissionExpansion = false,
            ) => {
                return await importSkillFromDirectory(
                    inputPath,
                    autoInstallDependencies,
                    approvePermissionExpansion,
                    runtime,
                    extensionGovernanceStore,
                );
            },
            downloadSkillFromGitHub,
            downloadMcpFromGitHub,
            validateSkillUrl,
            validateMcpUrl,
            scanDefaultRepositories,
        });
        if (capabilityResponse) {
            return capabilityResponse as Record<string, unknown>;
        }

        return null;
    };

    return {
        handler,
        skillStore: runtime.skillStore,
    };
}
