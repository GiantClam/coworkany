/**
 * Message Content Processor
 *
 * Provides text processing utilities for chat messages with caching.
 */

import type { MessageProcessingOptions } from '../../types';

// ============================================================================
// Simple LRU Cache Implementation
// ============================================================================

class LRUCache<K, V> {
    private maxSize: number;
    private cache: Map<K, V>;

    constructor(maxSize: number = 500) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
            return value;
        }
        return undefined;
    }

    set(key: K, value: V): void {
        // Delete if exists (will re-add at end)
        this.cache.delete(key);

        // Remove oldest if at capacity
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, value);
    }

    has(key: K): boolean {
        return this.cache.has(key);
    }

    clear(): void {
        this.cache.clear();
    }

    get size(): number {
        return this.cache.size;
    }
}

// ============================================================================
// Processing Cache
// ============================================================================

const processCache = new LRUCache<string, string>(500);

// ============================================================================
// Text Processing Functions
// ============================================================================

/**
 * Remove emojis from text
 * Uses a broad regex for emoji characters
 */
function removeEmojis(text: string): string {
    return text.replace(
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}]/gu,
        ''
    );
}

/**
 * Compact markdown formatting by removing extra spaces
 * - Bold: ** Text ** -> **Text**
 * - Italic: * Text * -> *Text*
 * - Inline Code: ` Code ` -> `Code`
 */
function compactMarkdown(text: string): string {
    let result = text;

    // Bold: ** Text ** -> **Text**
    result = result.replace(/\*\* +(.+?) +\*\*/g, '**$1**');

    // Italic: * Text * -> *Text* (Handle carefully to not break lists)
    result = result.replace(/(?<!\*)\* +(.+?) +\*(?!\*)/g, '*$1*');

    // Inline Code: ` Code ` -> `Code`
    result = result.replace(/` +(.+?) +`/g, '`$1`');

    return result;
}

/**
 * Clean excessive newlines
 * Replace 3+ newlines with 2 (one empty line)
 */
function cleanNewlines(text: string): string {
    return text.replace(/[\r\n]{3,}/g, '\n\n');
}

// ============================================================================
// Main Processing Function
// ============================================================================

/**
 * Process message content with optional caching
 *
 * @param text - The input text to process
 * @param options - Processing options
 * @param useCache - Whether to use cache (default: true)
 * @returns Processed text
 */
export function processMessageContent(
    text: string,
    options: MessageProcessingOptions = {},
    useCache: boolean = true
): string {
    // Default options
    const {
        removeEmojis: shouldRemoveEmojis = true,
        compactMarkdown: shouldCompactMarkdown = true,
        cleanNewlines: shouldCleanNewlines = true,
    } = options;

    // Generate cache key
    const cacheKey = `${text}:${shouldRemoveEmojis}:${shouldCompactMarkdown}:${shouldCleanNewlines}`;

    // Check cache
    if (useCache && processCache.has(cacheKey)) {
        return processCache.get(cacheKey)!;
    }

    // Process text
    let processed = text;

    if (shouldRemoveEmojis) {
        processed = removeEmojis(processed);
    }

    if (shouldCompactMarkdown) {
        processed = compactMarkdown(processed);
    }

    if (shouldCleanNewlines) {
        processed = cleanNewlines(processed);
    }

    processed = processed.trim();

    // Store in cache
    if (useCache) {
        processCache.set(cacheKey, processed);
    }

    return processed;
}

// ============================================================================
// Individual Processing Functions (exported for testing)
// ============================================================================

export { removeEmojis, compactMarkdown, cleanNewlines };

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Clear the processing cache
 */
export function clearProcessingCache(): void {
    processCache.clear();
}

/**
 * Get current cache size
 */
export function getProcessingCacheSize(): number {
    return processCache.size;
}

/**
 * Check if a value is in cache
 */
export function isInProcessingCache(
    text: string,
    options: MessageProcessingOptions = {}
): boolean {
    const {
        removeEmojis: shouldRemoveEmojis = true,
        compactMarkdown: shouldCompactMarkdown = true,
        cleanNewlines: shouldCleanNewlines = true,
    } = options;

    const cacheKey = `${text}:${shouldRemoveEmojis}:${shouldCompactMarkdown}:${shouldCleanNewlines}`;
    return processCache.has(cacheKey);
}
