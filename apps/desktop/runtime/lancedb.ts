import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveActiveIndexPath } from "./obsidian";
import type { VaultChunk, VaultIndexState, VaultManifest } from "./obsidian";

export const LOCAL_EMBEDDING_MODEL = "ollama/nomic-embed-text";
export const LOCAL_EMBEDDING_DIMENSION = 384;
const TABLE_NAME = "document_chunks";
const DEFAULT_EMBEDDING_URL = "http://127.0.0.1:11434";

export type LocalEmbeddingOptions = { readonly mode?: "local" | "remote"; readonly baseUrl?: string; readonly model?: string; readonly apiKey?: string; readonly fetchImpl?: typeof fetch; readonly timeoutMs?: number };

async function loadLance() {
  try {
    const runtimeRoot = process.env.COWORKANY_LANCEDB_DIR;
    if (runtimeRoot) return await import(pathToFileURL(join(runtimeRoot, "node_modules", "@lancedb", "lancedb", "dist", "index.js")).href);
    const packageName = "@lancedb/lancedb";
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    return await dynamicImport(packageName);
  } catch (error) {
    throw new Error(`lancedb_runtime_unavailable:${error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180)}`, { cause: error });
  }
}

export type SemanticCitation = {
  readonly id: string;
  readonly documentPath: string;
  readonly heading?: string;
  readonly excerpt: string;
  readonly distance: number;
  readonly lineStart?: number;
  readonly lineEnd?: number;
};

/**
 * Deterministic, offline embedding used when no local embedding endpoint is configured.
 * It keeps RAG local and reproducible; an OpenAI-compatible local embedding endpoint can
 * replace this vector at the composition boundary without changing LanceDB storage.
 */
export function embedLocal(text: string, dimension = LOCAL_EMBEDDING_DIMENSION): number[] {
  const vector = new Float32Array(dimension);
  let offset = 0;
  for (const character of text.normalize("NFKC")) {
    let hash = 2166136261;
    for (const byte of new TextEncoder().encode(character)) hash = Math.imul(hash ^ byte, 16777619);
    const index = Math.abs(hash) % dimension;
    vector[index] += hash % 2 === 0 ? 1 : -1;
    offset += 1;
    if (offset > 4096) break;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return Array.from(vector, (value) => value / norm);
}

function isLoopbackUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch { return false; }
}

function isRemoteEmbeddingUrl(value: string) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

