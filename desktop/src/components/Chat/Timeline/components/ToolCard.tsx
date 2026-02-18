/**
 * ToolCard Component
 *
 * Displays tool call item with expandable details
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import styles from '../Timeline.module.css';
import type { ToolCallItem } from '../../../../types';

interface ToolCardProps {
    item: ToolCallItem;
}

const ToolCardComponent: React.FC<ToolCardProps> = ({ item }) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);

    // Detect "soft" errors in text results (e.g. "## ❌ Search Failed")
    const isSoftError = useMemo(() => {
        if (item.status === 'failed') return true;
        if (typeof item.result === 'string') {
            return item.result.includes('❌') ||
                item.result.includes('Search Failed') ||
                item.result.startsWith('Error:');
        }
        return false;
    }, [item.status, item.result]);

    const displayStatus = isSoftError ? 'failed' : item.status;

    // Generate a preview string
    const preview = useMemo(() => {
        if (!item.result) return '';
        const str = typeof item.result === 'string' ? item.result : JSON.stringify(item.result);
        // Clean up markdown headers for preview
        const cleaned = str.replace(/[#*`]/g, '').replace(/\s+/g, ' ').trim();
        return cleaned.length > 60 ? cleaned.slice(0, 60) + '...' : cleaned;
    }, [item.result]);

    return (
        <div className={styles.timelineItem}>
            <div className={styles.toolCard} data-status={displayStatus}>
                <div className={styles.toolHeader} onClick={() => setExpanded(!expanded)}>
                    <div className={styles.toolInfo}>
                        <span className={styles.toolIcon}>🔧</span>
                        <strong className={styles.toolName}>{item.toolName}</strong>
                        {!expanded && preview && (
                            <span className={styles.toolPreview}>
                                {preview}
                            </span>
                        )}
                    </div>
                    <div className={styles.toolStatus}>
                        <span className={styles.statusDot} data-status={displayStatus} />
                        <span>{displayStatus.toUpperCase()}</span>
                    </div>
                </div>
                {expanded && (
                    <div className={styles.toolBody}>
                        {item.args && (
                            <div className={styles.inputSection}>
                                <div className={styles.sectionLabel}>{t('chat.input')}</div>
                                <pre className={styles.codeBlock}>
                                    {JSON.stringify(item.args, null, 2)}
                                </pre>
                            </div>
                        )}
                        {item.result && (
                            <div className={styles.outputSection}>
                                <div className={styles.sectionLabel}>{t('chat.output')}</div>
                                <div className={styles.markdownBody}>
                                    {typeof item.result === 'string' ? (
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                                code(props) {
                                                    const { children, className, node, ref, ...rest } = props as any;
                                                    const match = /language-(\w+)/.exec(className || '');
                                                    return match ? (
                                                        <SyntaxHighlighter
                                                            {...rest}
                                                            PreTag="div"
                                                            children={String(children).replace(/\n$/, '')}
                                                            language={match[1]}
                                                            style={oneLight}
                                                            customStyle={{ margin: 0, borderRadius: 'var(--radius-md)', fontSize: '12px', border: '1px solid var(--border-subtle)' }}
                                                        />
                                                    ) : (
                                                        <code {...props} className={className}>
                                                            {children}
                                                        </code>
                                                    );
                                                }
                                            }}
                                        >
                                            {item.result}
                                        </ReactMarkdown>
                                    ) : (
                                        <pre className={styles.codeBlock}>
                                            {JSON.stringify(item.result, null, 2)}
                                        </pre>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// Custom comparison function to prevent unnecessary re-renders
// Only re-render when the tool call data actually changes
const arePropsEqual = (prevProps: ToolCardProps, nextProps: ToolCardProps): boolean => {
    return (
        prevProps.item.id === nextProps.item.id &&
        prevProps.item.toolName === nextProps.item.toolName &&
        prevProps.item.status === nextProps.item.status &&
        prevProps.item.result === nextProps.item.result &&
        JSON.stringify(prevProps.item.args) === JSON.stringify(nextProps.item.args)
    );
};

export const ToolCard = React.memo(ToolCardComponent, arePropsEqual);

ToolCard.displayName = 'ToolCard';
