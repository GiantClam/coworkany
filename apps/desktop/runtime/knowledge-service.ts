import { createRpcReader, writeRpcResponse } from "./rpc";
import { searchVaultIndex } from "./rag";
import { activateIndexGeneration, createIndexGenerationPath, indexObsidianVault, ObsidianVaultWatcher, writeObsidianNote, type VaultIndexState } from "./obsidian";

type EmbeddingConfig = { readonly mode?: "local" | "remote"; readonly baseUrl?: string; readonly model?: string; readonly apiKey?: string };
type KnowledgeServiceCommand = { readonly version: 1; readonly requestId: string; readonly type: "service_request"; readonly method: "knowledge.index" | "knowledge.search" | "knowledge.write"; readonly payload?: Record<string, unknown> };

const vaultWatchers = new Map<string, ObsidianVaultWatcher>();

async function rebuildVaultIndex(vaultPath: string, indexPath: string, embedding: EmbeddingConfig) {
  const generationPath = createIndexGenerationPath(indexPath);
  const manifest = await indexObsidianVault(vaultPath, indexPath, 0, generationPath);
  let state: VaultIndexState = { schemaVersion: 1, generation: manifest.generation, status: "lexical_ready", embeddingModel: "keyword", embeddingDimension: 0, updatedAt: manifest.updatedAt };
  if (typeof __COWORKANY_SEMANTIC_RAG__ === "undefined" || __COWORKANY_SEMANTIC_RAG__) {
    try {
      state = await (await import("./lancedb")).buildLanceIndex(generationPath, manifest, embedding);
    } catch {
      state = { ...state, embeddingModel: "lexical-fallback", updatedAt: new Date().toISOString() };
    }
  }
  await activateIndexGeneration(indexPath, generationPath, manifest.generation);
  return { manifest, state };
}

function watchVault(vaultPath: string, indexPath: string, embedding: EmbeddingConfig) {
  vaultWatchers.get(indexPath)?.stop();
  const watcher = new ObsidianVaultWatcher(vaultPath, () => {
    void rebuildVaultIndex(vaultPath, indexPath, embedding).catch(() => undefined);
  }).start();
  vaultWatchers.set(indexPath, watcher);
}

function embeddingConfig(payload: Record<string, unknown>): EmbeddingConfig {
  return payload.embedding && typeof payload.embedding === "object" ? payload.embedding as EmbeddingConfig : {
    mode: payload.embeddingMode === "remote" ? "remote" : "local",
    baseUrl: typeof payload.embeddingBaseUrl === "string" ? payload.embeddingBaseUrl : undefined,
    model: typeof payload.embeddingModel === "string" ? payload.embeddingModel : undefined,
    apiKey: typeof payload.embeddingApiKey === "string" ? payload.embeddingApiKey : undefined,
  };
}

export async function handleKnowledgeRequest(command: KnowledgeServiceCommand): Promise<Record<string, unknown>> {
  const payload = command.payload ?? {};
  if (command.method === "knowledge.index") {
    const vaultPath = typeof payload.vaultPath === "string" ? payload.vaultPath : "";
    const indexPath = typeof payload.indexPath === "string" ? payload.indexPath : "";
    if (!vaultPath || !indexPath) throw new Error("invalid_vault_index");
    const embedding = embeddingConfig(payload);
    const { manifest, state } = await rebuildVaultIndex(vaultPath, indexPath, embedding);
    try {
      watchVault(vaultPath, indexPath, embedding);
      return { generation: manifest.generation, documents: manifest.documents.length, chunks: manifest.chunks.length, indexPath, semantic: state.status === "semantic_ready", embeddingModel: state.embeddingModel, embeddingDimension: state.embeddingDimension, watcher: "active" };
    } catch (error) {
      return { generation: manifest.generation, documents: manifest.documents.length, chunks: manifest.chunks.length, indexPath, semantic: false, embeddingModel: "lexical-fallback", warning: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180) };
    }
  }
  if (command.method === "knowledge.search") {
    const indexPath = typeof payload.indexPath === "string" ? payload.indexPath : "";
    const query = typeof payload.query === "string" ? payload.query.trim() : "";
    if (!indexPath || !query) throw new Error("invalid_knowledge_search");
    const results = await searchVaultIndex(indexPath, query, Number(payload.limit ?? 8), embeddingConfig(payload));
    return { indexPath, query, results };
  }
  const vaultPath = typeof payload.vaultPath === "string" ? payload.vaultPath : "";
  if (!vaultPath) throw new Error("knowledge_vault_required");
  if (command.method !== "knowledge.write") throw new Error("unsupported_knowledge_service");
  const result = await writeObsidianNote({
    vaultPath,
    targetPath: typeof payload.targetPath === "string" ? payload.targetPath : undefined,
    content: typeof payload.content === "string" ? payload.content : "",
    baseHash: typeof payload.baseHash === "string" ? payload.baseHash : undefined,
  });
  return result as unknown as Record<string, unknown>;
}

export function startKnowledgeService() {
  createRpcReader(process.stdin, (raw) => {
    const command = raw as unknown as KnowledgeServiceCommand;
    if (command.version !== 1 || command.type !== "service_request" || !command.requestId) return;
    void handleKnowledgeRequest(command)
      .then((data) => writeRpcResponse(process.stdout, { version: 1, requestId: command.requestId, ok: true, data }))
      .catch((error) => writeRpcResponse(process.stdout, { version: 1, requestId: command.requestId, ok: false, error: { code: "knowledge_service_failed", message: error instanceof Error ? error.message : String(error), retryable: true } }));
  }, (error) => process.stderr.write(`[knowledge-service] ${error.message}\n`));
  process.once("exit", () => { for (const watcher of vaultWatchers.values()) watcher.stop(); vaultWatchers.clear(); });
}

startKnowledgeService();
