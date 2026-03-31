import React from 'react';
import { MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import styles from './AssistantUiThreadView.module.css';
import { readAssistantUiStructuredPayload, type AssistantUiStructuredApproval } from './messageAdapter';

function getToolStatusClass(status: 'running' | 'success' | 'failed'): string {
    switch (status) {
        case 'success':
            return styles.statusPillSuccess;
        case 'failed':
            return styles.statusPillFailed;
        default:
            return styles.statusPillRunning;
    }
}

function getDecisionClass(decision: 'pending' | 'approved' | 'denied'): string {
    switch (decision) {
        case 'approved':
            return styles.statusPillSuccess;
        case 'denied':
            return styles.statusPillFailed;
        default:
            return styles.statusPillPending;
    }
}

function getSeverityClass(severity: 'low' | 'medium' | 'high' | 'critical'): string {
    switch (severity) {
        case 'critical':
            return styles.severityCritical;
        case 'high':
            return styles.severityHigh;
        case 'medium':
            return styles.severityMedium;
        default:
            return styles.severityLow;
    }
}

function getTaskStatusClass(status: 'idle' | 'running' | 'finished' | 'failed'): string {
    switch (status) {
        case 'finished':
            return styles.statusPillSuccess;
        case 'failed':
            return styles.statusPillFailed;
        case 'running':
            return styles.statusPillRunning;
        default:
            return styles.statusPillPending;
    }
}

function getPatchStatusClass(status: 'proposed' | 'applied' | 'rejected'): string {
    switch (status) {
        case 'applied':
            return styles.statusPillSuccess;
        case 'rejected':
            return styles.statusPillFailed;
        default:
            return styles.statusPillPending;
    }
}

interface AssistantUiStructuredCardProps {
    title: string;
    count?: number;
    className?: string;
    children: React.ReactNode;
}

const AssistantUiStructuredCard: React.FC<AssistantUiStructuredCardProps> = ({
    title,
    count,
    className,
    children,
}) => (
    <section className={`${styles.structuredCard}${className ? ` ${className}` : ''}`} role="article" aria-label={title}>
        <header className={styles.structuredCardHeader}>
            <span className={styles.structuredHeading}>{title}</span>
            {typeof count === 'number' && count > 0 ? (
                <span className={styles.structuredCount} aria-label={`${count} items`}>{count}</span>
            ) : null}
        </header>
        {children}
    </section>
);

interface AssistantUiStructuredListProps {
    items: React.ReactNode[];
}

const AssistantUiStructuredList: React.FC<AssistantUiStructuredListProps> = ({ items }) => {
    const { t } = useTranslation();
    if (items.length <= 2) {
        return <ul className={styles.structuredList}>{items}</ul>;
    }

    const previewItems = items.slice(0, 2);
    const hiddenCount = items.length - previewItems.length;
    return (
        <div className={styles.structuredListGroup}>
            <ul className={styles.structuredList}>{previewItems}</ul>
            <details className={styles.structuredDetails}>
                <summary className={styles.structuredSummary}>
                    {t('assistantUi.showMore', { count: hiddenCount, defaultValue: `Show ${hiddenCount} more` })}
                </summary>
                <ul className={styles.structuredList}>{items.slice(2)}</ul>
            </details>
        </div>
    );
};

interface AssistantUiApprovalItemProps {
    approval: AssistantUiStructuredApproval;
    canResolveApproval: boolean;
    pending: boolean;
    isEditing: boolean;
    note: string;
    onApprove: (requestId: string) => void;
    onDeny: (requestId: string) => void;
    onToggleEdit: (requestId: string) => void;
    onNoteChange: (requestId: string, value: string) => void;
    onModifyApprove: (requestId: string) => void;
}

const AssistantUiApprovalItem: React.FC<AssistantUiApprovalItemProps> = ({
    approval,
    canResolveApproval,
    pending,
    isEditing,
    note,
    onApprove,
    onDeny,
    onToggleEdit,
    onNoteChange,
    onModifyApprove,
}) => {
    const { t } = useTranslation();
    const normalizedNote = note.trim();

    return (
        <li className={styles.structuredItem}>
            <strong className={styles.structuredPrimaryText}>{approval.effectType}</strong>
            <span className={`${styles.severityBadge} ${getSeverityClass(approval.severity)}`}>
                {approval.severity}
            </span>
            <span className={styles.structuredMeta}>
                {`${t('assistantUi.risk', { defaultValue: 'risk' })} ${approval.risk}`}
            </span>
            <span
                className={`${styles.statusPill} ${getDecisionClass(approval.decision)}`}
                aria-label={`approval decision ${approval.decision}`}
            >
                {approval.decision}
            </span>
            {approval.decision === 'pending' ? (
                <div className={styles.approvalActions}>
                    <button
                        type="button"
                        className={`${styles.approvalButton} ${styles.approvalButtonApprove}`}
                        onClick={() => onApprove(approval.requestId)}
                        disabled={!canResolveApproval || pending}
                    >
                        {t('assistantUi.approve', { defaultValue: 'Approve' })}
                    </button>
                    <button
                        type="button"
                        className={`${styles.approvalButton} ${styles.approvalButtonModify}`}
                        onClick={() => onToggleEdit(approval.requestId)}
                        disabled={!canResolveApproval || pending}
                    >
                        {t('assistantUi.modifyApprove', { defaultValue: 'Modify & Approve' })}
                    </button>
                    <button
                        type="button"
                        className={`${styles.approvalButton} ${styles.approvalButtonDeny}`}
                        onClick={() => onDeny(approval.requestId)}
                        disabled={!canResolveApproval || pending}
                    >
                        {t('assistantUi.deny', { defaultValue: 'Deny' })}
                    </button>
                </div>
            ) : null}
            {approval.decision === 'pending' && isEditing ? (
                <div className={styles.approvalModifyRow}>
                    <input
                        className={styles.approvalInput}
                        placeholder={t('assistantUi.modifyPlaceholder', { defaultValue: 'Describe required changes before approval...' })}
                        value={note}
                        onChange={(event) => onNoteChange(approval.requestId, event.target.value)}
                    />
                    <button
                        type="button"
                        className={`${styles.approvalButton} ${styles.approvalButtonApprove}`}
                        onClick={() => onModifyApprove(approval.requestId)}
                        disabled={!canResolveApproval || pending || normalizedNote.length === 0}
                    >
                        {t('assistantUi.submit', { defaultValue: 'Submit' })}
                    </button>
                </div>
            ) : null}
        </li>
    );
};

interface AssistantStructuredDetailsProps {
    onApprovalDecision?: (input: {
        requestId: string;
        decision: 'approve' | 'deny' | 'modify_approve';
        note?: string;
    }) => Promise<void> | void;
}

const AssistantStructuredDetails: React.FC<AssistantStructuredDetailsProps> = ({ onApprovalDecision }) => {
    const { t } = useTranslation();
    const role = useAuiState((state) => state.message.role);
    const customValue = useAuiState((state) => state.message.metadata?.custom);
    const structured = React.useMemo(
        () => readAssistantUiStructuredPayload(customValue),
        [customValue],
    );
    const [editingApprovalId, setEditingApprovalId] = React.useState<string | null>(null);
    const [approvalNotes, setApprovalNotes] = React.useState<Record<string, string>>({});
    const [pendingApprovalIds, setPendingApprovalIds] = React.useState<Record<string, boolean>>({});

    if (role !== 'assistant' || !structured) {
        return null;
    }

    const highRiskApprovals = structured.approvals.filter((approval) => approval.blocking);
    const hasCriticalHighRisk = highRiskApprovals.some((approval) => approval.severity === 'critical');
    const regularApprovals = structured.approvals.filter((approval) => !approval.blocking);
    const canResolveApproval = Boolean(onApprovalDecision);
    const runApprovalDecision = async (input: {
        requestId: string;
        decision: 'approve' | 'deny' | 'modify_approve';
        note?: string;
    }): Promise<void> => {
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
    };
    const handleApprove = (requestId: string) => {
        void runApprovalDecision({
            requestId,
            decision: 'approve',
        });
    };
    const handleDeny = (requestId: string) => {
        void runApprovalDecision({
            requestId,
            decision: 'deny',
        });
    };
    const handleModifyApprove = (requestId: string) => {
        const note = (approvalNotes[requestId] || '').trim();
        if (!note) {
            return;
        }
        void runApprovalDecision({
            requestId,
            decision: 'modify_approve',
            note,
        });
        setApprovalNotes((current) => ({
            ...current,
            [requestId]: '',
        }));
        setEditingApprovalId(null);
    };
    const renderApprovalSection = (
        approvals: AssistantUiStructuredApproval[],
        title: string,
        keyPrefix: string,
        className?: string,
    ) => {
        if (approvals.length === 0) {
            return null;
        }

        return (
            <AssistantUiStructuredCard
                title={title}
                count={approvals.length}
                className={className}
            >
                <AssistantUiStructuredList
                    items={approvals.map((approval, index) => (
                        <AssistantUiApprovalItem
                            key={`${keyPrefix}-${approval.requestId}-${index}`}
                            approval={approval}
                            canResolveApproval={canResolveApproval}
                            pending={Boolean(pendingApprovalIds[approval.requestId])}
                            isEditing={approval.decision === 'pending' && editingApprovalId === approval.requestId}
                            note={approvalNotes[approval.requestId] ?? ''}
                            onApprove={handleApprove}
                            onDeny={handleDeny}
                            onToggleEdit={(requestId) => {
                                setEditingApprovalId((current) => (
                                    current === requestId ? null : requestId
                                ));
                            }}
                            onNoteChange={(requestId, value) => {
                                setApprovalNotes((current) => ({
                                    ...current,
                                    [requestId]: value,
                                }));
                            }}
                            onModifyApprove={handleModifyApprove}
                        />
                    ))}
                />
            </AssistantUiStructuredCard>
        );
    };

    return (
        <div className={styles.structuredBlock}>
            {structured.runtime?.pendingLabel && (
                <AssistantUiStructuredCard title={t('assistantUi.runtimeStatus', { defaultValue: 'Runtime status' })}>
                    <div className={styles.structuredItem}>
                        <span className={styles.runtimePulseDot} aria-hidden="true" />
                        <span
                            className={`${styles.statusPill} ${styles.statusPillRunning}`}
                            aria-label={t('assistantUi.runtimeStatusAriaRunning', { defaultValue: 'runtime status running' })}
                        >
                            {t('assistantUi.statusRunning', { defaultValue: 'running' })}
                        </span>
                        <span className={styles.structuredPrimaryText}>{structured.runtime.pendingLabel}</span>
                    </div>
                </AssistantUiStructuredCard>
            )}

            {highRiskApprovals.length > 0 && (
                renderApprovalSection(
                    highRiskApprovals,
                    t('assistantUi.highRiskApprovals', { defaultValue: 'High risk approvals' }),
                    'high-risk-approval',
                    hasCriticalHighRisk ? styles.highRiskCardPulse : undefined,
                )
            )}

            {structured.tools.length > 0 && (
                <AssistantUiStructuredCard title={t('assistantUi.tools', { defaultValue: 'Tools' })} count={structured.tools.length}>
                    <AssistantUiStructuredList
                        items={structured.tools.map((tool, index) => (
                            <li key={`tool-${index}`} className={styles.structuredItem}>
                                <div className={styles.structuredItemBody}>
                                    <div className={styles.structuredItemMain}>
                                        <strong className={styles.structuredPrimaryText}>{tool.toolName}</strong>
                                        <span
                                            className={`${styles.statusPill} ${getToolStatusClass(tool.status)}`}
                                            aria-label={`tool status ${tool.status}`}
                                        >
                                            {tool.status}
                                        </span>
                                    </div>
                                    {tool.inputSummary ? (
                                        <div className={styles.structuredSubline}>
                                            {`${t('assistantUi.args', { defaultValue: 'args' })}: ${tool.inputSummary}`}
                                        </div>
                                    ) : null}
                                    {tool.resultSummary ? (
                                        <div className={styles.structuredSubline}>
                                            {`${t('assistantUi.result', { defaultValue: 'result' })}: ${tool.resultSummary}`}
                                        </div>
                                    ) : null}
                                </div>
                            </li>
                        ))}
                    />
                </AssistantUiStructuredCard>
            )}

            {regularApprovals.length > 0 && (
                renderApprovalSection(
                    regularApprovals,
                    t('assistantUi.approvals', { defaultValue: 'Approvals' }),
                    'approval',
                )
            )}

            {structured.task && (
                <AssistantUiStructuredCard title={t('assistantUi.task', { defaultValue: 'Task' })}>
                    <div className={styles.structuredItemBody}>
                        <div className={styles.structuredItemMain}>
                            <strong className={styles.structuredPrimaryText}>{structured.task.title}</strong>
                            <span
                                className={`${styles.statusPill} ${getTaskStatusClass(structured.task.status)}`}
                                aria-label={`task status ${structured.task.status}`}
                            >
                                {structured.task.status}
                            </span>
                        </div>
                        {structured.task.progress ? (
                            <>
                                <div className={styles.structuredSubline}>
                                    {`${t('assistantUi.progress', { defaultValue: 'progress' })}: ${structured.task.progress.completed}/${structured.task.progress.total}`}
                                </div>
                                <div className={styles.taskProgressTrack} aria-hidden="true">
                                    <span
                                        className={styles.taskProgressFill}
                                        style={{
                                            width: `${Math.max(
                                                0,
                                                Math.min(
                                                    100,
                                                    structured.task.progress.total > 0
                                                        ? (structured.task.progress.completed / structured.task.progress.total) * 100
                                                        : 0,
                                                ),
                                            )}%`,
                                        }}
                                    />
                                </div>
                            </>
                        ) : null}
                    </div>
                </AssistantUiStructuredCard>
            )}

            {structured.patches.length > 0 && (
                <AssistantUiStructuredCard title={t('assistantUi.patches', { defaultValue: 'Patches' })} count={structured.patches.length}>
                    <AssistantUiStructuredList
                        items={structured.patches.map((patch, index) => (
                            <li key={`patch-${index}`} className={styles.structuredItem}>
                                <strong className={styles.structuredPrimaryText}>{patch.filePath}</strong>
                                <span
                                    className={`${styles.statusPill} ${getPatchStatusClass(patch.status)}`}
                                    aria-label={`patch status ${patch.status}`}
                                >
                                    {patch.status}
                                </span>
                            </li>
                        ))}
                    />
                </AssistantUiStructuredCard>
            )}
        </div>
    );
};

interface AssistantUiMessageProps {
    onApprovalDecision?: (input: {
        requestId: string;
        decision: 'approve' | 'deny' | 'modify_approve';
        note?: string;
    }) => Promise<void> | void;
}

const AssistantUiMessage: React.FC<AssistantUiMessageProps> = ({ onApprovalDecision }) => {
    const { t } = useTranslation();
    return (
        <MessagePrimitive.Root className={styles.messageRow}>
            <MessagePrimitive.If user>
                <div className={`${styles.messageRow} ${styles.messageRowUser}`}>
                    <div className={styles.messageRail}>
                        <div className={`${styles.messageBubble} ${styles.userBubble}`}>
                            <MessagePrimitive.Parts />
                        </div>
                    </div>
                </div>
            </MessagePrimitive.If>

            <MessagePrimitive.If assistant>
                <div className={`${styles.messageRow} ${styles.messageRowAssistant}`}>
                    <div className={styles.messageRail}>
                        <span className={`${styles.roleBadge} ${styles.roleBadgeAssistant}`} aria-hidden="true">AI</span>
                        <div className={`${styles.messageBubble} ${styles.assistantBubble}`}>
                            <div className={styles.messageMetaRow}>
                                <span className={styles.messageRoleLabel}>
                                    {t('assistantUi.assistantLabel', { defaultValue: 'CoworkAny' })}
                                </span>
                            </div>
                            <MessagePrimitive.Parts />
                            <AssistantStructuredDetails onApprovalDecision={onApprovalDecision} />
                        </div>
                    </div>
                </div>
            </MessagePrimitive.If>

            <MessagePrimitive.If system>
                <div className={`${styles.messageRow} ${styles.messageRowSystem}`}>
                    <div className={styles.messageRail}>
                        <span className={`${styles.roleBadge} ${styles.roleBadgeSystem}`} aria-hidden="true">SYS</span>
                        <div className={`${styles.messageBubble} ${styles.systemBubble}`}>
                            <div className={styles.messageMetaRow}>
                                <span className={styles.messageRoleLabel}>
                                    {t('assistantUi.systemLabel', { defaultValue: 'System' })}
                                </span>
                            </div>
                            <MessagePrimitive.Parts />
                        </div>
                    </div>
                </div>
            </MessagePrimitive.If>
        </MessagePrimitive.Root>
    );
};

interface AssistantUiThreadViewProps {
    onApprovalDecision?: (input: {
        requestId: string;
        decision: 'approve' | 'deny' | 'modify_approve';
        note?: string;
    }) => Promise<void> | void;
}

export const AssistantUiThreadView: React.FC<AssistantUiThreadViewProps> = ({ onApprovalDecision }) => {
    return (
        <ThreadPrimitive.Root className={styles.threadRoot}>
            <ThreadPrimitive.Viewport className={styles.viewport}>
                <ThreadPrimitive.Messages
                    components={{
                        Message: () => <AssistantUiMessage onApprovalDecision={onApprovalDecision} />,
                    }}
                />
            </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
    );
};
