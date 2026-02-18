/**
 * Token Usage Panel
 *
 * Compact display of input/output tokens and estimated cost for the current session.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useActiveSession } from '../../stores/useTaskEventStore';

export const TokenUsagePanel: React.FC = () => {
    const { t } = useTranslation();
    const session = useActiveSession();

    const usage = session?.tokenUsage;
    if (!usage || (usage.inputTokens === 0 && usage.outputTokens === 0)) {
        return null;
    }

    const formatNumber = (n: number): string => {
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
        return n.toString();
    };

    const formatCost = (cost: number): string => {
        if (cost < 0.01) return cost.toFixed(4);
        return cost.toFixed(2);
    };

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                color: 'var(--text-secondary)',
                backgroundColor: 'var(--bg-element)',
                fontFamily: 'var(--font-mono)',
            }}
            title={`Input: ${usage.inputTokens.toLocaleString()} tokens, Output: ${usage.outputTokens.toLocaleString()} tokens`}
        >
            <span style={{ opacity: 0.7 }}>
                {t('chat.inputTokens', { value: formatNumber(usage.inputTokens) })}
            </span>
            <span style={{ opacity: 0.4 }}>|</span>
            <span style={{ opacity: 0.7 }}>
                {t('chat.outputTokens', { value: formatNumber(usage.outputTokens) })}
            </span>
            {usage.estimatedCost != null && usage.estimatedCost > 0 && (
                <>
                    <span style={{ opacity: 0.4 }}>|</span>
                    <span style={{ opacity: 0.7 }}>
                        {t('chat.estimatedCost', { cost: formatCost(usage.estimatedCost) })}
                    </span>
                </>
            )}
        </div>
    );
};
