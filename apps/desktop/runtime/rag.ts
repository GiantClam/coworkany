import { HybridKnowledgeRetriever, type KnowledgeCitation, type KnowledgeChunk } from "@coworkany/knowledge-runtime";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveActiveIndexPath, type VaultManifest } from "./obsidian";
import type { LocalEmbeddingOptions } from "./lancedb";

export async function searchVaultIndex(indexPath: string, query: string, limit = 8, embedding: LocalEmbeddingOptions = {}): Promise<KnowledgeCitation[]> {
  const boundedLimit = Math.max(1, Math.min(20, limit));
  const manifest = JSON.parse(await readFile(join(resolveActiveIndexPath(indexPath), "manifest.json"), "utf8")) as VaultManifest;
  const lexical = await new HybridKnowledgeRetriever().retrieve(manifest.chunks as KnowledgeChunk[], query, boundedLimit * 2);
  if (typeof __COWORKANY_SEMANTIC_RAG__ === "undefined" || __COWORKANY_SEMANTIC_RAG__) {
    try {
      const { readIndexState, searchLanceIndex } = await import("./lancedb");
      if ((await readIndexState(indexPath)).status !== "semantic_ready") return lexical.slice(0, boundedLimit);
      const semantic = await searchLanceIndex(indexPath, query, boundedLimit, embedding);
      if (semantic.length > 0) return mergeHybridCitations(lexical, semantic, boundedLimit);
    } catch {
      // 语义索引重建或不可用时，仍可用关键词检索。
    }
  }
  return lexical.slice(0, boundedLimit);
}

/** Merge LanceDB nearest-neighbour results with lexical matches so semantic indexing never hides exact text hits. */
export function mergeHybridCitations(lexical: readonly KnowledgeCitation[], semantic: ReadonlyArray<{ readonly id: string; readonly documentPath: string; readonly heading?: string; readonly excerpt: string; readonly distance: number; readonly lineStart?: number; readonly lineEnd?: number }>, limit: number): KnowledgeCitation[] {
  const lexicalById = new Map(lexical.map((item) => [item.chunkId, item]));
  const maxLexical = Math.max(1, ...lexical.map((item) => item.score));
  const merged = new Map<string, KnowledgeCitation>();
  lexical.forEach((item) => merged.set(item.chunkId, { ...item, score: (item.score / maxLexical) * 0.4 }));
  semantic.forEach((item) => {
    const vectorScore = Math.max(0, 1 / (1 + item.distance));
    const lexicalMatch = lexicalById.get(item.id);
    const lexicalScore = lexicalMatch ? (lexicalMatch.score / maxLexical) * 0.4 : 0;
    merged.set(item.id, {
      chunkId: item.id,
      documentPath: item.documentPath,
      ...(item.heading ? { heading: item.heading } : {}),
      excerpt: item.excerpt,
      score: vectorScore * 0.6 + lexicalScore,
      ...(item.lineStart === undefined ? {} : { lineStart: item.lineStart, lineEnd: item.lineEnd }),
    });
  });
  return [...merged.values()].sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId)).slice(0, Math.max(1, Math.min(20, limit)));
}