async function embedWithOllama(texts: readonly string[], options: LocalEmbeddingOptions) {
  const baseUrl = (options.baseUrl ?? process.env.COWORKANY_EMBEDDING_BASE_URL ?? DEFAULT_EMBEDDING_URL).replace(/\/$/u, "");
  if (!isLoopbackUrl(baseUrl)) throw new Error("embedding_endpoint_must_be_loopback");
  const model = options.model ?? process.env.COWORKANY_EMBEDDING_MODEL ?? "nomic-embed-text";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 3500);
  try {
    const response = await (options.fetchImpl ?? fetch)(`${baseUrl}/api/embed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, input: texts }), signal: controller.signal });
    if (!response.ok) throw new Error(`embedding_http_${response.status}`);
    const payload = await response.json() as { embeddings?: unknown };
    if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== texts.length || !payload.embeddings.every((item) => Array.isArray(item) && item.every((value) => typeof value === "number" && Number.isFinite(value)))) throw new Error("embedding_response_invalid");
    const vectors = payload.embeddings as number[][];
    const dimension = vectors[0]?.length ?? 0;
    if (!dimension || vectors.some((vector) => vector.length !== dimension)) throw new Error("embedding_dimension_invalid");
    return { model: `ollama/${model}`, dimension, vectors };
  } finally { clearTimeout(timer); }
}

async function embedWithRemote(texts: readonly string[], options: LocalEmbeddingOptions) {
  const baseUrl = options.baseUrl?.replace(/\/$/u, "") ?? "";
  const model = options.model?.trim() ?? "";
  const apiKey = options.apiKey?.trim() ?? "";
  if (!isRemoteEmbeddingUrl(baseUrl)) throw new Error("remote_embedding_endpoint_must_be_https");
  if (!model || !apiKey) throw new Error("remote_embedding_configuration_required");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(`${baseUrl}/embeddings`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, input: texts }), signal: controller.signal });
    if (!response.ok) throw new Error(`remote_embedding_http_${response.status}`);
    const payload = await response.json() as { data?: unknown };
    if (!Array.isArray(payload.data) || payload.data.length !== texts.length) throw new Error("remote_embedding_response_invalid");
    const vectors = payload.data.map((item) => typeof item === "object" && item !== null ? (item as { embedding?: unknown }).embedding : undefined);
    if (!vectors.every((item) => Array.isArray(item) && item.every((value) => typeof value === "number" && Number.isFinite(value)))) throw new Error("remote_embedding_response_invalid");
    const typedVectors = vectors as number[][];
    const dimension = typedVectors[0]?.length ?? 0;
    if (!dimension || typedVectors.some((vector) => vector.length !== dimension)) throw new Error("remote_embedding_dimension_invalid");
    return { model: `remote/${model}`, dimension, vectors: typedVectors };
  } finally { clearTimeout(timer); }
}

async function embedTexts(texts: readonly string[], options: LocalEmbeddingOptions = {}, fallbackDimension = LOCAL_EMBEDDING_DIMENSION) {
  if (!texts.length) return { model: options.mode === "remote" && options.model ? `remote/${options.model}` : options.model ? `ollama/${options.model}` : LOCAL_EMBEDDING_MODEL, dimension: fallbackDimension, vectors: [] as number[][], semantic: false };
  try {
    const result = options.mode === "remote" ? await embedWithRemote(texts, options) : await embedWithOllama(texts, options);
    return { ...result, semantic: true };
  } catch {
    return { model: options.model ? `local-hash-${fallbackDimension}-v1` : "local-hash-384-v1", dimension: fallbackDimension, vectors: texts.map((text) => embedLocal(text, fallbackDimension)), semantic: false };
  }
}

export async function buildLanceIndex(indexPath: string, manifest: VaultManifest, options: LocalEmbeddingOptions = {}): Promise<VaultIndexState> {
  const databasePath = join(indexPath, "lancedb");
  await mkdir(databasePath, { recursive: true });
  let embeddingInfo = { model: LOCAL_EMBEDDING_MODEL, dimension: LOCAL_EMBEDDING_DIMENSION, semantic: false };
  if (manifest.chunks.length > 0) {
    const { connect } = await loadLance();
    const database = await connect(databasePath);
    const embedded = await embedTexts(manifest.chunks.map((chunk) => `${chunk.heading ?? ""}\n${chunk.text}`), options);
    embeddingInfo = embedded;
    const rows = manifest.chunks.map((chunk, index) => ({
      id: chunk.id,
      document_path: chunk.documentPath,
      heading: chunk.heading ?? "",
      text: chunk.text,
      hash: chunk.hash,
      ...(chunk.lineStart === undefined ? {} : { line_start: chunk.lineStart, line_end: chunk.lineEnd }),
      vector: embedded.vectors[index],
    }));
    await database.createTable(TABLE_NAME, rows, { mode: "overwrite" });
    await database.close();
  }
  const state: VaultIndexState = { schemaVersion: 1, generation: manifest.generation, status: manifest.chunks.length > 0 && embeddingInfo.semantic ? "semantic_ready" : "lexical_ready", embeddingModel: embeddingInfo.model, embeddingDimension: embeddingInfo.dimension, updatedAt: new Date().toISOString() };
  const temporary = join(indexPath, "index-state.json.semantic.tmp");
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, join(indexPath, "index-state.json"));
  return state;
}

export async function searchLanceIndex(indexPath: string, query: string, limit = 8, options: LocalEmbeddingOptions = {}): Promise<SemanticCitation[]> {
  const { connect } = await loadLance();
  const database = await connect(join(resolveActiveIndexPath(indexPath), "lancedb"));
  try {
    const table = await database.openTable(TABLE_NAME);
    let dimension = LOCAL_EMBEDDING_DIMENSION;
    try { const state = JSON.parse(await readFile(join(resolveActiveIndexPath(indexPath), "index-state.json"), "utf8")) as { embeddingDimension?: number }; if (typeof state.embeddingDimension === "number" && state.embeddingDimension > 0) dimension = state.embeddingDimension; } catch { /* fallback */ }
    const embedded = await embedTexts([query], options, dimension);
    const rows = await table.query().nearestTo(embedded.vectors[0]).limit(Math.max(1, Math.min(20, limit))).toArray() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ id: String(row.id ?? ""), documentPath: String(row.document_path ?? ""), ...(String(row.heading ?? "") ? { heading: String(row.heading) } : {}), excerpt: String(row.text ?? "").slice(0, 900), distance: Number(row._distance ?? 0), ...(typeof row.line_start === "number" && typeof row.line_end === "number" ? { lineStart: row.line_start, lineEnd: row.line_end } : {}) }));
  } finally {
    await database.close();
  }
}

export async function readManifest(indexPath: string): Promise<VaultManifest> {
  return JSON.parse(await readFile(join(resolveActiveIndexPath(indexPath), "manifest.json"), "utf8")) as VaultManifest;
}

export async function readIndexState(indexPath: string): Promise<VaultIndexState> {
  return JSON.parse(await readFile(join(resolveActiveIndexPath(indexPath), "index-state.json"), "utf8")) as VaultIndexState;
}

export function chunkToSemanticRow(chunk: VaultChunk) {
  return { id: chunk.id, documentPath: chunk.documentPath, heading: chunk.heading, text: chunk.text, ...(chunk.lineStart === undefined ? {} : { lineStart: chunk.lineStart, lineEnd: chunk.lineEnd }), vector: embedLocal(`${chunk.heading ?? ""}\n${chunk.text}`) };
}
