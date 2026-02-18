/**
 * Package Manager Auto-Detection
 * Based on everything-claude-code implementation
 *
 * Detection Priority:
 * 1. Environment variable (COWORKANY_PACKAGE_MANAGER)
 * 2. Project config (.coworkany/package-manager.json)
 * 3. package.json packageManager field
 * 4. Lock file detection (pnpm > bun > yarn > npm)
 * 5. Global user preference (~/.coworkany/package-manager.json)
 * 6. System detection (first available)
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

interface PackageManagerConfig {
    packageManager: PackageManager;
}

/**
 * Check if a command exists in the system
 */
function commandExists(command: string): boolean {
    try {
        execSync(`${command} --version`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Detect package manager from lock files
 */
function detectFromLockFiles(workspacePath: string): PackageManager | null {
    const lockFiles: Array<[string, PackageManager]> = [
        ['pnpm-lock.yaml', 'pnpm'],
        ['bun.lockb', 'bun'],
        ['yarn.lock', 'yarn'],
        ['package-lock.json', 'npm'],
    ];

    for (const [lockFile, manager] of lockFiles) {
        if (fs.existsSync(path.join(workspacePath, lockFile))) {
            return manager;
        }
    }

    return null;
}

/**
 * Read package manager from config file
 */
function readConfig(configPath: string): PackageManager | null {
    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf-8');
            const config: PackageManagerConfig = JSON.parse(data);
            return config.packageManager;
        }
    } catch (error) {
        console.error(`[PackageManager] Failed to read config at ${configPath}:`, error);
    }
    return null;
}

/**
 * Detect available package managers on the system
 */
function detectAvailableManagers(): PackageManager[] {
    const managers: PackageManager[] = ['pnpm', 'bun', 'yarn', 'npm'];
    return managers.filter(commandExists);
}

/**
 * Detect package manager for a workspace
 *
 * @param workspacePath - Path to the workspace directory
 * @returns Detected package manager
 */
export function detectPackageManager(workspacePath: string): PackageManager {
    // 1. Check environment variable
    const envManager = process.env.COWORKANY_PACKAGE_MANAGER as PackageManager | undefined;
    if (envManager && ['npm', 'pnpm', 'yarn', 'bun'].includes(envManager)) {
        console.log(`[PackageManager] Using from environment: ${envManager}`);
        return envManager;
    }

    // 2. Check project config
    const projectConfig = path.join(workspacePath, '.coworkany', 'package-manager.json');
    const projectManager = readConfig(projectConfig);
    if (projectManager) {
        console.log(`[PackageManager] Using from project config: ${projectManager}`);
        return projectManager;
    }

    // 3. Check package.json packageManager field
    const pkgPath = path.join(workspacePath, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
            const pkg = JSON.parse(pkgContent);
            if (pkg.packageManager) {
                // Format: "pnpm@8.6.0" -> "pnpm"
                const manager = pkg.packageManager.split('@')[0] as PackageManager;
                if (['npm', 'pnpm', 'yarn', 'bun'].includes(manager)) {
                    console.log(`[PackageManager] Using from package.json: ${manager}`);
                    return manager;
                }
            }
        } catch (error) {
            console.error('[PackageManager] Failed to parse package.json:', error);
        }
    }

    // 4. Detect from lock files
    const lockFileManager = detectFromLockFiles(workspacePath);
    if (lockFileManager) {
        console.log(`[PackageManager] Detected from lock file: ${lockFileManager}`);
        return lockFileManager;
    }

    // 5. Check global user preference
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const globalConfig = path.join(homeDir, '.coworkany', 'package-manager.json');
    const globalManager = readConfig(globalConfig);
    if (globalManager) {
        console.log(`[PackageManager] Using from global config: ${globalManager}`);
        return globalManager;
    }

    // 6. System detection - first available
    const available = detectAvailableManagers();
    if (available.length > 0) {
        console.log(`[PackageManager] Using first available: ${available[0]}`);
        return available[0];
    }

    // 7. Fallback to npm
    console.log('[PackageManager] Falling back to npm');
    return 'npm';
}

/**
 * Get package manager commands
 */
export function getPackageManagerCommands(manager: PackageManager) {
    const commands = {
        npm: {
            install: 'npm install',
            test: 'npm test',
            build: 'npm run build',
            dev: 'npm run dev',
            run: (script: string) => `npm run ${script}`,
        },
        pnpm: {
            install: 'pnpm install',
            test: 'pnpm test',
            build: 'pnpm build',
            dev: 'pnpm dev',
            run: (script: string) => `pnpm ${script}`,
        },
        yarn: {
            install: 'yarn install',
            test: 'yarn test',
            build: 'yarn build',
            dev: 'yarn dev',
            run: (script: string) => `yarn ${script}`,
        },
        bun: {
            install: 'bun install',
            test: 'bun test',
            build: 'bun run build',
            dev: 'bun run dev',
            run: (script: string) => `bun run ${script}`,
        },
    };

    return commands[manager];
}

/**
 * Save package manager preference to config
 */
export function savePackageManagerPreference(
    workspacePath: string,
    manager: PackageManager,
    global = false
): void {
    const configDir = global
        ? path.join(process.env.HOME || process.env.USERPROFILE || '', '.coworkany')
        : path.join(workspacePath, '.coworkany');

    const configPath = path.join(configDir, 'package-manager.json');

    try {
        // Ensure directory exists
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }

        const config: PackageManagerConfig = { packageManager: manager };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`[PackageManager] Saved preference: ${manager} at ${configPath}`);
    } catch (error) {
        console.error('[PackageManager] Failed to save preference:', error);
    }
}
