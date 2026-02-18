/**
 * Ollama Service Detection & Model Discovery
 *
 * Provides utilities for detecting a running Ollama instance
 * and listing available models.
 */

export interface OllamaModel {
    name: string;
    size: number;
    digest: string;
    modified_at: string;
}

/**
 * Check if Ollama service is running at the given base URL
 */
export async function isOllamaRunning(baseUrl = 'http://localhost:11434'): Promise<boolean> {
    try {
        const res = await fetch(`${baseUrl}/api/tags`, {
            signal: AbortSignal.timeout(3000),
        });
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * Detect available Ollama models
 * Returns an array of model names, or empty array if Ollama is not running
 */
export async function detectOllamaModels(baseUrl = 'http://localhost:11434'): Promise<string[]> {
    try {
        const res = await fetch(`${baseUrl}/api/tags`, {
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return [];
        const data = await res.json() as { models?: OllamaModel[] };
        return data.models?.map((m) => m.name) ?? [];
    } catch {
        return [];
    }
}

/**
 * Get detailed model information from Ollama
 */
export async function getOllamaModelInfo(
    modelName: string,
    baseUrl = 'http://localhost:11434'
): Promise<OllamaModel | null> {
    try {
        const res = await fetch(`${baseUrl}/api/tags`, {
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return null;
        const data = await res.json() as { models?: OllamaModel[] };
        return data.models?.find((m) => m.name === modelName) ?? null;
    } catch {
        return null;
    }
}
