import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { OpenClawCompatLayer, type DependencyInstallPlan } from './openclawCompat';
import { type SkillManifest } from './types';
import { type ClaudeSkillManifest } from '../storage/skillStore';

export type SkillDependencyStatus = {
    platformEligible: boolean;
    satisfied: boolean;
    missing: string[];
    canAutoInstall: boolean;
    installPlans: DependencyInstallPlan[];
    installCommands: string[];
};

export type SkillDependencyInstallAttempt = {
    kind: 'command' | 'download';
    label: string;
    success: boolean;
    skipped?: boolean;
    error?: string;
    output?: string;
    binary?: string;
    command?: string;
    url?: string;
    targetPath?: string;
};

export type SkillDependencyInstallResult = {
    before: SkillDependencyStatus;
    after: SkillDependencyStatus;
    attempts: SkillDependencyInstallAttempt[];
};

const SAFE_INSTALL_COMMAND_PREFIXES: string[][] = [
    ['brew', 'install'],
    ['npm', 'install', '-g'],
    ['uv', 'pip', 'install'],
    ['pip', 'install'],
    ['go', 'install'],
    ['winget', 'install'],
    ['choco', 'install', '-y'],
];

type AutoInstallOptions = {
    appDataDir?: string;
};

export function inspectSkillDependencies(manifest: ClaudeSkillManifest): SkillDependencyStatus {
    const compat = OpenClawCompatLayer.getInstance();
    const runtimeManifest = toRuntimeSkillManifest(manifest);
    const check = compat.checkDependencies(runtimeManifest);

    return {
        platformEligible: compat.checkPlatformEligibility(runtimeManifest),
        satisfied: check.satisfied,
        missing: check.missing,
        canAutoInstall: check.canAutoInstall,
        installPlans: check.installPlans ?? [],
        installCommands: check.installCommands ?? [],
    };
}

export async function autoInstallSkillDependencies(
    manifest: ClaudeSkillManifest,
    options: AutoInstallOptions = {}
): Promise<SkillDependencyInstallResult> {
    const before = inspectSkillDependencies(manifest);
    const attempts: SkillDependencyInstallAttempt[] = [];

    if (before.platformEligible && before.canAutoInstall) {
        for (const plan of before.installPlans) {
            attempts.push(await runInstallPlan(plan, options));
        }
    }

    return {
        before,
        after: inspectSkillDependencies(manifest),
        attempts,
    };
}

async function runInstallPlan(
    plan: DependencyInstallPlan,
    options: AutoInstallOptions
): Promise<SkillDependencyInstallAttempt> {
    return plan.kind === 'command'
        ? runSafeInstallCommand(plan)
        : await runDownloadInstall(plan, options);
}

function toRuntimeSkillManifest(manifest: ClaudeSkillManifest): SkillManifest {
    return {
        id: manifest.name,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        homepage: manifest.homepage,
        allowedTools: manifest.allowedTools ?? [],
        tags: manifest.tags ?? [],
        requires: manifest.requires,
        triggers: manifest.triggers ?? [],
        userInvocable: manifest.userInvocable ?? true,
        disableModelInvocation: manifest.disableModelInvocation ?? false,
        metadata: manifest.metadata,
    };
}

function runSafeInstallCommand(plan: Extract<DependencyInstallPlan, { kind: 'command' }>): SkillDependencyInstallAttempt {
    const command = plan.command;
    const tokens = command.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
        return {
            kind: 'command',
            label: plan.label,
            success: false,
            binary: plan.binary,
            command,
            error: 'empty_command',
        };
    }

    if (!isSafeInstallCommand(tokens)) {
        return {
            kind: 'command',
            label: plan.label,
            success: false,
            skipped: true,
            binary: plan.binary,
            command,
            error: 'unsupported_install_command',
        };
    }

    const [bin, ...args] = tokens;
    const result = spawnSync(bin, args, {
        encoding: 'utf-8',
        timeout: 5 * 60 * 1000,
    });

    if (result.error) {
        return {
            kind: 'command',
            label: plan.label,
            success: false,
            binary: plan.binary,
            command,
            error: result.error.message,
            output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim() || undefined,
        };
    }

    return {
        kind: 'command',
        label: plan.label,
        success: result.status === 0,
        binary: plan.binary,
        command,
        error: result.status === 0 ? undefined : (result.stderr || `exit_code_${result.status}`).trim(),
        output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim() || undefined,
    };
}

function isSafeInstallCommand(tokens: string[]): boolean {
    return SAFE_INSTALL_COMMAND_PREFIXES.some((prefix) =>
        prefix.every((part, index) => tokens[index] === part)
    );
}

