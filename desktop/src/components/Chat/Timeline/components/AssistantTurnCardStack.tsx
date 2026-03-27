import React from 'react';
import styles from '../Timeline.module.css';
import { TaskCardMessage } from './TaskCardMessage';
import { ToolCard } from './ToolCard';
import { StructuredMessageCard } from './StructuredMessageCard';
import type { AssistantTurnCardSchema } from './assistantTurnCardSchema';
import { RichMessageContent } from './RichMessageContent';

interface AssistantTurnCardStackProps {
    cards: AssistantTurnCardSchema[];
    onTaskCollaborationSubmit?: (input: {
        taskId?: string;
        cardId: string;
        actionId?: string;
        value: string;
    }) => void;
}

const AssistantTurnCardStackComponent: React.FC<AssistantTurnCardStackProps> = ({
    cards,
    onTaskCollaborationSubmit,
}) => {
    if (cards.length === 0) {
        return null;
    }

    return (
        <div className={styles.assistantTurnCardStack}>
            {cards.map((card) => {
                if (card.type === 'runtime-status') {
                    return (
                        <div key={card.id} role="status" aria-live="polite">
                            <StructuredMessageCard
                                kind={card.summary.kind}
                                kicker={card.summary.kicker}
                                title={card.summary.title}
                                subtitle={card.summary.subtitle}
                                statusLabel={card.summary.statusLabel}
                                statusTone={card.summary.statusTone}
                                className={styles.assistantPendingCard}
                            >
                                <div className={styles.pendingStatusCardBody}>
                                    <span className={styles.pendingStatusDots} aria-hidden="true">
                                        <span className={styles.pendingStatusDot} />
                                        <span className={styles.pendingStatusDot} />
                                        <span className={styles.pendingStatusDot} />
                                    </span>
                                    <span className={styles.pendingStatusTrack} aria-hidden="true">
                                        <span className={styles.pendingStatusBar} />
                                    </span>
                                </div>
                            </StructuredMessageCard>
                        </div>
                    );
                }

                if (card.type === 'assistant-response') {
                    return (
                        <StructuredMessageCard
                            key={card.id}
                            kind={card.summary.kind}
                            kicker={card.summary.kicker}
                            title={card.summary.title}
                            subtitle={card.summary.subtitle}
                            statusLabel={card.summary.statusLabel}
                            statusTone={card.summary.statusTone}
                            className={styles.assistantResponseCard}
                        >
                            {card.messages.length > 0 ? (
                                <div className={styles.assistantTurnMarkdownStack}>
                                    {card.messages.map((message, index) => (
                                        <RichMessageContent
                                            key={`${card.id}-message-${index}`}
                                            content={message}
                                            className={`${styles.markdownBody} ${styles.assistantTurnMarkdown}`}
                                        />
                                    ))}
                                </div>
                            ) : null}

                            {card.systemEvents.length > 0 ? (
                                <div className={styles.assistantResponseSystemBlock}>
                                    <span className={styles.assistantResponseSystemLabel}>Runtime</span>
                                    <div className={styles.assistantTurnMarkdownStack}>
                                        {card.systemEvents.map((entry, index) => (
                                            <div key={`${card.id}-system-${index}`} className={`${styles.markdownBody} ${styles.assistantTurnSystemNote}`}>
                                                {entry}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                        </StructuredMessageCard>
                    );
                }

                if (card.type === 'tool-call') {
                    return <ToolCard key={card.id} viewModel={card.viewModel} />;
                }

                const taskCard = (
                    <TaskCardMessage
                        key={card.id}
                        viewModel={card.viewModel}
                        onTaskCollaborationSubmit={onTaskCollaborationSubmit}
                    />
                );

                return card.placement === 'primary'
                    ? <div key={card.id} className={styles.assistantTurnCardWrap}>{taskCard}</div>
                    : taskCard;
            })}
        </div>
    );
};

export const AssistantTurnCardStack = React.memo(AssistantTurnCardStackComponent);
AssistantTurnCardStack.displayName = 'AssistantTurnCardStack';
