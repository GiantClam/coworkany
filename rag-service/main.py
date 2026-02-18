"""
RAG Service - Memory Vault with ChromaDB

FastAPI service providing semantic search and indexing for the memory vault.
Integrates with coworkany sidecar for cross-session memory retrieval.
"""

import os
import json
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import chromadb
from chromadb.config import Settings as ChromaSettings

from embeddings import EmbeddingModel
from indexer import VaultIndexer, ParsedDocument

# ============================================================================
# Configuration
# ============================================================================

VAULT_PATH = os.environ.get("VAULT_PATH", os.path.expanduser("~/.coworkany/vault"))
CHROMA_PATH = os.environ.get("CHROMA_PATH", os.path.expanduser("~/.coworkany/chromadb"))
COLLECTION_NAME = os.environ.get("COLLECTION_NAME", "memory_vault")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
HOST = os.environ.get("RAG_HOST", "127.0.0.1")
PORT = int(os.environ.get("RAG_PORT", "8787"))

# ============================================================================
# Models
# ============================================================================

class IndexRequest(BaseModel):
    """Request to index a document"""
    path: str = Field(..., description="Relative path within vault")
    content: str = Field(..., description="Document content (markdown)")
    metadata: Optional[dict] = Field(default=None, description="Additional metadata")


class SearchRequest(BaseModel):
    """Request to search the vault"""
    query: str = Field(..., description="Search query")
    top_k: int = Field(default=5, ge=1, le=20, description="Number of results")
    filter_category: Optional[str] = Field(default=None, description="Filter by category")
    include_content: bool = Field(default=True, description="Include full content in results")


class SearchResult(BaseModel):
    """A single search result"""
    path: str
    title: str
    content: Optional[str]
    category: Optional[str]
    score: float
    metadata: dict


class SearchResponse(BaseModel):
    """Response from search endpoint"""
    results: List[SearchResult]
    query: str
    total_indexed: int


class CompactRequest(BaseModel):
    """Request to compact old memories"""
    days_threshold: int = Field(default=30, description="Compact memories older than N days")
    summary_model: Optional[str] = Field(default=None, description="LLM model for summarization")


class IndexStats(BaseModel):
    """Statistics about the index"""
    total_documents: int
    total_chunks: int
    categories: dict
    last_indexed: Optional[str]
    vault_path: str


class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    chromadb_status: str
    embedding_model: str
    vault_path: str
    indexed_documents: int


# ============================================================================
# Application State
# ============================================================================

class AppState:
    """Application state container"""
    def __init__(self):
        self.embedder: Optional[EmbeddingModel] = None
        self.chroma_client: Optional[chromadb.Client] = None
        self.collection: Optional[chromadb.Collection] = None
        self.indexer: Optional[VaultIndexer] = None
        self.last_indexed: Optional[str] = None


state = AppState()


