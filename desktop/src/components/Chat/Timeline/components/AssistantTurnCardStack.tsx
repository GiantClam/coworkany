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
    onApprovalDecision?: (input: {
        requestId: string;
        decision: 'approve' | 'deny' | 'modify_approve';
        note?: string;
    }) => Promise<void> | void;
}

const AssistantTurnCardStackComponent: React.FC<AssistantTurnCardStackProps> = ({
    cards,
    onTaskCollaborationSubmit,
    onApprovalDecision,
}) => {
    const [editingApprovalId, setEditingApprovalId] = React.useState<string | null>(null);
    const [approvalNotes, setApprovalNotes] = React.useState<Record<string, string>>({});
    const [pendingApprovalIds, setPendingApprovalIds] = React.useState<Record<string, boolean>>({});

    const runApprovalDecision = React.useCallback(async (input: {
        requestId: string;
        decision: 'approve' | 'deny' | 'modify_approve';
        note?: string;
    }) => {
        if (!onApprovalDecision) {
            return;
        }
        setPendingApprovalIds((current) => ({
            ...current,
            [input.requestId]: true,
        }));
        try {
            await onApprovalDecision(input);
        } finally {
            setPendingApprovalIds((current) => ({
                ...current,
                [input.requestId]: false,
            }));
        }
    }, [onApprovalDecision]);

    if (cards.length === 0) {
        return null;
    }

    return (
        <div className={styles.assistantTurnCardStack}>
            {cards.map((card) => {
                if (card.type === 'runtime-status') {
                    const pendingStatusClass = card.indicator === 'running-tool'
                        ? styles.pendingStatusRunningTool
                        : card.indicator === 'retrying'
                            ? styles.pendingStatusRetrying
                            : styles.pendingStatusThinking;
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
                                <div className={`${styles.pendingStatusCardBody} ${pendingStatusClass}`}>
                                    <div className={styles.pendingStatusLabelRow}>
                                        <span className={styles.pendingStatusLabel}>
                                            {card.summary.statusLabel || 'Running'}
                                        </span>
                                        {card.toolName ? (
                                            <span className={styles.pendingStatusToolChip}>{card.toolName}</span>
                                        ) : null}
                                    </div>
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

                if (card.type === 'approval-request') {
                    const approval = card.approval;
                    const isPendingDecision = approval.decision === 'pending';
                    const note = approvalNotes[approval.requestId] ?? '';
                    const isEditing = isPendingDecision && editingApprovalId === approval.requestId;
                    const isSubmitting = Boolean(pendingApprovalIds[approval.requestId]);
                    const severityClass = approval.severity === 'critical'
                        ? styles.approvalSeverityCritical
                        : approval.severity === 'high'
                            ? styles.approvalSeverityHigh
                            : approval.severity === 'medium'
                                ? styles.approvalSeverityMedium
                                : styles.approvalSeverityLow;
                    const decisionClass = approval.decision === 'approved'
                        ? styles.approvalDecisionApproved
                        : approval.decision === 'denied'
                            ? styles.approvalDecisionDenied
                            : styles.approvalDecisionPending;

                    return (
                        <StructuredMessageCard
                            key={card.id}
                            kind={card.summary.kind}
                            kicker={card.summary.kicker}
                            title={card.summary.title}
                            subtitle={card.summary.subtitle}
                            statusLabel={card.summary.statusLabel}
                            statusTone={card.summary.statusTone}
                            className={styles.approvalDecisionCard}
                        >
                            <div className={styles.approvalDecisionBody}>
                                <div className={styles.approvalDecisionMetaRow}>
                                    <span className={`${styles.approvalSeverityBadge} ${severityClass}`}>
                                        {approval.severity}
                                    </span>
                                    <span className={`${styles.approvalDecisionBadge} ${decisionClass}`}>
                                        {approval.decision}
                                    </span>
                                    <span className={styles.approvalRiskText}>Risk {approval.risk}</span>
                                </div>
                                {approval.blocking ? (
                                    <p className={styles.approvalBlockingText}>
                                        Blocks execution until a decision is submitted.
                                    </p>
                                ) : null}

                                {isPendingDecision ? (
                                    <div className={styles.approvalActionRow}>
                                        <button
                                            type="button"
                                            className={`${styles.approvalActionButton} ${styles.approvalActionButtonApprove}`}
                                            onClick={() => {
                                                void runApprovalDecision({
                                                    requestId: approval.requestId,
                                                    decision: 'approve',
                                                });
                                            }}
                                            disabled={!onApprovalDecision || isSubmitting}
                                        >
                                            Approve
                                        </button>
                                        <button
                                            type="button"
                                            className={`${styles.approvalActionButton} ${styles.approvalActionButtonModify}`}
                                            onClick={() => {
                                                setEditingApprovalId((current) => (
                                                    current === approval.requestId ? null : approval.requestId
                                                ));
                                            }}
                                            disabled={!onApprovalDecision || isSubmitting}
                                        >
                                            Modify & Approve
                                        </button>
                                        <button
                                            type="button"
                                            className={`${styles.approvalActionButton} ${styles.approvalActionButtonDeny}`}
                                            onClick={() => {
                                                void runApprovalDecision({
                                                    requestId: approval.requestId,
                                                    decision: 'deny',
                                                });
                                            }}
                                            disabled={!onApprovalDecision || isSubmitting}
                                        >
                                            Deny
                                        </button>
                                    </div>
                                ) : null}

                                {isPendingDecision && isEditing ? (
                                    <div className={styles.approvalModifyBox}>
                                        <input
                                            className={styles.approvalModifyInput}
                                            value={note}
                                            onChange={(event) => {
                                                const value = event.target.value;
                                                setApprovalNotes((current) => ({
                                                    ...current,
                                                    [approval.requestId]: value,
                                                }));
                                            }}
                                            placeholder="Describe required changes before approval..."
                                        />
                                        <button
                                            type="button"
                                            className={`${styles.approvalActionButton} ${styles.approvalActionButtonApprove}`}
                                            onClick={() => {
                                                const normalizedNote = note.trim();
                                                if (!normalizedNote) {
                                                    return;
                                                }
                                                void runApprovalDecision({
                                                    requestId: approval.requestId,
                                                    decision: 'modify_approve',
                                                    note: normalizedNote,
                                                });
                                                setEditingApprovalId(null);
                                                setApprovalNotes((current) => ({
                                                    ...current,
                                                    [approval.requestId]: '',
                                                }));
                                            }}
                                            disabled={!onApprovalDecision || isSubmitting || note.trim().length === 0}
                                        >
                                            Submit
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        </StructuredMessageCard>
                    );
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