async function runDownloadInstall(
    plan: Extract<DependencyInstallPlan, { kind: 'download' }>,
    options: AutoInstallOptions
): Promise<SkillDependencyInstallAttempt> {
    try {
        const managedBinDir = getManagedBinDir(options.appDataDir);
        fs.mkdirSync(managedBinDir, { recursive: true });
        prependDirToPath(managedBinDir);

        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-skill-install-'));
        const fileName = getDownloadFileName(plan);
        const downloadPath = path.join(tempRoot, fileName);
        const response = await fetch(plan.url);
        if (!response.ok) {
            return {
                kind: 'download',
                label: plan.label,
                success: false,
                binary: plan.binary,
                url: plan.url,
                targetPath: downloadPath,
                error: `download_failed_${response.status}`,
            };
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(downloadPath, buffer);

        let installedBinaryPath: string | null;
        if (plan.extract) {
            const extractedDir = path.join(tempRoot, 'extract');
            fs.mkdirSync(extractedDir, { recursive: true });
            const expand = expandArchive(downloadPath, extractedDir);
            if (!expand.success) {
                return {
                    kind: 'download',
                    label: plan.label,
                    success: false,
                    binary: plan.binary,
                    url: plan.url,
                    targetPath: downloadPath,
                    error: expand.error,
                    output: expand.output,
                };
            }
            const extractedBinary = findBinaryInDirectory(extractedDir, plan.binary);
            if (!extractedBinary) {
                return {
                    kind: 'download',
                    label: plan.label,
                    success: false,
                    binary: plan.binary,
                    url: plan.url,
                    targetPath: extractedDir,
                    error: 'downloaded_archive_missing_binary',
                };
            }
            installedBinaryPath = installManagedBinary(extractedBinary, managedBinDir, plan.binary);
        } else {
            installedBinaryPath = installManagedBinary(downloadPath, managedBinDir, plan.binary);
        }

        return {
            kind: 'download',
            label: plan.label,
            success: true,
            binary: plan.binary,
            url: plan.url,
            targetPath: installedBinaryPath ?? undefined,
        };
    } catch (error) {
        return {
            kind: 'download',
            label: plan.label,
            success: false,
            binary: plan.binary,
            url: plan.url,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function getManagedBinDir(appDataDir?: string): string {
    const root = appDataDir?.trim() || path.join(os.homedir(), '.coworkany');
    return path.join(root, 'bin');
}

function prependDirToPath(dir: string): void {
    const pathParts = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    if (!pathParts.includes(dir)) {
        process.env.PATH = [dir, ...pathParts].join(path.delimiter);
    }
}

function getDownloadFileName(plan: Extract<DependencyInstallPlan, { kind: 'download' }>): string {
    try {
        const url = new URL(plan.url);
        const baseName = path.basename(url.pathname);
        if (baseName && baseName !== '/') {
            return baseName;
        }
    } catch {
        // fall through
    }

    return process.platform === 'win32' ? `${plan.binary}.exe` : plan.binary;
}

function expandArchive(
    archivePath: string,
    targetDir: string
): { success: boolean; error?: string; output?: string } {
    const lower = archivePath.toLowerCase();
    const outputParts: string[] = [];

    if (lower.endsWith('.zip')) {
        if (process.platform === 'win32') {
            const result = spawnSync('powershell', [
                '-NoProfile',
                '-Command',
                `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force`,
            ], { encoding: 'utf-8', timeout: 5 * 60 * 1000 });
            outputParts.push(result.stdout, result.stderr);
            return result.status === 0
                ? { success: true, output: outputParts.filter(Boolean).join('\n').trim() || undefined }
                : { success: false, error: result.error?.message || result.stderr.trim() || `exit_code_${result.status}`, output: outputParts.filter(Boolean).join('\n').trim() || undefined };
        }

        const unzipCommand = commandExists('unzip')
            ? { command: 'unzip', args: ['-o', archivePath, '-d', targetDir] }
            : commandExists('tar')
                ? { command: 'tar', args: ['-xf', archivePath, '-C', targetDir] }
                : null;
        if (!unzipCommand) {
            return { success: false, error: 'zip_extractor_unavailable' };
        }
        const result = spawnSync(unzipCommand.command, unzipCommand.args, {
            encoding: 'utf-8',
            timeout: 5 * 60 * 1000,
        });
        outputParts.push(result.stdout, result.stderr);
        return result.status === 0
            ? { success: true, output: outputParts.filter(Boolean).join('\n').trim() || undefined }
            : { success: false, error: result.error?.message || result.stderr.trim() || `exit_code_${result.status}`, output: outputParts.filter(Boolean).join('\n').trim() || undefined };
    }

    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar')) {
        if (!commandExists('tar')) {
            return { success: false, error: 'tar_extractor_unavailable' };
        }
        const result = spawnSync('tar', ['-xf', archivePath, '-C', targetDir], {
            encoding: 'utf-8',
            timeout: 5 * 60 * 1000,
        });
        outputParts.push(result.stdout, result.stderr);
        return result.status === 0
            ? { success: true, output: outputParts.filter(Boolean).join('\n').trim() || undefined }
            : { success: false, error: result.error?.message || result.stderr.trim() || `exit_code_${result.status}`, output: outputParts.filter(Boolean).join('\n').trim() || undefined };
    }

    return { success: false, error: 'unsupported_archive_format' };
}

function commandExists(binary: string): boolean {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(probe, [binary], {
        stdio: 'ignore',
    });
    return result.status === 0;
}

function findBinaryInDirectory(root: string, binary: string): string | null {
    const candidates = new Set(
        process.platform === 'win32'
            ? [binary, `${binary}.exe`, `${binary}.cmd`, `${binary}.bat`, `${binary}.ps1`]
            : [binary]
    );
    const stack = [root];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;

        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (candidates.has(entry.name)) {
                return fullPath;
            }
        }
    }

    return null;
}

function installManagedBinary(sourcePath: string, managedBinDir: string, binary: string): string {
    const sourceExt = path.extname(sourcePath);
    const targetName =
        process.platform === 'win32'
            ? (sourceExt || '.exe').match(/^\.(exe|cmd|bat|ps1)$/i)
                ? `${binary}${sourceExt || '.exe'}`
                : `${binary}.exe`
            : binary;
    const targetPath = path.join(managedBinDir, targetName);
    fs.copyFileSync(sourcePath, targetPath);
    if (process.platform !== 'win32') {
        fs.chmodSync(targetPath, 0o755);
    }
    return targetPath;
}
