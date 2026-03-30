import * as fs from 'fs';
import * as path from 'path';
import { handleCapabilityCommand } from '../handlers/capabilities';
import type { SkillImportResponsePayload } from '../handlers/capabilities';
import { handleWorkspaceCommand } from '../handlers/workspaces';
import type { IpcCommand } from '../protocol';
import { SkillStore, ToolpackStore, createWorkspaceStoreFacade } from '../storage';
import { DirectiveManager } from '../directives/directiveManager';
export type AdditionalCommandHandler = (raw: unknown) => Promise<Record<string, unknown> | null>;
type AdditionalCommandRuntime = {
    workspaceRoot: string;
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
    _autoInstallDependencies: boolean,
    _approvePermissionExpansion: boolean,
    runtime: AdditionalCommandRuntime,
): Promise<SkillImportResponsePayload> {
    const manifest = SkillStore.loadFromDirectory(inputPath);
    if (!manifest) {
        return {
            success: false,
            error: 'missing_skill_manifest',
        };
    }
    runtime.skillStore.install(manifest);
    return {
        success: true,
        skillId: manifest.name,
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
        skillStore: new SkillStore(workspaceRoot),
    };
    const toolpackStore = new ToolpackStore(workspaceRoot);
    const workspaceStore = createWorkspaceStoreFacade(() => getResolvedAppDataRoot(appDataRoot));
    const directiveManager = new DirectiveManager(workspaceRoot);
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
                );
            },
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
