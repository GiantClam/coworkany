/**
 * GitHub URL Validation Hook
 *
 * Provides debounced validation for GitHub URLs
 */

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

// ============================================================================
// Types
// ============================================================================

interface ValidationResult {
    valid: boolean;
    reason?: string;
    preview?: {
        name: string;
        description: string;
        runtime?: string;
        path?: string;
        tools?: string[];
    };
}

interface ValidationInput {
    url: string;
    type: 'skill' | 'mcp';
}

// ============================================================================
// Hook
// ============================================================================

export function useGitHubValidation(url: string, type: 'skill' | 'mcp') {
    const [validating, setValidating] = useState(false);
    const [result, setResult] = useState<ValidationResult | null>(null);

    useEffect(() => {
        // Only validate if URL contains github.com or starts with github:
        if (!url || (!url.includes('github.com') && !url.startsWith('github:'))) {
            setResult(null);
            setValidating(false);
            return;
        }

        setValidating(true);

        // Debounce validation by 500ms
        const timer = setTimeout(async () => {
            try {
                const validation = await invoke<ValidationResult>('validate_github_url', {
                    input: { url, type } as ValidationInput,
                });
                setResult(validation);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                setResult({
                    valid: false,
                    reason: message,
                });
            } finally {
                setValidating(false);
            }
        }, 500);

        return () => {
            clearTimeout(timer);
        };
    }, [url, type]);

    return { validating, result };
}
