import { ToolpackManifest } from '../protocol';
import { listBuiltinToolpacks } from '../data/defaults';
import { CORE_TOOLPACK_ID, createCoreToolpackManifest } from '../data/coreToolpack';
import * as fs from 'fs';
import * as path from 'path';
export interface StoredToolpack {
    manifest: ToolpackManifest;
    enabled: boolean;
    workingDir: string;
    installedAt: string;
    lastUsedAt?: string;
    isBuiltin?: boolean;
}
export class ToolpackStore {
    private storagePath: string;
    private toolpacks: Map<string, StoredToolpack> = new Map();
    constructor(workspaceRoot: string) {
        this.storagePath = path.join(workspaceRoot, '.coworkany', 'toolpacks.json');
        this.load();
    }
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
    list(): StoredToolpack[] {
        const stored = Array.from(this.toolpacks.values());
        const standard = this.getStandardToolpack();
        const builtins = listBuiltinToolpacks().map((manifest) => ({
            manifest,
            enabled: true,
            workingDir: '',
            installedAt: new Date().toISOString(),
            isBuiltin: true,
        })).filter((b) => !this.hasStoredToolpackIdentifier(b.manifest.id) && !this.hasStoredToolpackIdentifier(b.manifest.name));
        const storedWithoutCore = stored.filter((toolpack) => !this.isCoreToolpackManifest(toolpack.manifest));
        return [standard, ...builtins, ...storedWithoutCore];
    }
    listEnabled(): StoredToolpack[] {
        return this.list().filter((t) => t.enabled);
    }
    private getStandardToolpack(): StoredToolpack {
        return {
            manifest: createCoreToolpackManifest(),
            enabled: true,
            workingDir: '',
            installedAt: new Date().toISOString(),
        };
    }
    get(name: string): StoredToolpack | undefined {
        if (this.isStandardToolpackIdentifier(name)) {
            return this.getStandardToolpack();
        }
        const stored = this.toolpacks.get(name);
        if (stored) return stored;
        const builtin = listBuiltinToolpacks().find((b) => b.name === name);
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
    getById(id: string): StoredToolpack | undefined {
        if (this.isStandardToolpackIdentifier(id)) {
            return this.getStandardToolpack();
        }
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
    add(manifest: ToolpackManifest, workingDir: string): boolean {
        if (this.isCoreToolpackManifest(manifest)) {
            console.warn(`[ToolpackStore] Cannot override core toolpack: ${manifest.id ?? manifest.name}`);
            return false;
        }
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
        return true;
    }
    remove(name: string): boolean {
        if (this.isStandardToolpackIdentifier(name)) {
            console.warn(`[ToolpackStore] Cannot remove core toolpack: ${name}`);
            return false;
        }
        const builtin = listBuiltinToolpacks().find((b) => b.name === name);
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
    removeById(id: string): boolean {
        if (this.isStandardToolpackIdentifier(id)) {
            console.warn(`[ToolpackStore] Cannot remove core toolpack: ${id}`);
            return false;
        }
        if (this.toolpacks.has(id)) {
            return this.remove(id);
        }
        const entry = Array.from(this.toolpacks.entries()).find(
            ([, value]) => value.manifest.id === id || value.manifest.name === id
        );
        if (!entry) return false;
        return this.remove(entry[0]);
    }
    setEnabled(name: string, enabled: boolean): boolean {
        if (this.isStandardToolpackIdentifier(name)) {
            console.warn(`[ToolpackStore] Cannot disable core toolpack: ${name}`);
            return enabled === true;
        }
        const toolpack = this.toolpacks.get(name);
        if (!toolpack) return false;
        toolpack.enabled = enabled;
        this.save();
        console.log(`[ToolpackStore] ${name} enabled: ${enabled}`);
        return true;
    }
    setEnabledById(id: string, enabled: boolean): boolean {
        if (this.isStandardToolpackIdentifier(id)) {
            return this.setEnabled(id, enabled);
        }
        if (this.toolpacks.has(id)) {
            return this.setEnabled(id, enabled);
        }
        const entry = Array.from(this.toolpacks.entries()).find(
            ([, value]) => value.manifest.id === id || value.manifest.name === id
        );
        if (!entry) return false;
        return this.setEnabled(entry[0], enabled);
    }
    markUsed(name: string): void {
        const toolpack = this.toolpacks.get(name);
        if (toolpack) {
            toolpack.lastUsedAt = new Date().toISOString();
            this.save();
        }
    }

    private isStandardToolpackIdentifier(value: string): boolean {
        const normalized = value.trim().toLowerCase();
        return normalized === CORE_TOOLPACK_ID || normalized === 'standard tools';
    }

    private isCoreToolpackManifest(manifest: ToolpackManifest): boolean {
        return this.isStandardToolpackIdentifier(manifest.id ?? '')
            || this.isStandardToolpackIdentifier(manifest.name);
    }

    private hasStoredToolpackIdentifier(value: string): boolean {
        if (this.toolpacks.has(value)) {
            return true;
        }
        return Array.from(this.toolpacks.values()).some(
            (toolpack) => toolpack.manifest.id === value || toolpack.manifest.name === value,
        );
    }
}
