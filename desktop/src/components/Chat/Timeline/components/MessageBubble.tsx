/**
 * MessageBubble Component
 *
 * Displays user and assistant message bubbles with markdown rendering
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../Timeline.module.css';
import type { TimelineItemType } from '../../../../types';
import { processMessageContent } from '../../../../lib/text/messageProcessor';
import { parseMessageContent } from '../../../../lib/parsers/qualityParser';
import { VerificationStatus, CodeQualityReport } from '../../../index';
import { MarkdownContent } from '../../../Common/MarkdownContent';

interface MessageBubbleProps {
    item: TimelineItemType & { content: string; isStreaming?: boolean };
    isUser: boolean;
}

const STREAM_RENDER_DELAY_MS = 100;

function useBufferedStreamingContent(content: string, isStreaming: boolean): string {
    const [bufferedContent, setBufferedContent] = useState(content);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latestContentRef = useRef(content);

    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        latestContentRef.current = content;

        if (!isStreaming) {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
            setBufferedContent(content);
            return;
        }

        if (timeoutRef.current) {
            return;
        }

        timeoutRef.current = setTimeout(() => {
            timeoutRef.current = null;
            setBufferedContent(latestContentRef.current);
        }, STREAM_RENDER_DELAY_MS);
    }, [content, isStreaming]);

    return bufferedContent;
}

const MessageBubbleComponent: React.FC<MessageBubbleProps> = ({ item, isUser }) => {
    const { t } = useTranslation();
    const [showCopy, setShowCopy] = useState(false);
    const [copied, setCopied] = useState(false);
    const isStreaming = !isUser && item.isStreaming === true;
    const visibleContent = useBufferedStreamingContent(item.content, isStreaming);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(visibleContent);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* ignore */ }
    };

    // Parse content for verification and quality data
    const parsed = isUser || isStreaming ? null : parseMessageContent(visibleContent);

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
                    <div className={styles.userText}>{visibleContent}</div>
                ) : isStreaming ? (
                    <div className={styles.streamingText}>{visibleContent}</div>
                ) : parsed && (parsed.verification || parsed.quality) ? (
                    // Enhanced rendering with quality/verification components
                    <div className="space-y-3">
                        {/* Before text */}
                        {parsed.beforeText && (
                            <MarkdownContent content={processMessageContent(parsed.beforeText)} />
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
                            <MarkdownContent content={processMessageContent(parsed.afterText)} />
                        )}
                    </div>
                ) : (
                    // Standard markdown rendering
                    <MarkdownContent content={processMessageContent(visibleContent)} />
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
        prevProps.isUser === nextProps.isUser
    );
};

export const MessageBubble = React.memo(MessageBubbleComponent, arePropsEqual);

MessageBubble.displayName = 'MessageBubble';
