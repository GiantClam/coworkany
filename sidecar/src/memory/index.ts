/**
 * Memory Module
 *
 * Provides cross-session memory capabilities through the RAG service
 * and markdown vault management.
 */

// RAG Bridge
export {
    RagBridge,
    getRagBridge,
    initRagBridge,
    searchMemory,
    indexDocument,
    getMemoryContext,
} from './ragBridge';

export type {
    IndexRequest,
    SearchRequest,
    SearchResult,
    SearchResponse,
    IndexStats,
    HealthStatus,
} from './ragBridge';

// Vault Manager
export {
    VaultManager,
    getVaultManager,
    initVaultManager,
} from './vaultManager';

export type {
    VaultConfig,
    VaultDocument,
    VaultCategory,
} from './vaultManager';