# ============================================================================
# Lifecycle
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle manager"""
    # Startup
    print(f"[RAG] Starting service...")
    print(f"[RAG] Vault path: {VAULT_PATH}")
    print(f"[RAG] ChromaDB path: {CHROMA_PATH}")

    # Ensure directories exist
    Path(VAULT_PATH).mkdir(parents=True, exist_ok=True)
    Path(CHROMA_PATH).mkdir(parents=True, exist_ok=True)

    # Initialize embedding model
    print(f"[RAG] Loading embedding model: {EMBEDDING_MODEL}")
    state.embedder = EmbeddingModel(EMBEDDING_MODEL)

    # Initialize ChromaDB
    print(f"[RAG] Initializing ChromaDB...")
    state.chroma_client = chromadb.PersistentClient(
        path=CHROMA_PATH,
        settings=ChromaSettings(
            anonymized_telemetry=False,
            allow_reset=True,
        )
    )

    # Get or create collection
    state.collection = state.chroma_client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"}
    )

    # Initialize indexer
    state.indexer = VaultIndexer(state.embedder)

    print(f"[RAG] Service ready. Collection has {state.collection.count()} documents.")

    yield

    # Shutdown
    print("[RAG] Shutting down...")


# ============================================================================
# FastAPI App
# ============================================================================

app = FastAPI(
    title="Coworkany RAG Service",
    description="Memory vault semantic search and indexing",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# Endpoints
# ============================================================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    try:
        count = state.collection.count() if state.collection else 0
        return HealthResponse(
            status="healthy",
            chromadb_status="connected",
            embedding_model=EMBEDDING_MODEL,
            vault_path=VAULT_PATH,
            indexed_documents=count,
        )
    except Exception as e:
        return HealthResponse(
            status="unhealthy",
            chromadb_status=str(e),
            embedding_model=EMBEDDING_MODEL,
            vault_path=VAULT_PATH,
            indexed_documents=0,
        )


@app.post("/index")
async def index_document(request: IndexRequest, background_tasks: BackgroundTasks):
    """Index a single document"""
    if not state.collection or not state.indexer:
        raise HTTPException(status_code=503, detail="Service not initialized")

    try:
        # Parse document
        doc = state.indexer.parse_markdown(request.content, request.path)

        # Generate document ID from path
        doc_id = hashlib.md5(request.path.encode()).hexdigest()

        # Generate embedding
        embedding = state.embedder.encode(doc.content)

        # Build metadata
        metadata = {
            "path": request.path,
            "title": doc.title,
            "category": doc.category or "uncategorized",
            "indexed_at": datetime.utcnow().isoformat(),
            **(request.metadata or {}),
        }

        # Add tags to metadata
        if doc.tags:
            metadata["tags"] = ",".join(doc.tags)

        # Upsert to collection
        state.collection.upsert(
            ids=[doc_id],
            embeddings=[embedding.tolist()],
            metadatas=[metadata],
            documents=[doc.content],
        )

        state.last_indexed = datetime.utcnow().isoformat()

        return {
            "success": True,
            "path": request.path,
            "doc_id": doc_id,
            "title": doc.title,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search", response_model=SearchResponse)
async def search_vault(request: SearchRequest):
    """Search the memory vault"""
    if not state.collection or not state.embedder:
        raise HTTPException(status_code=503, detail="Service not initialized")

    try:
        # Generate query embedding
        query_embedding = state.embedder.encode(request.query)

        # Build where filter
        where_filter = None
        if request.filter_category:
            where_filter = {"category": request.filter_category}

        # Search
        results = state.collection.query(
            query_embeddings=[query_embedding.tolist()],
            n_results=request.top_k,
            where=where_filter,
            include=["documents", "metadatas", "distances"],
        )

        # Format results
        search_results: List[SearchResult] = []

        if results["ids"] and results["ids"][0]:
            for i, doc_id in enumerate(results["ids"][0]):
                metadata = results["metadatas"][0][i] if results["metadatas"] else {}
                distance = results["distances"][0][i] if results["distances"] else 1.0
                content = results["documents"][0][i] if results["documents"] else None

                # Convert distance to similarity score (cosine distance -> similarity)
                score = 1.0 - distance

                search_results.append(SearchResult(
                    path=metadata.get("path", ""),
                    title=metadata.get("title", "Untitled"),
                    content=content if request.include_content else None,
                    category=metadata.get("category"),
                    score=score,
                    metadata=metadata,
                ))

        return SearchResponse(
            results=search_results,
            query=request.query,
            total_indexed=state.collection.count(),
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/index-vault")
async def index_entire_vault(background_tasks: BackgroundTasks):
    """Index all markdown files in the vault directory"""
    if not state.collection or not state.indexer:
        raise HTTPException(status_code=503, detail="Service not initialized")

    vault_path = Path(VAULT_PATH)
    if not vault_path.exists():
        raise HTTPException(status_code=404, detail=f"Vault path not found: {VAULT_PATH}")

    # Find all markdown files
    md_files = list(vault_path.rglob("*.md"))

    indexed = 0
    errors = []

    for md_file in md_files:
        try:
            relative_path = str(md_file.relative_to(vault_path))
            content = md_file.read_text(encoding="utf-8")

            # Parse and index
            doc = state.indexer.parse_markdown(content, relative_path)
            doc_id = hashlib.md5(relative_path.encode()).hexdigest()
            embedding = state.embedder.encode(doc.content)

            metadata = {
                "path": relative_path,
                "title": doc.title,
                "category": doc.category or "uncategorized",
                "indexed_at": datetime.utcnow().isoformat(),
            }

            if doc.tags:
                metadata["tags"] = ",".join(doc.tags)

            state.collection.upsert(
                ids=[doc_id],
                embeddings=[embedding.tolist()],
                metadatas=[metadata],
                documents=[doc.content],
            )

            indexed += 1

        except Exception as e:
            errors.append({"file": str(md_file), "error": str(e)})

    state.last_indexed = datetime.utcnow().isoformat()

    return {
        "success": True,
        "indexed": indexed,
        "total_files": len(md_files),
        "errors": errors if errors else None,
    }


@app.delete("/document/{path:path}")
async def delete_document(path: str):
    """Delete a document from the index"""
    if not state.collection:
        raise HTTPException(status_code=503, detail="Service not initialized")

    doc_id = hashlib.md5(path.encode()).hexdigest()

    try:
        state.collection.delete(ids=[doc_id])
        return {"success": True, "path": path, "doc_id": doc_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats", response_model=IndexStats)
async def get_stats():
    """Get index statistics"""
    if not state.collection:
        raise HTTPException(status_code=503, detail="Service not initialized")

    try:
        # Get all metadata to count categories
        all_docs = state.collection.get(include=["metadatas"])

        categories = {}
        for metadata in all_docs.get("metadatas", []):
            cat = metadata.get("category", "uncategorized")
            categories[cat] = categories.get(cat, 0) + 1

        return IndexStats(
            total_documents=state.collection.count(),
            total_chunks=state.collection.count(),  # 1:1 for now
            categories=categories,
            last_indexed=state.last_indexed,
            vault_path=VAULT_PATH,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/compact")
async def compact_memories(request: CompactRequest):
    """Compact old memories (placeholder for future implementation)"""
    # TODO: Implement memory compaction with LLM summarization
    return {
        "success": False,
        "message": "Memory compaction not yet implemented",
        "days_threshold": request.days_threshold,
    }


@app.post("/reset")
async def reset_index():
    """Reset the entire index (use with caution)"""
    if not state.chroma_client:
        raise HTTPException(status_code=503, detail="Service not initialized")

    try:
        state.chroma_client.delete_collection(COLLECTION_NAME)
        state.collection = state.chroma_client.create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"}
        )
        state.last_indexed = None

        return {"success": True, "message": "Index reset successfully"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
