/**
 * Workspace Store
 *
 * JSON-based persistence for workspace configurations.
 * Each workspace represents a local directory that can have its own skills and MCP servers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface Workspace {
    id: string;
    name: string;
    path: string;
    createdAt: string;
    lastAccessedAt: string;
    defaultSkills?: string[];
    defaultToolpacks?: string[];
}

export interface WorkspaceConfig {
    workspaces: Workspace[];
    activeWorkspaceId?: string;
}

// ============================================================================
// Store
// ============================================================================

export class WorkspaceStore {
    private configPath: string;
    private config: WorkspaceConfig = { workspaces: [] };

    constructor(appDataDir: string) {
        this.configPath = path.join(appDataDir, 'workspaces.json');
        this.load();
    }

    /**
     * Load workspaces from storage
     */
    private load(): void {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf-8');
                this.config = JSON.parse(data) as WorkspaceConfig;
                console.error(`[WorkspaceStore] Loaded ${this.config.workspaces.length} workspaces`);
            }
        } catch (error) {
            console.error('[WorkspaceStore] Failed to load:', error);
            this.config = { workspaces: [] };
        }
    }

    /**
     * Save workspaces to storage
     */
    private save(): void {
        try {
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        } catch (error) {
            console.error('[WorkspaceStore] Failed to save:', error);
        }
    }

    /**
     * List all workspaces
     */
    list(): Workspace[] {
        return this.config.workspaces;
    }

    /**
     * Get a workspace by ID
     */
    get(id: string): Workspace | undefined {
        return this.config.workspaces.find((w) => w.id === id);
    }

    /**
     * Get workspace by path
     */
    getByPath(workspacePath: string): Workspace | undefined {
        const normalized = path.normalize(workspacePath);
        return this.config.workspaces.find((w) => path.normalize(w.path) === normalized);
    }

    /**
     * Create a new workspace
     */
    create(name: string, workspacePath: string): Workspace {
        // Check if workspace with same path exists
        const existing = this.getByPath(workspacePath);
        if (existing) {
            // Update last accessed time and return
            existing.lastAccessedAt = new Date().toISOString();
            this.save();
            return existing;
        }

        const workspace: Workspace = {
            id: randomUUID(),
            name,
            path: path.normalize(workspacePath),
            createdAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString(),
            defaultSkills: [],
            defaultToolpacks: ['builtin-websearch'], // Include builtin-websearch by default
        };

        this.config.workspaces.push(workspace);
        this.save();

        // Create .coworkany directory structure
        this.initWorkspaceDirectory(workspacePath);

        console.error(`[WorkspaceStore] Created workspace: ${name} at ${workspacePath}`);
        return workspace;
    }

    /**
     * Initialize workspace directory structure
     */
    private initWorkspaceDirectory(workspacePath: string): void {
        const dirs = [
            path.join(workspacePath, '.coworkany'),
            path.join(workspacePath, '.coworkany', 'skills'),
            path.join(workspacePath, '.coworkany', 'mcp'),
        ];

        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }

    /**
     * Update a workspace
     */
    update(id: string, updates: Partial<Omit<Workspace, 'id' | 'createdAt'>>): Workspace | undefined {
        const workspace = this.get(id);
        if (!workspace) return undefined;

        Object.assign(workspace, updates, { lastAccessedAt: new Date().toISOString() });
        this.save();
        return workspace;
    }

    /**
     * Delete a workspace (does not delete files)
     */
    delete(id: string): boolean {
        const index = this.config.workspaces.findIndex((w) => w.id === id);
        if (index === -1) return false;

        this.config.workspaces.splice(index, 1);
        if (this.config.activeWorkspaceId === id) {
            this.config.activeWorkspaceId = undefined;
        }
        this.save();
        console.error(`[WorkspaceStore] Deleted workspace: ${id}`);
        return true;
    }

    /**
     * Set active workspace
     */
    setActive(id: string | undefined): void {
        if (id && !this.get(id)) {
            console.warn(`[WorkspaceStore] Workspace ${id} not found`);
            return;
        }
        this.config.activeWorkspaceId = id;
        if (id) {
            const workspace = this.get(id);
            if (workspace) {
                workspace.lastAccessedAt = new Date().toISOString();
            }
        }
        this.save();
    }

    /**
     * Get active workspace
     */
    getActive(): Workspace | undefined {
        if (!this.config.activeWorkspaceId) return undefined;
        return this.get(this.config.activeWorkspaceId);
    }

    /**
     * Get or create workspace for a path
     */
    getOrCreate(workspacePath: string): Workspace {
        const existing = this.getByPath(workspacePath);
        if (existing) {
            existing.lastAccessedAt = new Date().toISOString();
            this.save();
            return existing;
        }
        return this.create(path.basename(workspacePath), workspacePath);
    }
}
