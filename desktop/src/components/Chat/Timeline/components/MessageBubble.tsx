import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from '../Timeline.module.css';
import { processMessageContent } from '../../../../lib/text/messageProcessor';
import { parseInlineAttachments } from '../../../../lib/text/inlineAttachments';
import { isExternalHref } from '../../../../lib/externalLinks';

interface MessageBubbleItem {
    id: string;
    content: string;
}

interface MessageBubbleProps {
    item: MessageBubbleItem;
    isUser: boolean;
}

const MessageBubbleComponent: React.FC<MessageBubbleProps> = ({ item, isUser }) => {
    const { t } = useTranslation();
    const [showCopy, setShowCopy] = useState(false);
    const [copied, setCopied] = useState(false);
    const userContent = isUser ? parseInlineAttachments(item.content) : null;
    const copyableContent = isUser ? (userContent?.text || item.content) : item.content;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(copyableContent);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // ignore clipboard failures
        }
    };

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
            <div className={`${styles.contentBubble} ${!isUser ? styles.markdownBody : ''}`.trim()}>
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
                ) : (
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
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
                        {processMessageContent(item.content)}
                    </ReactMarkdown>
                )}
            </div>
        </div>
    );
};

const arePropsEqual = (prevProps: MessageBubbleProps, nextProps: MessageBubbleProps): boolean => {
    return (
        prevProps.item.id === nextProps.item.id &&
        prevProps.item.content === nextProps.item.content &&
        prevProps.isUser === nextProps.isUser
    );
};

export const MessageBubble = React.memo(MessageBubbleComponent, arePropsEqual);

MessageBubble.displayName = 'MessageBubble';
