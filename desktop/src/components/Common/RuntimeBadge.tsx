/**
 * RuntimeBadge Component
 *
 * Displays a colored badge indicating the runtime environment
 * (Python, Node, Bun, Shell, etc.)
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

// ============================================================================
// Types
// ============================================================================

interface RuntimeBadgeProps {
    runtime: string;
    style?: React.CSSProperties;
}

// ============================================================================
// Runtime key mapping
// ============================================================================

const runtimeKeyMap: Record<string, string> = {
    python: 'python',
    node: 'nodejs',
    nodejs: 'nodejs',
    bun: 'bun',
    shell: 'shell',
    bash: 'shell',
    builtin: 'builtin',
};

// ============================================================================
// Component
// ============================================================================

export const RuntimeBadge: React.FC<RuntimeBadgeProps> = ({ runtime, style }) => {
    const { t } = useTranslation();
    const config = getRuntimeConfig(runtime);
    const normalized = (runtime || 'unknown').toLowerCase();
    const runtimeKey = runtimeKeyMap[normalized] || 'unknown';

    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                fontWeight: 600,
                padding: '3px 8px',
                borderRadius: '4px',
                background: config.color,
                color: '#fff',
                ...style,
            }}
        >
            <span style={{ fontSize: '12px' }}>{config.icon}</span>
            <span>{t(`runtime.${runtimeKey}`)}</span>
        </span>
    );
};

// ============================================================================
// Helpers
// ============================================================================

function getRuntimeConfig(runtime: string): { color: string; icon: string; label: string } {
    const normalized = (runtime || 'unknown').toLowerCase();

    switch (normalized) {
        case 'python':
            return { color: '#3776AB', icon: '🐍', label: 'Python' };
        case 'node':
        case 'nodejs':
            return { color: '#339933', icon: '📦', label: 'Node.js' };
        case 'bun':
            return { color: '#FBF0DF', icon: '🍞', label: 'Bun' };
        case 'shell':
        case 'bash':
            return { color: '#4EAA25', icon: '⚡', label: 'Shell' };
        case 'builtin':
            return { color: '#6366F1', icon: '⭐', label: 'Built-in' };
        default:
            return { color: '#808080', icon: '❓', label: 'Unknown' };
    }
}
