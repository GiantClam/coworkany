/**
 * RAG Bridge
 *
 * HTTP client for communicating with the Python RAG service.
 * Provides semantic search and indexing for the memory vault.
 */

// ============================================================================
// Configuration
// ============================================================================

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://127.0.0.1:8787';
const REQUEST_TIMEOUT = 30000; // 30 seconds

// ============================================================================
// Types
// ============================================================================

export interface IndexRequest {
    path: string;
    content: string;
    metadata?: Record<string, unknown>;
}

export interface SearchRequest {
    query: string;
    topK?: number;
    filterCategory?: string;
    includeContent?: boolean;
    metadataFilters?: Record<string, string | number | boolean>;
}

export interface SearchResult {
    path: string;
    title: string;
    content?: string;
    category?: string;
    score: number;
    metadata: Record<string, unknown>;
}

export interface SearchResponse {
    results: SearchResult[];
    query: string;
    totalIndexed: number;
}

export interface IndexStats {
    totalDocuments: number;
    totalChunks: number;
    categories: Record<string, number>;
    lastIndexed?: string;
    vaultPath: string;
}

export interface HealthStatus {
    status: 'healthy' | 'unhealthy';
    chromadbStatus: string;
    embeddingModel: string;
    vaultPath: string;
    indexedDocuments: number;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonObject
        : {};
}

function asString(value: unknown, fallback: string = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean = false): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
    return asObject(value);
}

async function readJsonObject(response: Response): Promise<JsonObject> {
    const value = await response.json();
    return asObject(value);
}

// ============================================================================
// RAG Bridge Class
// ============================================================================

export class RagBridge {
    private baseUrl: string;
    private timeout: number;

    constructor(baseUrl: string = RAG_SERVICE_URL, timeout: number = REQUEST_TIMEOUT) {
        this.baseUrl = baseUrl;
        this.timeout = timeout;
    }

    /**
     * Check if the RAG service is healthy
     */
    async healthCheck(): Promise<HealthStatus> {
        const response = await this.fetch('/health', { method: 'GET' });
        const data = await readJsonObject(response);
        const statusRaw = asString(data.status, 'unhealthy');

        return {
            status: statusRaw === 'healthy' ? 'healthy' : 'unhealthy',
            chromadbStatus: asString(data.chromadb_status),
            embeddingModel: asString(data.embedding_model),
            vaultPath: asString(data.vault_path),
            indexedDocuments: asNumber(data.indexed_documents),
        };
    }

    /**
     * Check if the RAG service is available
     */
    async isAvailable(): Promise<boolean> {
        try {
            const health = await this.healthCheck();
            return health.status === 'healthy';
        } catch {
            return false;
        }
    }

    /**
     * Index a single document
     */
    async indexDocument(request: IndexRequest): Promise<{
        success: boolean;
        path: string;
        docId: string;
        title: string;
    }> {
        const response = await this.fetch('/index', {
            method: 'POST',
            body: JSON.stringify(request),
        });

        const data = await readJsonObject(response);
        return {
            success: asBoolean(data.success, true),
            path: asString(data.path),
            docId: asString(data.doc_id),
            title: asString(data.title),
        };
    }

    /**
     * Search the memory vault
     */
    async search(request: SearchRequest): Promise<SearchResponse> {
        const response = await this.fetch('/search', {
            method: 'POST',
            body: JSON.stringify({
                query: request.query,
                top_k: request.topK ?? 5,
                filter_category: request.filterCategory,
                include_content: request.includeContent ?? true,
                metadata_filters: request.metadataFilters,
            }),
        });

        const data = await readJsonObject(response);
        return {
            results: asArray(data.results).map((result) => {
                const item = asObject(result);
                const content = item.content;
                const category = item.category;
                return {
                    path: asString(item.path),
                    title: asString(item.title),
                    content: typeof content === 'string' ? content : undefined,
                    category: typeof category === 'string' ? category : undefined,
                    score: asNumber(item.score),
                    metadata: asRecord(item.metadata),
                };
            }),
            query: asString(data.query),
            totalIndexed: asNumber(data.total_indexed),
        };
    }

    /**
     * Search and return formatted context for LLM
     */
    async searchForContext(
        query: string,
        options?: {
            topK?: number;
            filterCategory?: string;
            maxChars?: number;
            metadataFilters?: Record<string, string | number | boolean>;
        }
    ): Promise<string> {
        const results = await this.search({
            query,
            topK: options?.topK ?? 3,
            filterCategory: options?.filterCategory,
            includeContent: true,
            metadataFilters: options?.metadataFilters,
        });

        if (results.results.length === 0) {
            return '';
        }

        // Format results for LLM context
        const formatted = results.results
            .map((r, i) => {
                let entry = `[Memory ${i + 1}] ${r.title}`;
                if (r.category) {
                    entry += ` (${r.category})`;
                }
                entry += `\n${r.content || '(no content)'}`;
                return entry;
            })
            .join('\n\n---\n\n');

        // Truncate if too long
        const maxChars = options?.maxChars ?? 4000;
        if (formatted.length > maxChars) {
            return formatted.slice(0, maxChars) + '\n...[truncated]';
        }

        return formatted;
    }

