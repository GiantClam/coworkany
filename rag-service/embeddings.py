"""
Embedding Model Wrapper

Provides a unified interface for text embeddings using sentence-transformers.
"""

import numpy as np
from typing import List, Union
from sentence_transformers import SentenceTransformer


class EmbeddingModel:
    """Wrapper for sentence-transformers embedding models"""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        """
        Initialize the embedding model.

        Args:
            model_name: Name of the sentence-transformers model to use.
                       Popular options:
                       - all-MiniLM-L6-v2 (fast, good quality, 384 dims)
                       - all-mpnet-base-v2 (better quality, 768 dims)
                       - paraphrase-multilingual-MiniLM-L12-v2 (multilingual)
        """
        self.model_name = model_name
        self.model = SentenceTransformer(model_name)
        self.dimension = self.model.get_sentence_embedding_dimension()

    def encode(
        self,
        text: Union[str, List[str]],
        normalize: bool = True,
        show_progress: bool = False,
    ) -> np.ndarray:
        """
        Encode text(s) into embedding vector(s).

        Args:
            text: Single text or list of texts to encode
            normalize: Whether to L2-normalize the embeddings
            show_progress: Show progress bar for batch encoding

        Returns:
            numpy array of shape (embedding_dim,) for single text
            or (n_texts, embedding_dim) for list of texts
        """
        embeddings = self.model.encode(
            text,
            normalize_embeddings=normalize,
            show_progress_bar=show_progress,
        )

        return embeddings

    def encode_batch(
        self,
        texts: List[str],
        batch_size: int = 32,
        normalize: bool = True,
        show_progress: bool = True,
    ) -> np.ndarray:
        """
        Encode a large batch of texts efficiently.

        Args:
            texts: List of texts to encode
            batch_size: Number of texts to process at once
            normalize: Whether to L2-normalize the embeddings
            show_progress: Show progress bar

        Returns:
            numpy array of shape (n_texts, embedding_dim)
        """
        embeddings = self.model.encode(
            texts,
            batch_size=batch_size,
            normalize_embeddings=normalize,
            show_progress_bar=show_progress,
        )

        return embeddings

    def similarity(self, embedding1: np.ndarray, embedding2: np.ndarray) -> float:
        """
        Compute cosine similarity between two embeddings.

        Args:
            embedding1: First embedding vector
            embedding2: Second embedding vector

        Returns:
            Cosine similarity score between -1 and 1
        """
        # Ensure 1D arrays
        e1 = embedding1.flatten()
        e2 = embedding2.flatten()

        # Compute cosine similarity
        dot_product = np.dot(e1, e2)
        norm1 = np.linalg.norm(e1)
        norm2 = np.linalg.norm(e2)

        if norm1 == 0 or norm2 == 0:
            return 0.0

        return dot_product / (norm1 * norm2)

    def similarity_matrix(self, embeddings: np.ndarray) -> np.ndarray:
        """
        Compute pairwise cosine similarity matrix.

        Args:
            embeddings: Array of shape (n, embedding_dim)

        Returns:
            Similarity matrix of shape (n, n)
        """
        # Normalize embeddings
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        normalized = embeddings / np.maximum(norms, 1e-9)

        # Compute similarity matrix
        return np.dot(normalized, normalized.T)

    @property
    def embedding_dimension(self) -> int:
        """Get the dimension of embedding vectors"""
        return self.dimension
