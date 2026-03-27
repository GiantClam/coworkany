import React from 'react';
import styles from '../Timeline.module.css';
import { sanitizeDisplayText } from '../textSanitizer';

interface StructuredMessageCardProps {
    kind?: 'assistant' | 'runtime' | 'task' | 'tool';
    hideHeader?: boolean;
    kicker?: string;
    title: string;
    subtitle?: string;
    statusLabel?: string;
    statusTone?: 'neutral' | 'running' | 'success' | 'failed';
    children?: React.ReactNode;
    onHeaderClick?: () => void;
    headerActionLabel?: string;
    expanded?: boolean;
    className?: string;
}

function cardKindClass(kind: StructuredMessageCardProps['kind']): string {
    switch (kind) {
        case 'runtime':
            return styles.structuredCardRuntime;
        case 'task':
            return styles.structuredCardTask;
        case 'tool':
            return styles.structuredCardTool;
        case 'assistant':
        default:
            return styles.structuredCardAssistant;
    }
}

function statusToneClass(tone: StructuredMessageCardProps['statusTone']): string {
    switch (tone) {
        case 'running':
            return styles.structuredCardStatusRunning;
        case 'success':
            return styles.structuredCardStatusSuccess;
        case 'failed':
            return styles.structuredCardStatusFailed;
        default:
            return styles.structuredCardStatusNeutral;
    }
}

const StructuredMessageCardComponent: React.FC<StructuredMessageCardProps> = ({
    kind = 'assistant',
    hideHeader = false,
    kicker,
    title,
    subtitle,
    statusLabel,
    statusTone = 'neutral',
    children,
    onHeaderClick,
    headerActionLabel,
    expanded,
    className,
}) => {
    const safeKicker = sanitizeDisplayText(kicker || '');
    const safeTitle = sanitizeDisplayText(title);
    const safeSubtitle = sanitizeDisplayText(subtitle || '');
    const cardClassName = [
        styles.timelineItem,
        styles.assistant,
        className || '',
    ].filter(Boolean).join(' ');

    return (
        <div className={cardClassName}>
            <div className={`${styles.contentBubble} ${styles.structuredMessageCard} ${cardKindClass(kind)}`}>
                {!hideHeader ? (
                    <div
                        className={`${styles.structuredCardHeader} ${onHeaderClick ? styles.structuredCardHeaderInteractive : ''}`}
                        onClick={onHeaderClick}
                        role={onHeaderClick ? 'button' : undefined}
                        tabIndex={onHeaderClick ? 0 : undefined}
                        onKeyDown={onHeaderClick
                            ? (event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    onHeaderClick();
                                }
                            }
                            : undefined}
                    >
                        <div className={styles.structuredCardHeading}>
                            {safeKicker ? <span className={styles.structuredCardKicker}>{safeKicker}</span> : null}
                            <strong className={styles.structuredCardTitle}>{safeTitle}</strong>
                            {safeSubtitle ? <p className={styles.structuredCardSubtitle}>{safeSubtitle}</p> : null}
                        </div>
                        <div className={styles.structuredCardMeta}>
                            {statusLabel ? (
                                <span className={`${styles.structuredCardStatus} ${statusToneClass(statusTone)}`}>
                                    {sanitizeDisplayText(statusLabel)}
                                </span>
                            ) : null}
                            {headerActionLabel ? (
                                <span className={styles.structuredCardToggle}>
                                    {sanitizeDisplayText(headerActionLabel)}{expanded !== undefined ? (expanded ? ' -' : ' +') : ''}
                                </span>
                            ) : null}
                        </div>
                    </div>
                ) : null}
                {children ? <div className={styles.structuredCardBody}>{children}</div> : null}
            </div>
        </div>
    );
};

export const StructuredMessageCard = React.memo(StructuredMessageCardComponent);
StructuredMessageCard.displayName = 'StructuredMessageCard';