    /**
     * Index all documents in the vault
     */
    async indexVault(): Promise<{
        success: boolean;
        indexed: number;
        totalFiles: number;
        errors?: Array<{ file: string; error: string }>;
    }> {
        const response = await this.fetch('/index-vault', {
            method: 'POST',
        });

        const data = await readJsonObject(response);
        const errors = asArray(data.errors)
            .map((error) => {
                const item = asObject(error);
                return {
                    file: asString(item.file),
                    error: asString(item.error),
                };
            })
            .filter((error) => error.file.length > 0 || error.error.length > 0);
        return {
            success: asBoolean(data.success, true),
            indexed: asNumber(data.indexed),
            totalFiles: asNumber(data.total_files),
            errors,
        };
    }

    /**
     * Delete a document from the index
     */
    async deleteDocument(path: string): Promise<{ success: boolean }> {
        const response = await this.fetch(`/document/${encodeURIComponent(path)}`, {
            method: 'DELETE',
        });

        const data = await readJsonObject(response);
        return { success: asBoolean(data.success, true) };
    }

    /**
     * Get index statistics
     */
    async getStats(): Promise<IndexStats> {
        const response = await this.fetch('/stats', { method: 'GET' });
        const data = await readJsonObject(response);

        const categoriesRaw = asObject(data.categories);
        const categories = Object.fromEntries(
            Object.entries(categoriesRaw).map(([key, value]) => [key, asNumber(value)])
        );

        return {
            totalDocuments: asNumber(data.total_documents),
            totalChunks: asNumber(data.total_chunks),
            categories,
            lastIndexed: asString(data.last_indexed) || undefined,
            vaultPath: asString(data.vault_path),
        };
    }

    /**
     * Reset the entire index
     */
    async resetIndex(): Promise<{ success: boolean; message: string }> {
        const response = await this.fetch('/reset', { method: 'POST' });
        const data = await readJsonObject(response);
        return {
            success: asBoolean(data.success, true),
            message: asString(data.message),
        };
    }

    /**
     * Compact old memories (placeholder)
     */
    async compactMemories(daysThreshold: number = 30): Promise<{
        success: boolean;
        message: string;
    }> {
        const response = await this.fetch('/compact', {
            method: 'POST',
            body: JSON.stringify({ days_threshold: daysThreshold }),
        });

        const data = await readJsonObject(response);
        return {
            success: asBoolean(data.success, true),
            message: asString(data.message),
        };
    }

    /**
     * Internal fetch wrapper with timeout and error handling
     */
    private async fetch(
        path: string,
        options: RequestInit = {}
    ): Promise<Response> {
        const url = `${this.baseUrl}${path}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
                signal: controller.signal,
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`RAG service error (${response.status}): ${error}`);
            }

            return response;
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(`RAG service request timeout after ${this.timeout}ms`);
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let ragBridgeInstance: RagBridge | null = null;

/**
 * Get the global RAG bridge instance
 */
export function getRagBridge(): RagBridge {
    if (!ragBridgeInstance) {
        ragBridgeInstance = new RagBridge();
    }
    return ragBridgeInstance;
}

/**
 * Initialize RAG bridge with custom configuration
 */
export function initRagBridge(baseUrl?: string, timeout?: number): RagBridge {
    ragBridgeInstance = new RagBridge(baseUrl, timeout);
    return ragBridgeInstance;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick search for relevant memories
 */
export async function searchMemory(
    query: string,
    topK: number = 5,
    options?: {
        filterCategory?: string;
        metadataFilters?: Record<string, string | number | boolean>;
    }
): Promise<SearchResult[]> {
    try {
        const bridge = getRagBridge();
        const response = await bridge.search({
            query,
            topK,
            filterCategory: options?.filterCategory,
            metadataFilters: options?.metadataFilters,
        });
        return response.results;
    } catch (error) {
        console.error('[RagBridge] Search failed:', error);
        return [];
    }
}

/**
 * Index a document to the vault
 */
export async function indexDocument(
    path: string,
    content: string,
    metadata?: Record<string, unknown>
): Promise<boolean> {
    try {
        const bridge = getRagBridge();
        const result = await bridge.indexDocument({ path, content, metadata });
        return result.success;
    } catch (error) {
        console.error('[RagBridge] Index failed:', error);
        return false;
    }
}

/**
 * Get formatted context for LLM prompts
 */
export async function getMemoryContext(
    query: string,
    options?: {
        topK?: number;
        maxChars?: number;
        filterCategory?: string;
        metadataFilters?: Record<string, string | number | boolean>;
    }
): Promise<string> {
    try {
        const bridge = getRagBridge();
        return await bridge.searchForContext(query, options);
    } catch (error) {
        console.error('[RagBridge] Context retrieval failed:', error);
        return '';
    }
}
