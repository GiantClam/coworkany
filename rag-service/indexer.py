"""
Vault Indexer

Parses markdown files and prepares them for indexing in ChromaDB.
Handles YAML frontmatter extraction and content chunking.
"""

import re
import yaml
from dataclasses import dataclass
from typing import Optional, List, Dict, Any
from pathlib import Path

from embeddings import EmbeddingModel


@dataclass
class ParsedDocument:
    """Represents a parsed markdown document"""
    path: str
    title: str
    content: str
    category: Optional[str]
    tags: List[str]
    metadata: Dict[str, Any]
    chunks: Optional[List[str]] = None


class VaultIndexer:
    """Indexes markdown vault documents for semantic search"""

    # Frontmatter pattern
    FRONTMATTER_PATTERN = re.compile(r'^---\n(.*?)\n---\n?', re.DOTALL)

    # Heading pattern for title extraction
    HEADING_PATTERN = re.compile(r'^#\s+(.+)$', re.MULTILINE)

    def __init__(
        self,
        embedder: EmbeddingModel,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
    ):
        """
        Initialize the indexer.

        Args:
            embedder: Embedding model for vector generation
            chunk_size: Maximum characters per chunk
            chunk_overlap: Overlap between chunks
        """
        self.embedder = embedder
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def parse_markdown(self, content: str, path: str) -> ParsedDocument:
        """
        Parse a markdown document and extract metadata.

        Args:
            content: Raw markdown content
            path: File path (relative to vault root)

        Returns:
            ParsedDocument with extracted metadata and content
        """
        metadata = {}
        body = content

        # Extract YAML frontmatter
        frontmatter_match = self.FRONTMATTER_PATTERN.match(content)
        if frontmatter_match:
            try:
                frontmatter_text = frontmatter_match.group(1)
                metadata = yaml.safe_load(frontmatter_text) or {}
                body = content[frontmatter_match.end():]
            except yaml.YAMLError:
                pass  # Keep original content if YAML parsing fails

        # Extract title from frontmatter or first heading
        title = metadata.get("title")
        if not title:
            heading_match = self.HEADING_PATTERN.search(body)
            if heading_match:
                title = heading_match.group(1).strip()
            else:
                # Use filename as title
                title = Path(path).stem.replace("-", " ").replace("_", " ").title()

        # Extract category from path or frontmatter
        category = metadata.get("category")
        if not category:
            path_parts = Path(path).parts
            if len(path_parts) > 1:
                category = path_parts[0]

        # Extract tags
        tags = metadata.get("tags", [])
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",")]

        # Clean content (remove frontmatter markers if still present)
        clean_content = body.strip()

        return ParsedDocument(
            path=path,
            title=title,
            content=clean_content,
            category=category,
            tags=tags,
            metadata=metadata,
        )

    def chunk_document(self, doc: ParsedDocument) -> List[str]:
        """
        Split a document into chunks for embedding.

        Args:
            doc: Parsed document

        Returns:
            List of text chunks
        """
        content = doc.content

        # If content is short enough, return as single chunk
        if len(content) <= self.chunk_size:
            return [content]

        chunks = []
        # Split by paragraphs first
        paragraphs = content.split("\n\n")

        current_chunk = ""
        for para in paragraphs:
            para = para.strip()
            if not para:
                continue

            # If adding this paragraph exceeds chunk size
            if len(current_chunk) + len(para) + 2 > self.chunk_size:
                if current_chunk:
                    chunks.append(current_chunk.strip())

                # If paragraph itself is too long, split by sentences
                if len(para) > self.chunk_size:
                    sentences = self._split_sentences(para)
                    for sentence in sentences:
                        if len(current_chunk) + len(sentence) + 1 > self.chunk_size:
                            if current_chunk:
                                chunks.append(current_chunk.strip())
                            current_chunk = sentence
                        else:
                            current_chunk = (current_chunk + " " + sentence).strip()
                else:
                    current_chunk = para
            else:
                current_chunk = (current_chunk + "\n\n" + para).strip()

        # Add remaining content
        if current_chunk:
            chunks.append(current_chunk.strip())

        return chunks

    def _split_sentences(self, text: str) -> List[str]:
        """Split text into sentences"""
        # Simple sentence splitting
        sentences = re.split(r'(?<=[.!?])\s+', text)
        return [s.strip() for s in sentences if s.strip()]

    def extract_keywords(self, doc: ParsedDocument, top_k: int = 10) -> List[str]:
        """
        Extract keywords from a document.

        Args:
            doc: Parsed document
            top_k: Number of keywords to extract

        Returns:
            List of keywords
        """
        # Simple keyword extraction based on word frequency
        # Exclude common stop words
        stop_words = {
            "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
            "of", "with", "by", "from", "up", "about", "into", "through", "during",
            "before", "after", "above", "below", "between", "under", "again",
            "further", "then", "once", "here", "there", "when", "where", "why",
            "how", "all", "each", "few", "more", "most", "other", "some", "such",
            "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very",
            "s", "t", "can", "will", "just", "don", "should", "now", "d", "ll",
            "m", "o", "re", "ve", "y", "ain", "aren", "couldn", "didn", "doesn",
            "hadn", "hasn", "haven", "isn", "ma", "mightn", "mustn", "needn",
            "shan", "shouldn", "wasn", "weren", "won", "wouldn", "is", "are",
            "was", "were", "be", "been", "being", "have", "has", "had", "having",
            "do", "does", "did", "doing", "would", "could", "might", "must",
            "shall", "this", "that", "these", "those", "i", "me", "my", "myself",
            "we", "our", "ours", "ourselves", "you", "your", "yours", "yourself",
            "he", "him", "his", "himself", "she", "her", "hers", "herself", "it",
            "its", "itself", "they", "them", "their", "theirs", "themselves",
            "what", "which", "who", "whom", "as", "if", "because", "while",
        }

        # Tokenize
        words = re.findall(r'\b[a-zA-Z]{3,}\b', doc.content.lower())

        # Count frequencies
        word_freq = {}
        for word in words:
            if word not in stop_words:
                word_freq[word] = word_freq.get(word, 0) + 1

        # Sort by frequency and return top-k
        sorted_words = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)
        return [word for word, _ in sorted_words[:top_k]]

    def create_search_text(self, doc: ParsedDocument) -> str:
        """
        Create optimized text for embedding and search.

        Args:
            doc: Parsed document

        Returns:
            Text optimized for semantic search
        """
        parts = []

        # Include title (weighted)
        if doc.title:
            parts.append(f"Title: {doc.title}")

        # Include category
        if doc.category:
            parts.append(f"Category: {doc.category}")

        # Include tags
        if doc.tags:
            parts.append(f"Tags: {', '.join(doc.tags)}")

        # Include content
        parts.append(doc.content)

        return "\n\n".join(parts)
