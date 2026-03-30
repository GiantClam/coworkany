import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
export interface Workspace {
    id: string;
    name: string;
    path: string;
    createdAt: string;
    lastAccessedAt: string;
    autoNamed?: boolean;
    defaultSkills?: string[];
    defaultToolpacks?: string[];
}
export interface WorkspaceConfig {
    workspaces: Workspace[];
    activeWorkspaceId?: string;
}
const LEGACY_AUTO_NAMES = new Set(['new workspace', 'workspace']);
function normalizeDefaultToolpacks(toolpacks?: string[]): string[] {
    if (!Array.isArray(toolpacks) || toolpacks.length === 0) {
        return ['builtin-websearch'];
    }
    const normalized = toolpacks
        .map((toolpackId) => (toolpackId === 'websearch' ? 'builtin-websearch' : toolpackId))
        .filter((toolpackId): toolpackId is string => typeof toolpackId === 'string' && toolpackId.length > 0);
    return normalized.length > 0 ? Array.from(new Set(normalized)) : ['builtin-websearch'];
}
function normalizeWorkspaceSummaryText(value: string): string {
    return value
        .replace(/\s+/g, ' ')
        .replace(/[`*_~]/g, '')
        .trim();
}
function summarizeWorkspaceName(source: string): string {
    const normalized = normalizeWorkspaceSummaryText(source);
    if (!normalized) {
        return 'New workspace';
    }
    const firstLine = normalized
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? normalized;
    const sentenceMatch = firstLine.match(/^(.+?[。！？.!?;；])/);
    const candidate = sentenceMatch?.[1]
        ? sentenceMatch[1].slice(0, -1).trim()
        : firstLine;
    if (!candidate) {
        return 'New workspace';
    }
    const hasCjk = /[\u3400-\u9fff]/.test(candidate);
    if (hasCjk) {
        return candidate.length > 18 ? `${candidate.slice(0, 18)}...` : candidate;
    }
    if (candidate.length <= 42) {
        return candidate;
    }
    const truncated = candidate.slice(0, 42).trim();
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace >= 24) {
        return `${truncated.slice(0, lastSpace).trim()}...`;
    }
    return `${truncated}...`;
}
function isAutoNamedWorkspace(workspace: Workspace): boolean {
    if (workspace.autoNamed) {
        return true;
    }
    return LEGACY_AUTO_NAMES.has(workspace.name.trim().toLowerCase());
}
export class WorkspaceStore {
    private configPath: string;
    private config: WorkspaceConfig = { workspaces: [] };
    constructor(appDataDir: string) {
        this.configPath = path.join(appDataDir, 'workspaces.json');
        this.load();
    }
    private normalizeWorkspace(workspace: Workspace): Workspace {
        return {
            ...workspace,
            name: workspace.name.trim() || 'New workspace',
            path: path.normalize(workspace.path),
            autoNamed: typeof workspace.autoNamed === 'boolean'
                ? workspace.autoNamed
                : isAutoNamedWorkspace(workspace),
            defaultSkills: Array.isArray(workspace.defaultSkills) ? workspace.defaultSkills : [],
            defaultToolpacks: normalizeDefaultToolpacks(workspace.defaultToolpacks),
        };
    }
    private normalizeConfig(raw: WorkspaceConfig): WorkspaceConfig {
        const workspaces = Array.isArray(raw.workspaces) ? raw.workspaces : [];
        return {
            workspaces: workspaces
                .filter((workspace): workspace is Workspace => (
                    !!workspace &&
                    typeof workspace.id === 'string' &&
                    typeof workspace.name === 'string' &&
                    typeof workspace.path === 'string' &&
                    workspace.path.trim().length > 0
                ))
                .map((workspace) => this.normalizeWorkspace(workspace)),
            activeWorkspaceId: typeof raw.activeWorkspaceId === 'string'
                ? raw.activeWorkspaceId
                : undefined,
        };
    }
    private load(): void {
        try {
            let baseConfig: WorkspaceConfig = { workspaces: [] };
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf-8');
                baseConfig = this.normalizeConfig(JSON.parse(data) as WorkspaceConfig);
            }
            this.config = baseConfig;
            if (!fs.existsSync(this.configPath)) {
                this.save();
            }
            console.error(`[WorkspaceStore] Loaded ${this.config.workspaces.length} workspaces`);
        } catch (error) {
            console.error('[WorkspaceStore] Failed to load:', error);
            this.config = { workspaces: [] };
        }
    }
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
    list(): Workspace[] {
        return this.config.workspaces;
    }
    get(id: string): Workspace | undefined {
        return this.config.workspaces.find((w) => w.id === id);
    }
    getByPath(workspacePath: string): Workspace | undefined {
        const normalized = path.normalize(workspacePath);
        return this.config.workspaces.find((w) => path.normalize(w.path) === normalized);
    }
    renameAutoNamedByPath(workspacePath: string, summarySource: string): Workspace | undefined {
        const workspace = this.getByPath(workspacePath);
        if (!workspace || !isAutoNamedWorkspace(workspace)) {
            return undefined;
        }
        workspace.name = summarizeWorkspaceName(summarySource);
        workspace.autoNamed = false;
        workspace.lastAccessedAt = new Date().toISOString();
        this.save();
        return workspace;
    }
    create(name: string, workspacePath: string): Workspace {
        const existing = this.getByPath(workspacePath);
        if (existing) {
            existing.lastAccessedAt = new Date().toISOString();
            this.save();
            return existing;
        }
        const trimmedName = name.trim();
        const autoNamed = trimmedName.length === 0;
        const finalName = autoNamed ? 'New workspace' : trimmedName;
        const workspace: Workspace = {
            id: randomUUID(),
            name: finalName,
            path: path.normalize(workspacePath),
            createdAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString(),
            autoNamed,
            defaultSkills: [],
            defaultToolpacks: ['builtin-websearch'], // Include builtin-websearch by default
        };
        this.config.workspaces.push(workspace);
        this.save();
        this.initWorkspaceDirectory(workspacePath);
        console.error(`[WorkspaceStore] Created workspace: ${name} at ${workspacePath}`);
        return workspace;
    }
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
    update(id: string, updates: Partial<Omit<Workspace, 'id' | 'createdAt'>>): Workspace | undefined {
        const workspace = this.get(id);
        if (!workspace) return undefined;
        const nextUpdates = { ...updates };
        if (typeof nextUpdates.name === 'string') {
            const trimmedName = nextUpdates.name.trim();
            if (!trimmedName) {
                delete nextUpdates.name;
            } else {
                nextUpdates.name = trimmedName;
                if (typeof nextUpdates.autoNamed === 'undefined') {
                    nextUpdates.autoNamed = false;
                }
            }
        }
        Object.assign(workspace, nextUpdates, { lastAccessedAt: new Date().toISOString() });
        this.save();
        return workspace;
    }
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
    getActive(): Workspace | undefined {
        if (!this.config.activeWorkspaceId) return undefined;
        return this.get(this.config.activeWorkspaceId);
    }
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
