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
import { processMessageContent } from '../../../../lib/text/messageProcessor';
import { parseInlineAttachments } from '../../../../lib/text/inlineAttachments';
import { parseMessageContent } from '../../../../lib/parsers/qualityParser';
import { isExternalHref } from '../../../../lib/externalLinks';
import { VerificationStatus, CodeQualityReport } from '../../../index';

interface MessageBubbleItem {
    id: string;
    content: string;
    isStreaming?: boolean;
}

interface MessageBubbleProps {
    item: MessageBubbleItem;
    isUser: boolean;
    tone?: 'default' | 'system' | 'status';
}

const MessageBubbleComponent: React.FC<MessageBubbleProps> = ({ item, isUser, tone = 'default' }) => {
    const { t } = useTranslation();
    const [showCopy, setShowCopy] = useState(false);
    const [copied, setCopied] = useState(false);
    const isStreamingAssistant = !isUser && item.isStreaming === true;
    const userContent = isUser ? parseInlineAttachments(item.content) : null;
    const copyableContent = isUser ? (userContent?.text || item.content) : item.content;
    const nonUserToneClass = !isUser
        ? tone === 'system'
            ? styles.systemContentBubble
            : tone === 'status'
                ? styles.statusContentBubble
                : ''
        : '';

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(copyableContent);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* ignore */ }
    };

    // Parse content for verification and quality data
    const parsed = isUser || isStreamingAssistant ? null : parseMessageContent(item.content);

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
                },
                a(props) {
                    const { href, children, ...rest } = props;
                    const isExternal = isExternalHref(href);
                    return (
                        <a
                            {...rest}
                            href={href}
                            target={isExternal ? '_blank' : undefined}
                            rel={isExternal ? 'noopener noreferrer' : undefined}
                        >
                            {children}
                        </a>
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
            <div className={`${styles.contentBubble} ${!isUser ? styles.markdownBody : ''} ${nonUserToneClass}`.trim()}>
                {isUser ? (
                    <div className={styles.userMessageBody}>
                        {userContent?.text ? (
                            <div className={styles.userText}>{userContent.text}</div>
                        ) : null}
                        {userContent?.images?.length ? (
                            <div className={styles.userImageList}>
                                {userContent.images.map((image, index) => (
                                    <img
                                        key={`${item.id}-image-${index}`}
                                        src={image.dataUrl}
                                        alt={image.name}
                                        className={styles.userImage}
                                    />
                                ))}
                            </div>
                        ) : null}
                    </div>
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
                    isStreamingAssistant ? (
                        <div className={styles.streamingText}>{item.content}</div>
                    ) : (
                        <MarkdownRenderer content={item.content} />
                    )
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
        prevProps.item.isStreaming === nextProps.item.isStreaming &&
        prevProps.isUser === nextProps.isUser &&
        prevProps.tone === nextProps.tone
    );
};

export const MessageBubble = React.memo(MessageBubbleComponent, arePropsEqual);

MessageBubble.displayName = 'MessageBubble';
