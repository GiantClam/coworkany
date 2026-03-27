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
import { isExternalHref } from '../../../../lib/externalLinks';
import { StructuredMessageCard } from './StructuredMessageCard';
import { buildToolCardViewModel, type ToolCardViewModel } from './toolCardViewModel';
import { StructuredInfoSection } from './StructuredCardPrimitives';

interface ToolCardProps {
    item?: ToolCallItem;
    viewModel?: ToolCardViewModel;
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
            subtitle={!expanded ? model.summary.preview : undefined}
            statusLabel={model.summary.statusLabel}
            statusTone={model.summary.statusTone}
            onHeaderClick={() => setExpanded(!expanded)}
            headerActionLabel="Details"
            expanded={expanded}
            className={styles.toolCard}
        >
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
