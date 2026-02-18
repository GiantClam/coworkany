/**
 * Vault Manager
 *
 * Manages the markdown memory vault and provides auto-indexing functionality.
 * Integrates with the RAG service for semantic search.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getRagBridge, indexDocument } from './ragBridge';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_VAULT_PATH = path.join(os.homedir(), '.coworkany', 'vault');

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Vault Manager Class
// ============================================================================

export class VaultManager {
    private vaultPath: string;
    private autoIndex: boolean;

    constructor(config?: Partial<VaultConfig>) {
        this.vaultPath = config?.vaultPath || DEFAULT_VAULT_PATH;
        this.autoIndex = config?.autoIndex ?? true;

        // Ensure vault directory exists
        this.ensureVaultExists();
    }

    /**
     * Ensure the vault directory structure exists
     */
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

    /**
     * Get the vault path
     */
    getVaultPath(): string {
        return this.vaultPath;
    }

    /**
     * List all markdown files in the vault
     */
    listDocuments(): VaultDocument[] {
        const documents: VaultDocument[] = [];
        this.walkDirectory(this.vaultPath, documents);
        return documents;
    }

    /**
     * Walk directory recursively and collect markdown files
     */
    private walkDirectory(dir: string, documents: VaultDocument[]): void {
        if (!fs.existsSync(dir)) return;

        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                // Skip hidden directories and .index
                if (!entry.name.startsWith('.')) {
                    this.walkDirectory(fullPath, documents);
                }
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                const relativePath = path.relative(this.vaultPath, fullPath);
                const content = fs.readFileSync(fullPath, 'utf-8');
                const stats = fs.statSync(fullPath);

                // Extract title from frontmatter or first heading
                const title = this.extractTitle(content, entry.name);

                // Extract category from path
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

    /**
     * Extract title from markdown content
     */
    private extractTitle(content: string, filename: string): string {
        // Try frontmatter
        const frontmatterMatch = content.match(/^---\n[\s\S]*?title:\s*(.+)\n[\s\S]*?---/);
        if (frontmatterMatch) {
            return frontmatterMatch[1].trim().replace(/^["']|["']$/g, '');
        }

        // Try first heading
        const headingMatch = content.match(/^#\s+(.+)$/m);
        if (headingMatch) {
            return headingMatch[1].trim();
        }

        // Use filename
        return filename.replace('.md', '').replace(/[-_]/g, ' ');
    }

    /**
     * List categories in the vault
     */
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

    /**
     * Count markdown files in a directory
     */
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

    /**
     * Read a document by relative path
     */
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

    /**
     * Write a document to the vault
     */
    async writeDocument(
        relativePath: string,
        content: string,
        options?: {
            autoIndex?: boolean;
            metadata?: Record<string, unknown>;
        }
    ): Promise<boolean> {
        const fullPath = path.join(this.vaultPath, relativePath);

        // Ensure directory exists
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Write file
        fs.writeFileSync(fullPath, content, 'utf-8');

        // Auto-index if enabled
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

    /**
     * Delete a document from the vault
     */
    async deleteDocument(relativePath: string): Promise<boolean> {
        const fullPath = path.join(this.vaultPath, relativePath);

        if (!fs.existsSync(fullPath)) {
            return false;
        }

        fs.unlinkSync(fullPath);

        // Remove from index
        try {
            const bridge = getRagBridge();
            await bridge.deleteDocument(relativePath);
        } catch (error) {
            console.error('[VaultManager] Failed to remove from index:', error);
        }

        return true;
    }

    /**
     * Save a memory/learning to the vault
     */
    async saveMemory(
        title: string,
        content: string,
        options?: {
            category?: 'learnings' | 'preferences' | 'projects' | string;
            tags?: string[];
            metadata?: Record<string, unknown>;
        }
    ): Promise<string> {
        const category = options?.category || 'learnings';
        const timestamp = new Date().toISOString().split('T')[0];
        const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
        const filename = `${timestamp}-${safeTitle}.md`;
        const relativePath = path.join(category, filename);

        // Build frontmatter
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

    /**
     * Sync all documents to the RAG index
     */
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

    /**
     * Search vault using RAG
     */
    async search(query: string, topK: number = 5) {
        const bridge = getRagBridge();
        return bridge.search({ query, topK });
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let vaultManagerInstance: VaultManager | null = null;

/**
 * Get the global vault manager instance
 */
export function getVaultManager(config?: Partial<VaultConfig>): VaultManager {
    if (!vaultManagerInstance) {
        vaultManagerInstance = new VaultManager(config);
    }
    return vaultManagerInstance;
}

/**
 * Initialize vault manager with custom configuration
 */
export function initVaultManager(config: Partial<VaultConfig>): VaultManager {
    vaultManagerInstance = new VaultManager(config);
    return vaultManagerInstance;
}
