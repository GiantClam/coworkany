
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getRagBridge, indexDocument } from './ragBridge';

const DEFAULT_VAULT_PATH = path.join(os.homedir(), '.coworkany', 'vault');

export interface VaultConfig {
    vaultPath: string;
    autoIndex: boolean;
    watchForChanges: boolean;
}

export interface VaultDocument {
    path: string;
    relativePath: string;
    title: string;
    category?: string;
    content: string;
    modifiedAt: Date;
}

export interface VaultCategory {
    name: string;
    path: string;
    documentCount: number;
}

export class VaultManager {
    private vaultPath: string;
    private autoIndex: boolean;

    constructor(config?: Partial<VaultConfig>) {
        this.vaultPath = config?.vaultPath || DEFAULT_VAULT_PATH;
        this.autoIndex = config?.autoIndex ?? true;

        this.ensureVaultExists();
    }

    private ensureVaultExists(): void {
        const dirs = [
            this.vaultPath,
            path.join(this.vaultPath, 'projects'),
            path.join(this.vaultPath, 'preferences'),
            path.join(this.vaultPath, 'learnings'),
        ];

        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }

    getVaultPath(): string {
        return this.vaultPath;
    }

    listDocuments(): VaultDocument[] {
        const documents: VaultDocument[] = [];
        this.walkDirectory(this.vaultPath, documents);
        return documents;
    }

    private walkDirectory(dir: string, documents: VaultDocument[]): void {
        if (!fs.existsSync(dir)) return;

        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (!entry.name.startsWith('.')) {
                    this.walkDirectory(fullPath, documents);
                }
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                const relativePath = path.relative(this.vaultPath, fullPath);
                const content = fs.readFileSync(fullPath, 'utf-8');
                const stats = fs.statSync(fullPath);

                const title = this.extractTitle(content, entry.name);

                const parts = relativePath.split(path.sep);
                const category = parts.length > 1 ? parts[0] : undefined;

                documents.push({
                    path: fullPath,
                    relativePath,
                    title,
                    category,
                    content,
                    modifiedAt: stats.mtime,
                });
            }
        }
    }

    private extractTitle(content: string, filename: string): string {
        const frontmatterMatch = content.match(/^---\n[\s\S]*?title:\s*(.+)\n[\s\S]*?---/);
        if (frontmatterMatch) {
            return frontmatterMatch[1].trim().replace(/^["']|["']$/g, '');
        }

        const headingMatch = content.match(/^#\s+(.+)$/m);
        if (headingMatch) {
            return headingMatch[1].trim();
        }

        return filename.replace('.md', '').replace(/[-_]/g, ' ');
    }

    listCategories(): VaultCategory[] {
        const categories: VaultCategory[] = [];

        if (!fs.existsSync(this.vaultPath)) return categories;

        const entries = fs.readdirSync(this.vaultPath, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                const categoryPath = path.join(this.vaultPath, entry.name);
                const mdFiles = this.countMarkdownFiles(categoryPath);

                categories.push({
                    name: entry.name,
                    path: categoryPath,
                    documentCount: mdFiles,
                });
            }
        }

        return categories;
    }

    private countMarkdownFiles(dir: string): number {
        let count = 0;

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                count += this.countMarkdownFiles(path.join(dir, entry.name));
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                count++;
            }
        }

        return count;
    }

    readDocument(relativePath: string): VaultDocument | null {
        const fullPath = path.join(this.vaultPath, relativePath);

        if (!fs.existsSync(fullPath)) {
            return null;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        const stats = fs.statSync(fullPath);
        const title = this.extractTitle(content, path.basename(relativePath));

        const parts = relativePath.split(path.sep);
        const category = parts.length > 1 ? parts[0] : undefined;

        return {
            path: fullPath,
            relativePath,
            title,
            category,
            content,
            modifiedAt: stats.mtime,
        };
    }

    async writeDocument(
        relativePath: string,
        content: string,
        options?: {
            autoIndex?: boolean;
            metadata?: Record<string, unknown>;
        }
    ): Promise<boolean> {
        const fullPath = path.join(this.vaultPath, relativePath);

        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(fullPath, content, 'utf-8');

        const shouldIndex = options?.autoIndex ?? this.autoIndex;
        if (shouldIndex) {
            try {
                await indexDocument(relativePath, content, options?.metadata);
            } catch (error) {
                console.error('[VaultManager] Failed to index document:', error);
            }
        }

        return true;
    }

    async deleteDocument(relativePath: string): Promise<boolean> {
        const fullPath = path.join(this.vaultPath, relativePath);

        if (!fs.existsSync(fullPath)) {
            return false;
        }

        fs.unlinkSync(fullPath);

        try {
            const bridge = getRagBridge();
            await bridge.deleteDocument(relativePath);
        } catch (error) {
            console.error('[VaultManager] Failed to remove from index:', error);
        }

        return true;
    }

    async saveMemory(
        title: string,
        content: string,
        options?: {
            category?: 'learnings' | 'preferences' | 'projects' | string;
            tags?: string[];
            metadata?: Record<string, unknown>;
            relativePathPrefix?: string;
        }
    ): Promise<string> {
        const category = options?.category || 'learnings';
        const timestamp = new Date().toISOString().split('T')[0];
        const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
        const filename = `${timestamp}-${safeTitle}.md`;
        const relativePath = options?.relativePathPrefix
            ? path.join(category, options.relativePathPrefix, filename)
            : path.join(category, filename);

        const frontmatter = [
            '---',
            `title: "${title}"`,
            `created: ${new Date().toISOString()}`,
        ];

        if (options?.tags && options.tags.length > 0) {
            frontmatter.push(`tags: [${options.tags.join(', ')}]`);
        }

        frontmatter.push('---', '');

        const fullContent = frontmatter.join('\n') + content;

        await this.writeDocument(relativePath, fullContent, {
            metadata: options?.metadata,
        });

        return relativePath;
    }

    async syncToIndex(): Promise<{
        synced: number;
        errors: Array<{ path: string; error: string }>;
    }> {
        const documents = this.listDocuments();
        let synced = 0;
        const errors: Array<{ path: string; error: string }> = [];

        for (const doc of documents) {
            try {
                await indexDocument(doc.relativePath, doc.content, {
                    category: doc.category,
                    title: doc.title,
                });
                synced++;
            } catch (error) {
                errors.push({
                    path: doc.relativePath,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return { synced, errors };
    }

    async search(query: string, topK: number = 5) {
        const bridge = getRagBridge();
        return bridge.search({ query, topK });
    }
}

let vaultManagerInstance: VaultManager | null = null;

export function getVaultManager(config?: Partial<VaultConfig>): VaultManager {
    if (!vaultManagerInstance) {
        vaultManagerInstance = new VaultManager(config);
    }
    return vaultManagerInstance;
}

export function initVaultManager(config: Partial<VaultConfig>): VaultManager {
    vaultManagerInstance = new VaultManager(config);
    return vaultManagerInstance;
}
