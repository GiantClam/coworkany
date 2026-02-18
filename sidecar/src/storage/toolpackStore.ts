import { ToolpackManifest } from '../protocol';
import { BUILTIN_TOOLPACKS } from '../data/defaults';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface StoredToolpack {
    manifest: ToolpackManifest;
    enabled: boolean;
    workingDir: string;
    installedAt: string;
    lastUsedAt?: string;
    isBuiltin?: boolean;
}

// ============================================================================
// Store
// ============================================================================

export class ToolpackStore {
    private storagePath: string;
    private toolpacks: Map<string, StoredToolpack> = new Map();

    constructor(workspaceRoot: string) {
        this.storagePath = path.join(workspaceRoot, '.coworkany', 'toolpacks.json');
        this.load();
    }

    /**
     * Load toolpacks from storage
     */
    private load(): void {
        try {
            if (fs.existsSync(this.storagePath)) {
                const data = fs.readFileSync(this.storagePath, 'utf-8');
                const parsed = JSON.parse(data) as Record<string, StoredToolpack>;
                this.toolpacks = new Map(Object.entries(parsed));
                console.log(`[ToolpackStore] Loaded ${this.toolpacks.size} toolpacks`);
            }
        } catch (error) {
            console.error('[ToolpackStore] Failed to load:', error);
            this.toolpacks = new Map();
        }
    }

    /**
     * Save toolpacks to storage
     */
    private save(): void {
        try {
            const dir = path.dirname(this.storagePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const data = Object.fromEntries(this.toolpacks);
            fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('[ToolpackStore] Failed to save:', error);
        }
    }

    /**
     * List all stored toolpacks
     */
    list(): StoredToolpack[] {
        const stored = Array.from(this.toolpacks.values());
        const builtins = BUILTIN_TOOLPACKS.map((manifest) => ({
            manifest,
            enabled: true,
            workingDir: '',
            installedAt: new Date().toISOString(),
            isBuiltin: true,
        })).filter((b) => !this.toolpacks.has(b.manifest.name)); // Avoid duplicates if shadowed/overridden

        return [...builtins, ...stored];
    }

    /**
     * List enabled toolpacks only
     */
    listEnabled(): StoredToolpack[] {
        const standard = this.getStandardToolpack();
        const stored = this.list().filter((t) => t.enabled);
        return [standard, ...stored];
    }

    private getStandardToolpack(): StoredToolpack {
        return {
            manifest: {
                id: 'standard-tools',
                name: 'Standard Tools',
                version: '1.0.0',
                description: 'Core agent capabilities (filesystem, command execution).',
                tools: ['view_file', 'list_dir', 'write_to_file', 'replace_file_content', 'run_command'],
                runtime: 'internal',
                effects: [],
                tags: ['core', 'standard'],
            },
            enabled: true,
            workingDir: '',
            installedAt: new Date().toISOString(),
        };
    }

    /**
     * Get a toolpack by name
     */
    get(name: string): StoredToolpack | undefined {
        const stored = this.toolpacks.get(name);
        if (stored) return stored;

        const builtin = BUILTIN_TOOLPACKS.find((b) => b.name === name);
        if (builtin) {
            return {
                manifest: builtin,
                enabled: true,
                workingDir: '',
                installedAt: new Date().toISOString(),
                isBuiltin: true,
            };
        }
        return undefined;
    }

    /**
     * Get a toolpack by id or name
     */
    getById(id: string): StoredToolpack | undefined {
        if (this.toolpacks.has(id)) {
            return this.toolpacks.get(id);
        }
        for (const value of this.toolpacks.values()) {
            if (value.manifest.id === id || value.manifest.name === id) {
                return value;
            }
        }
        return undefined;
    }

    /**
     * Add or update a toolpack
     */
    add(manifest: ToolpackManifest, workingDir: string): void {
        const existing = this.toolpacks.get(manifest.name);
        this.toolpacks.set(manifest.name, {
            manifest,
            enabled: existing?.enabled ?? true,
            workingDir,
            installedAt: existing?.installedAt ?? new Date().toISOString(),
            lastUsedAt: existing?.lastUsedAt,
        });
        this.save();
        console.log(`[ToolpackStore] Added toolpack: ${manifest.name}`);
    }

    /**
     * Remove a toolpack
     */
    remove(name: string): boolean {
        const builtin = BUILTIN_TOOLPACKS.find((b) => b.name === name);
        if (builtin) {
            console.warn(`[ToolpackStore] Cannot remove builtin toolpack: ${name}`);
            return false;
        }

        const removed = this.toolpacks.delete(name);
        if (removed) {
            this.save();
            console.log(`[ToolpackStore] Removed toolpack: ${name}`);
        }
        return removed;
    }

    /**
     * Remove by id or name
     */
    removeById(id: string): boolean {
        if (this.toolpacks.has(id)) {
            return this.remove(id);
        }
        const entry = Array.from(this.toolpacks.entries()).find(
            ([, value]) => value.manifest.id === id || value.manifest.name === id
        );
        if (!entry) return false;
        return this.remove(entry[0]);
    }

    /**
     * Enable or disable a toolpack
     */
    setEnabled(name: string, enabled: boolean): boolean {
        const toolpack = this.toolpacks.get(name);
        if (!toolpack) return false;

        toolpack.enabled = enabled;
        this.save();
        console.log(`[ToolpackStore] ${name} enabled: ${enabled}`);
        return true;
    }

    /**
     * Enable or disable by id or name
     */
    setEnabledById(id: string, enabled: boolean): boolean {
        if (this.toolpacks.has(id)) {
            return this.setEnabled(id, enabled);
        }
        const entry = Array.from(this.toolpacks.entries()).find(
            ([, value]) => value.manifest.id === id || value.manifest.name === id
        );
        if (!entry) return false;
        return this.setEnabled(entry[0], enabled);
    }

    /**
     * Update last used timestamp
     */
    markUsed(name: string): void {
        const toolpack = this.toolpacks.get(name);
        if (toolpack) {
            toolpack.lastUsedAt = new Date().toISOString();
            this.save();
        }
    }
}
