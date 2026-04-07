/**
 * ToolCard Component
 *
 * Displays tool call item with expandable details
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import styles from '../Timeline.module.css';
import type { ToolCallItem } from '../../../../types';
import { isExternalHref } from '../../../../lib/externalLinks';
import { StructuredMessageCard } from './StructuredMessageCard';
import { buildToolCardViewModel, type ToolCardViewModel } from './toolCardViewModel';
import { StructuredInfoSection } from './StructuredCardPrimitives';

interface ToolCardProps {
    item?: ToolCallItem;
    viewModel?: ToolCardViewModel;
}

function getEventToneClass(tone: ToolCardViewModel['summary']['statusTone']): string {
    switch (tone) {
        case 'success':
            return styles.toolEventToneSuccess;
        case 'failed':
            return styles.toolEventToneFailed;
        default:
            return styles.toolEventToneRunning;
    }
}

const ToolCardComponent: React.FC<ToolCardProps> = ({ item, viewModel }) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const model = useMemo(
        () => viewModel ?? (item ? buildToolCardViewModel(item) : null),
        [item, viewModel],
    );

    if (!model) {
        return null;
    }

    return (
        <StructuredMessageCard
            kind={model.summary.kind}
            kicker={model.summary.kicker}
            title={model.summary.title}
            subtitle={!expanded ? (model.summary.eventDetail || model.summary.preview) : undefined}
            statusLabel={model.summary.statusLabel}
            statusTone={model.summary.statusTone}
            onHeaderClick={() => setExpanded(!expanded)}
            headerActionLabel={t('chat.details', { defaultValue: 'Details' })}
            expanded={expanded}
            className={styles.toolCard}
        >
            <div className={styles.toolEventTimelineRow}>
                <span className={`${styles.toolEventTimelineDot} ${getEventToneClass(model.summary.statusTone)}`} aria-hidden="true" />
                <div className={styles.toolEventTimelineText}>
                    <span className={styles.toolEventTimelinePrimary}>{model.summary.statusLabel}</span>
                    {model.summary.eventDetail ? (
                        <span className={styles.toolEventTimelineSecondary}>{model.summary.eventDetail}</span>
                    ) : null}
                </div>
            </div>
            {expanded ? (
                <div className={styles.structuredSectionGroup}>
                    {model.sections.map((section, index) => (
                        <StructuredInfoSection
                            key={`${model.id}-${section.label}-${index}`}
                            label={section.label === 'Input' ? t('chat.input') : t('chat.output')}
                        >
                            <div className={styles.markdownBody}>
                                {section.content.type === 'markdown' ? (
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkBreaks]}
                                        components={{
                                            code(props) {
                                                const { children, className } = props;
                                                const isBlock = className?.includes('language-');
                                                if (!isBlock) {
                                                    return (
                                                        <code {...props} className={className}>
                                                            {children}
                                                        </code>
                                                    );
                                                }

                                                return (
                                                    <pre className={styles.codeBlock}>
                                                        <code className={className}>
                                                            {String(children).replace(/\n$/, '')}
                                                        </code>
                                                    </pre>
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
                                        {section.content.value}
                                    </ReactMarkdown>
                                ) : (
                                    <pre className={styles.codeBlock}>
                                        {section.content.value}
                                    </pre>
                                )}
                            </div>
                        </StructuredInfoSection>
                    ))}
                </div>
            ) : null}
        </StructuredMessageCard>
    );
};

// Custom comparison function to prevent unnecessary re-renders
// Only re-render when the tool call data actually changes
const arePropsEqual = (prevProps: ToolCardProps, nextProps: ToolCardProps): boolean => {
    if (prevProps.viewModel || nextProps.viewModel) {
        return JSON.stringify(prevProps.viewModel) === JSON.stringify(nextProps.viewModel);
    }

    return (
        prevProps.item?.id === nextProps.item?.id &&
        prevProps.item?.toolName === nextProps.item?.toolName &&
        prevProps.item?.status === nextProps.item?.status &&
        prevProps.item?.result === nextProps.item?.result &&
        JSON.stringify(prevProps.item?.args) === JSON.stringify(nextProps.item?.args)
    );
};

export const ToolCard = React.memo(ToolCardComponent, arePropsEqual);

ToolCard.displayName = 'ToolCard';
