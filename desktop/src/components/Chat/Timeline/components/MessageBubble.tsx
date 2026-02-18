/**
 * MessageBubble Component
 *
 * Displays user and assistant message bubbles with markdown rendering
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import styles from '../Timeline.module.css';
import type { TimelineItemType } from '../../../../types';
import { processMessageContent } from '../../../../lib/text/messageProcessor';
import { parseMessageContent } from '../../../../lib/parsers/qualityParser';
import { VerificationStatus, CodeQualityReport } from '../../../index';

interface MessageBubbleProps {
    item: TimelineItemType & { content: string };
    isUser: boolean;
}

const MessageBubbleComponent: React.FC<MessageBubbleProps> = ({ item, isUser }) => {
    const { t } = useTranslation();
    const [showCopy, setShowCopy] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(item.content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* ignore */ }
    };

    // Parse content for verification and quality data
    const parsed = isUser ? null : parseMessageContent(item.content);

    // Markdown renderer component
    const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => (
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
            {processMessageContent(content)}
        </ReactMarkdown>
    );

    return (
        <div
            className={`${styles.timelineItem} ${isUser ? styles.user : styles.assistant} ${styles.messageWrapper}`}
            onMouseEnter={() => setShowCopy(true)}
            onMouseLeave={() => setShowCopy(false)}
        >
            {showCopy && (
                <button
                    className={styles.copyButton}
                    onClick={handleCopy}
                    title={t('chat.copyMessage')}
                >
                    {copied ? t('chat.copied') : '📋'}
                </button>
            )}
            <div className={`${styles.contentBubble} ${!isUser ? styles.markdownBody : ''}`}>
                {isUser ? (
                    <div className={styles.userText}>{item.content}</div>
                ) : parsed && (parsed.verification || parsed.quality) ? (
                    // Enhanced rendering with quality/verification components
                    <div className="space-y-3">
                        {/* Before text */}
                        {parsed.beforeText && (
                            <MarkdownRenderer content={parsed.beforeText} />
                        )}

                        {/* Verification Status */}
                        {parsed.verification && (
                            <VerificationStatus {...parsed.verification} />
                        )}

                        {/* Code Quality Report */}
                        {parsed.quality && (
                            <CodeQualityReport {...parsed.quality} />
                        )}

                        {/* After text */}
                        {parsed.afterText && (
                            <MarkdownRenderer content={parsed.afterText} />
                        )}
                    </div>
                ) : (
                    // Standard markdown rendering
                    <MarkdownRenderer content={item.content} />
                )}
            </div>
        </div>
    );
};

// Custom comparison function to prevent unnecessary re-renders
// Only re-render when message content or role changes
const arePropsEqual = (prevProps: MessageBubbleProps, nextProps: MessageBubbleProps): boolean => {
    return (
        prevProps.item.id === nextProps.item.id &&
        prevProps.item.content === nextProps.item.content &&
        prevProps.isUser === nextProps.isUser
    );
};

export const MessageBubble = React.memo(MessageBubbleComponent, arePropsEqual);

MessageBubble.displayName = 'MessageBubble';
