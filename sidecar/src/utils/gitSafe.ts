
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class GitSafeWrapper {
    private workspacePath: string;

    constructor(workspacePath: string) {
        this.workspacePath = workspacePath;
    }

    private async runGit(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawn('git', args, {
                cwd: this.workspacePath,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(`Git command failed: git ${args.join(' ')}\n${stderr}`));
                }
            });
        });
    }

    async isGitInitialized(): Promise<boolean> {
        return fs.existsSync(path.join(this.workspacePath, '.git'));
    }

    async init(): Promise<void> {
        if (!await this.isGitInitialized()) {
            await this.runGit(['init']);
            // Create initial commit if empty
            await this.runGit(['add', '.']);
            try {
                await this.runGit(['commit', '-m', '"Initial commit"']);
            } catch (e) {
                // Ignore if nothing to commit
            }
        }
    }

    async getCurrentBranch(): Promise<string> {
        return this.runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    }

    async createCheckpoint(taskName: string): Promise<string> {
        await this.init();

        // Ensure clean state before checkpoint
        const status = await this.runGit(['status', '--porcelain']);
        if (status.length > 0) {
            await this.runGit(['add', '.']);
            await this.runGit(['commit', '-m', '"Auto-save before task: ' + taskName + '"']);
        }

        const baseBranch = await this.getCurrentBranch();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeBranch = `agent/safe/${timestamp}/${taskName.replace(/[^a-zA-Z0-9-]/g, '_')}`;

        await this.runGit(['checkout', '-b', safeBranch]);
        return safeBranch;
    }

    async commitCheckpoint(message: string): Promise<void> {
        const status = await this.runGit(['status', '--porcelain']);
        if (status.length > 0) {
            await this.runGit(['add', '.']);
            await this.runGit(['commit', '-m', `"${message}"`]);
        }
    }

    async rollbackToCheckpoint(baseBranch: string): Promise<void> {
        // Force checkout back to base branch
        await this.runGit(['checkout', '--force', baseBranch]);
        // Delete the temp branch (we failed)
        // Note: We might want to keep it for debugging, but for now let's clean up
        // const current = await this.getCurrentBranch();
        // await this.runGit(['branch', '-D', current]); 
    }

    async mergeAndPush(baseBranch: string, semanticMessage: string): Promise<void> {
        const currentBranch = await this.getCurrentBranch();
        await this.runGit(['checkout', baseBranch]);
        await this.runGit(['merge', '--squash', currentBranch]);
        await this.runGit(['commit', '-m', `"${semanticMessage}"`]);
        await this.runGit(['branch', '-D', currentBranch]);
    }
}

/**
 * Execute a task with automatic Git rollback protection
 */
export async function runSafeTask<T>(
    workspacePath: string,
    taskName: string,
    taskFn: () => Promise<T>
): Promise<T> {
    const git = new GitSafeWrapper(workspacePath);
    let baseBranch: string;

    try {
        baseBranch = await git.getCurrentBranch();
    } catch (e) {
        // Maybe git not initialized
        await git.init();
        baseBranch = 'main'; // or master, whatever init created
    }

    const checkpointBranch = await git.createCheckpoint(taskName);
    console.log(`[GitSafe] Created checkpoint: ${checkpointBranch}`);

    try {
        const result = await taskFn();

        // If successful, commit and squash
        await git.commitCheckpoint(`Completed task: ${taskName}`);
        await git.mergeAndPush(baseBranch, `feat(agent): ${taskName}`);

        return result;
    } catch (error) {
        console.error(`[GitSafe] Task failed, rolling back to ${baseBranch}`);
        await git.rollbackToCheckpoint(baseBranch);
        throw error;
    }
}
