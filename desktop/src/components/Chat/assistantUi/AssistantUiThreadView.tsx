import React from 'react';
import { ActionBarPrimitive, MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import styles from './AssistantUiThreadView.module.css';
import {
    readAssistantUiStructuredPayload,
    type AssistantUiStructuredApproval,
    type AssistantUiStructuredPayload,
} from './messageAdapter';
import { processMessageContent } from '../../../lib/text/messageProcessor';
import { isExternalHref } from '../../../lib/externalLinks';
import { formatAssistantUiTimestamp, toTimestampIsoString } from './messageTime';

type RuntimeTone = 'running' | 'pending';

interface RuntimeDescriptor {
    label: string;
    detail: string;
    tone: RuntimeTone;
}

function getRuntimePhaseDescriptor(
    runtime: AssistantUiStructuredPayload['runtime'] | undefined,
    t: (key: string, options?: Record<string, unknown>) => string,
): RuntimeDescriptor | null {
    if (!runtime) {
        return null;
    }

    const toolName = runtime.toolName || t('assistantUi.genericTool', { defaultValue: 'tool' });
    switch (runtime.pendingPhase) {
        case 'running_tool':
            return {
                label: t('assistantUi.runtimeUsingTool', { defaultValue: 'Using tool' }),
                detail: runtime.pendingLabel || t('assistantUi.runtimeUsingToolDetail', {
                    tool: toolName,
                    defaultValue: `Executing ${toolName} and waiting for result...`,
                }),
                tone: 'running',
            };
        case 'retrying':
            return {
                label: t('assistantUi.runtimeRetrying', { defaultValue: 'Retrying' }),
                detail: runtime.pendingLabel || t('assistantUi.runtimeRetryingDetail', {
                    defaultValue: 'Request was rate limited. Retrying now...',
                }),
                tone: 'pending',
            };
        case 'waiting_for_model':
            return {
                label: t('assistantUi.runtimeThinking', { defaultValue: 'Thinking' }),
                detail: runtime.pendingLabel || t('assistantUi.runtimeThinkingDetail', {
                    defaultValue: 'Model is reasoning and preparing the response...',
                }),
                tone: 'running',
            };
        default:
            if (runtime.pendingLabel) {
                return {
                    label: t('assistantUi.runtimeRunning', { defaultValue: 'Running' }),
                    detail: runtime.pendingLabel,
                    tone: 'running',
                };
            }
            return null;
    }
}

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

function getToolStatusLabel(
    status: 'running' | 'success' | 'failed',
    t: (key: string, options?: Record<string, unknown>) => string,
): string {
    switch (status) {
        case 'success':
            return t('assistantUi.statusCompleted', { defaultValue: 'Completed' });
        case 'failed':
            return t('assistantUi.statusFailed', { defaultValue: 'Failed' });
        default:
            return t('assistantUi.statusRunning', { defaultValue: 'Running' });
    }
}

function getToolEventMarkerClass(status: 'running' | 'success' | 'failed'): string {
    switch (status) {
        case 'success':
            return styles.toolEventMarkerSuccess;
        case 'failed':
            return styles.toolEventMarkerFailed;
        default:
            return styles.toolEventMarkerRunning;
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

function getDecisionTimelineClass(decision: 'pending' | 'approved' | 'denied'): string {
    switch (decision) {
        case 'approved':
            return styles.structuredTimelineSuccess;
        case 'denied':
            return styles.structuredTimelineFailed;
        default:
            return styles.structuredTimelinePending;
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

function getPatchTimelineClass(status: 'proposed' | 'applied' | 'rejected'): string {
    switch (status) {
        case 'applied':
            return styles.structuredTimelineSuccess;
        case 'rejected':
            return styles.structuredTimelineFailed;
        default:
            return styles.structuredTimelinePending;
    }
}

function getTaskStatusClass(status: 'idle' | 'running' | 'finished' | 'failed' | 'suspended'): string {
    switch (status) {
        case 'finished':
            return styles.statusPillSuccess;
        case 'failed':
        case 'suspended':
            return styles.statusPillFailed;
        case 'running':
            return styles.statusPillRunning;
        default:
            return styles.statusPillPending;
    }
}

function getTaskStatusLabel(
    status: 'idle' | 'running' | 'finished' | 'failed' | 'suspended',
    t: (key: string, options?: Record<string, unknown>) => string,
): string {
    switch (status) {
        case 'finished':
            return t('assistantUi.statusCompleted', { defaultValue: 'Completed' });
        case 'failed':
            return t('assistantUi.statusFailed', { defaultValue: 'Failed' });
        case 'suspended':
            return t('assistantUi.statusSuspended', { defaultValue: 'Suspended' });
        case 'running':
            return t('assistantUi.statusRunning', { defaultValue: 'Running' });
        default:
            return t('assistantUi.statusPending', { defaultValue: 'Pending' });
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

function getPatchStatusLabel(
    status: 'proposed' | 'applied' | 'rejected',
    t: (key: string, options?: Record<string, unknown>) => string,
): string {
    switch (status) {
        case 'applied':
            return t('assistantUi.patchApplied', { defaultValue: 'Applied' });
        case 'rejected':
            return t('assistantUi.patchRejected', { defaultValue: 'Rejected' });
        default:
            return t('assistantUi.patchProposed', { defaultValue: 'Proposed' });
    }
}

interface AssistantUiStructuredCardProps {
    title: string;
    count?: number;
    className?: string;
    children: React.ReactNode;
}

const structuredListExpansionMemory = new Map<string, boolean>();

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
    expansionKey?: string;
}

const AssistantUiStructuredList: React.FC<AssistantUiStructuredListProps> = ({ items, expansionKey }) => {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = React.useState<boolean>(() => (
        expansionKey ? Boolean(structuredListExpansionMemory.get(expansionKey)) : false
    ));

    React.useEffect(() => {
        if (!expansionKey) {
            return;
        }
        setIsExpanded(Boolean(structuredListExpansionMemory.get(expansionKey)));
    }, [expansionKey]);

    React.useEffect(() => {
        if (!expansionKey) {
            return;
        }
        structuredListExpansionMemory.set(expansionKey, isExpanded);
    }, [expansionKey, isExpanded]);

    if (items.length <= 2) {
        return <ul className={styles.structuredList}>{items}</ul>;
    }

    const previewItems = items.slice(0, 2);
    const hiddenCount = items.length - previewItems.length;
    return (
        <div className={styles.structuredListGroup}>
            <ul className={styles.structuredList}>{previewItems}</ul>
            <details
                className={styles.structuredDetails}
                open={isExpanded}
                onToggle={(event) => {
                    setIsExpanded(event.currentTarget.open);
                }}
            >
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
        <li className={`${styles.structuredItem} ${styles.structuredItemTimeline} ${styles.approvalItem} ${getDecisionTimelineClass(approval.decision)}`}>
            <span className={styles.structuredTimelineDot} aria-hidden="true" />
            <div className={styles.structuredItemBody}>
                <div className={styles.approvalItemHeader}>
                    <strong className={styles.structuredPrimaryText}>{approval.effectType}</strong>
                    <span className={`${styles.severityBadge} ${getSeverityClass(approval.severity)}`}>
                        {approval.severity}
                    </span>
                    <span
                        className={`${styles.statusPill} ${getDecisionClass(approval.decision)}`}
                        aria-label={`approval decision ${approval.decision}`}
                    >
                        {approval.decision}
                    </span>
                </div>
                <div className={styles.approvalItemMeta}>
                    <span className={styles.structuredMeta}>
                        {`${t('assistantUi.risk', { defaultValue: 'risk' })} ${approval.risk}`}
                    </span>
                    {approval.blocking ? (
                        <span className={styles.approvalBlockingHint}>
                            {t('assistantUi.approvalBlocking', { defaultValue: 'Blocks execution until resolved' })}
                        </span>
                    ) : null}
                </div>
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
            </div>
        </li>
    );
};

interface AssistantStructuredDetailsProps {
    structured: AssistantUiStructuredPayload | null;
    suppressRuntimeCard?: boolean;
    messageScopeKey?: string;
    onApprovalDecision?: (input: {
        requestId: string;
        decision: 'approve' | 'deny' | 'modify_approve';
        note?: string;
    }) => Promise<void> | void;
}

const AssistantStructuredDetails: React.FC<AssistantStructuredDetailsProps> = ({
    structured,
    suppressRuntimeCard = false,
    messageScopeKey,
    onApprovalDecision,
}) => {
    const { t } = useTranslation();
    const [editingApprovalId, setEditingApprovalId] = React.useState<string | null>(null);
    const [approvalNotes, setApprovalNotes] = React.useState<Record<string, string>>({});
    const [pendingApprovalIds, setPendingApprovalIds] = React.useState<Record<string, boolean>>({});

    if (!structured) {
        return null;
    }

    const runtimeDescriptor = getRuntimePhaseDescriptor(structured.runtime, t);
    const highRiskApprovals = structured.approvals.filter((approval) => approval.blocking);
    const hasCriticalHighRisk = highRiskApprovals.some((approval) => approval.severity === 'critical');
    const regularApprovals = structured.approvals.filter((approval) => !approval.blocking);
    const shouldRenderRuntimeCard = Boolean(runtimeDescriptor) && !suppressRuntimeCard;
    const hasNonRuntimeSections = (
        highRiskApprovals.length > 0
        || structured.events.length > 0
        || structured.tools.length > 0
        || regularApprovals.length > 0
        || Boolean(structured.task)
        || structured.patches.length > 0
    );
    if (!shouldRenderRuntimeCard && !hasNonRuntimeSections) {
        return null;
    }
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

        const mergedClassName = [styles.approvalDecisionCard, className].filter(Boolean).join(' ');
        return (
            <AssistantUiStructuredCard
                title={title}
                count={approvals.length}
                className={mergedClassName}
            >
                <AssistantUiStructuredList
                    expansionKey={messageScopeKey ? `${messageScopeKey}:${keyPrefix}` : undefined}
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
            {shouldRenderRuntimeCard && runtimeDescriptor && (
                <AssistantUiStructuredCard
                    title={t('assistantUi.runtimeStatus', { defaultValue: 'Runtime status' })}
                    className={styles.runtimeStatusCard}
                >
                    <div className={styles.runtimeStatusBody}>
                        <span className={styles.runtimeStatusDot} aria-hidden="true" />
                        <div className={styles.runtimeStatusTextCol}>
                            <div className={styles.runtimeStatusTitleRow}>
                                <strong className={styles.structuredPrimaryText}>{runtimeDescriptor.label}</strong>
                            </div>
                            <p className={styles.runtimeStatusDetail}>{runtimeDescriptor.detail}</p>
                            <span className={styles.runtimeStatusTrack} aria-hidden="true">
                                <span className={styles.runtimeStatusTrackBar} />
                            </span>
                        </div>
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

            {structured.events.length > 0 && (
                <AssistantUiStructuredCard
                    title={t('assistantUi.events', { defaultValue: 'Events' })}
                    count={structured.events.length}
                    className={styles.eventCard}
                >
                    <AssistantUiStructuredList
                        expansionKey={messageScopeKey ? `${messageScopeKey}:events` : undefined}
                        items={structured.events.map((event, index) => (
                            <li key={`event-${index}`} className={`${styles.structuredItem} ${styles.eventItem}`}>
                                <span className={styles.eventDot} aria-hidden="true" />
                                <div className={styles.structuredItemBody}>
                                    <span className={styles.eventText}>{event}</span>
                                </div>
                            </li>
                        ))}
                    />
                </AssistantUiStructuredCard>
            )}

            {structured.tools.length > 0 && (
                <AssistantUiStructuredCard title={t('assistantUi.tools', { defaultValue: 'Tools' })} count={structured.tools.length}>
                    {(() => {
                        const hasRunningTool = structured.tools.some((tool) => tool.status === 'running');
                        const toolItems = structured.tools.map((tool, index) => (
                            <li key={`tool-${index}`} className={`${styles.structuredItem} ${styles.toolEventItem}`}>
                                <span
                                    className={`${styles.toolEventMarker} ${getToolEventMarkerClass(tool.status)}`}
                                    aria-hidden="true"
                                />
                                <details className={styles.toolEventDetails} open={tool.status === 'running' ? true : undefined}>
                                    <summary className={styles.toolEventSummary}>
                                        <div className={styles.structuredItemMain}>
                                            <strong className={styles.structuredPrimaryText}>{tool.toolName}</strong>
                                            <span
                                                className={`${styles.statusPill} ${getToolStatusClass(tool.status)}`}
                                                aria-label={`tool status ${tool.status}`}
                                            >
                                                {getToolStatusLabel(tool.status, t)}
                                            </span>
                                        </div>
                                    </summary>
                                    <div className={`${styles.structuredItemBody} ${styles.toolEventBody}`}>
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
                                </details>
                            </li>
                        ));

                        if (structured.tools.length <= 1) {
                            return <AssistantUiStructuredList items={toolItems} />;
                        }

                        return (
                            <details className={styles.toolsGroupDetails} open={hasRunningTool}>
                                <summary className={styles.toolsGroupSummary}>
                                    <span className={styles.toolsGroupSummaryLabel}>
                                        {t('assistantUi.toolsExecuted', { count: structured.tools.length, defaultValue: `${structured.tools.length} tools executed` })}
                                    </span>
                                    <span className={styles.toolsGroupSummaryCount}>{structured.tools.length}</span>
                                </summary>
                                <div className={styles.toolsGroupBody}>
                                    <AssistantUiStructuredList
                                        expansionKey={messageScopeKey ? `${messageScopeKey}:tools` : undefined}
                                        items={toolItems}
                                    />
                                </div>
                            </details>
                        );
                    })()}
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
                                {getTaskStatusLabel(structured.task.status, t)}
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
                            <li key={`patch-${index}`} className={`${styles.structuredItem} ${styles.structuredItemTimeline} ${getPatchTimelineClass(patch.status)}`}>
                                <span className={styles.structuredTimelineDot} aria-hidden="true" />
                                <div className={styles.structuredItemBody}>
                                    <div className={styles.structuredItemMain}>
                                        <strong className={styles.structuredPrimaryText}>{patch.filePath}</strong>
                                        <span
                                            className={`${styles.statusPill} ${getPatchStatusClass(patch.status)}`}
                                            aria-label={`patch status ${patch.status}`}
                                        >
                                            {getPatchStatusLabel(patch.status, t)}
                                        </span>
                                    </div>
                                </div>
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

const MarkdownTextPart = ({ text }: { text: string }) => {
    const content = processMessageContent(text, {
        compactMarkdown: false,
        cleanNewlines: true,
    });
    if (!content) {
        return null;
    }

    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkBreaks]}
            components={{
                code(props) {
                    const { children, className } = props;
                    const languageClass = typeof className === 'string' ? className : '';
                    const isInline = !languageClass.includes('language-');
                    if (isInline) {
                        return (
                            <code {...props} className={className}>
                                {children}
                            </code>
                        );
                    }

                    return (
                        <pre className={styles.messageCodeBlock}>
                            <code className={languageClass}>
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
                },
            }}
        >
            {content}
        </ReactMarkdown>
    );
};

const AssistantUiMessage: React.FC<AssistantUiMessageProps> = ({ onApprovalDecision }) => {
    const { t, i18n } = useTranslation();
    const customValue = useAuiState((state) => state.message.metadata?.custom);
    const messageCreatedAt = useAuiState((state) => state.message.createdAt as Date | string | number | null | undefined);
    const messageText = useAuiState((state) => state.message.parts
        .map((part) => {
            const candidate = part as { type?: unknown; text?: unknown };
            if (candidate.type !== 'text' || typeof candidate.text !== 'string') {
                return '';
            }
            return candidate.text;
        })
        .filter((text) => text.length > 0)
        .join('\n\n')
        .trim());
    const structured = React.useMemo(
        () => readAssistantUiStructuredPayload(customValue),
        [customValue],
    );
    const messageScopeKey = React.useMemo(() => {
        if (!customValue || typeof customValue !== 'object') {
            return undefined;
        }
        const record = customValue as Record<string, unknown>;
        const turnId = typeof record.turnId === 'string' ? record.turnId.trim() : '';
        const source = typeof record.source === 'string' ? record.source.trim() : '';
        if (!turnId) {
            return undefined;
        }
        return source ? `${source}:${turnId}` : turnId;
    }, [customValue]);
    const timestampLabel = React.useMemo(
        () => formatAssistantUiTimestamp(messageCreatedAt, i18n.language),
        [i18n.language, messageCreatedAt],
    );
    const timestampIso = React.useMemo(
        () => toTimestampIsoString(messageCreatedAt),
        [messageCreatedAt],
    );
    const runtimeDescriptor = React.useMemo(
        () => getRuntimePhaseDescriptor(structured?.runtime, t),
        [structured?.runtime, t],
    );
    const runtimePendingLabel = (structured?.runtime?.pendingLabel ?? '').trim();
    const normalizedMessageText = messageText.toLowerCase();
    const isRuntimePlaceholderText = (
        messageText.length === 0
        || (runtimePendingLabel.length > 0 && messageText === runtimePendingLabel)
        || messageText === runtimeDescriptor?.label
        || normalizedMessageText === 'runtime'
        || normalizedMessageText.startsWith('runtime:')
        || normalizedMessageText.startsWith('structured update: runtime')
    );
    const isPendingOnlyAssistant = Boolean(runtimeDescriptor)
        && (structured?.tools.length ?? 0) === 0
        && (structured?.approvals.length ?? 0) === 0
        && !structured?.task
        && (structured?.patches.length ?? 0) === 0
        && isRuntimePlaceholderText;
    const suppressRuntimeCard = Boolean(runtimeDescriptor);

    return (
        <MessagePrimitive.Root className={styles.messageRow}>
            <MessagePrimitive.If user>
                <div className={`${styles.messageRow} ${styles.messageRowUser}`}>
                    <div className={styles.messageRail}>
                        <div className={`${styles.messageBubble} ${styles.userBubble}`}>
                            <div className={styles.messageMetaRow}>
                                <span className={styles.messageRoleLabel}>
                                    {t('assistantUi.userLabel', { defaultValue: 'User' })}
                                </span>
                                <span className={styles.messageMetaSpacer} />
                                {timestampLabel ? (
                                    <time className={styles.messageTimestamp} dateTime={timestampIso || undefined}>
                                        {timestampLabel}
                                    </time>
                                ) : null}
                                <MessagePrimitive.If hasContent>
                                    <ActionBarPrimitive.Root
                                        className={`${styles.messageActions} ${styles.messageActionsUser}`}
                                        autohide="never"
                                    >
                                        <ActionBarPrimitive.Copy
                                            className={styles.messageActionButton}
                                            copiedDuration={1400}
                                            title={t('chat.copyMessage')}
                                            aria-label={t('chat.copyMessage')}
                                        >
                                            <span className={styles.messageActionGlyph} aria-hidden="true">⧉</span>
                                        </ActionBarPrimitive.Copy>
                                    </ActionBarPrimitive.Root>
                                </MessagePrimitive.If>
                            </div>
                            <MessagePrimitive.Parts />
                        </div>
                    </div>
                </div>
            </MessagePrimitive.If>

            <MessagePrimitive.If assistant>
                <div className={`${styles.messageRow} ${styles.messageRowAssistant}`}>
                    <div className={styles.messageRail}>
                        <div className={`${styles.messageBubble} ${styles.assistantBubble}${isPendingOnlyAssistant ? ` ${styles.assistantBubblePending}` : ''}`}>
                            <div className={styles.messageMetaRow}>
                                <span className={styles.messageRoleLabel}>
                                    {t('assistantUi.assistantLabel', { defaultValue: 'CoworkAny' })}
                                </span>
                                <span className={styles.messageMetaSpacer} />
                                {runtimeDescriptor && !isPendingOnlyAssistant ? (
                                    <span className={`${styles.statusPill} ${runtimeDescriptor.tone === 'pending' ? styles.statusPillPending : styles.statusPillRunning}`}>
                                        {runtimeDescriptor.label}
                                    </span>
                                ) : null}
                                {timestampLabel ? (
                                    <time className={styles.messageTimestamp} dateTime={timestampIso || undefined}>
                                        {timestampLabel}
                                    </time>
                                ) : null}
                                <MessagePrimitive.If hasContent>
                                    <ActionBarPrimitive.Root
                                        className={`${styles.messageActions} ${styles.messageActionsAssistant}`}
                                        autohide="never"
                                    >
                                        <ActionBarPrimitive.Copy
                                            className={styles.messageActionButton}
                                            copiedDuration={1400}
                                            title={t('chat.copyMessage')}
                                            aria-label={t('chat.copyMessage')}
                                        >
                                            <span className={styles.messageActionGlyph} aria-hidden="true">⧉</span>
                                        </ActionBarPrimitive.Copy>
                                        <MessagePrimitive.If last>
                                            <ActionBarPrimitive.Reload
                                                className={styles.messageActionButton}
                                                title={t('common.retry')}
                                                aria-label={t('common.retry')}
                                            >
                                                <span className={styles.messageActionGlyph} aria-hidden="true">↻</span>
                                            </ActionBarPrimitive.Reload>
                                        </MessagePrimitive.If>
                                    </ActionBarPrimitive.Root>
                                </MessagePrimitive.If>
                            </div>
                            {isPendingOnlyAssistant ? (
                                <div className={styles.pendingResponseShimmer} aria-live="polite">
                                    <span className={styles.pendingResponseDot} />
                                    <span className={styles.pendingResponseDot} />
                                    <span className={styles.pendingResponseDot} />
                                    <span className={styles.pendingResponseLabel}>
                                        {runtimeDescriptor?.label || t('assistantUi.runtimeThinking', { defaultValue: 'Thinking' })}
                                    </span>
                                    <span className={styles.pendingResponseShimmerLine} aria-hidden="true" />
                                </div>
                            ) : null}
                            {!isPendingOnlyAssistant ? (
                                <MessagePrimitive.Parts
                                    components={{
                                        Text: MarkdownTextPart,
                                    }}
                                />
                            ) : null}
                            <AssistantStructuredDetails
                                structured={structured}
                                suppressRuntimeCard={suppressRuntimeCard}
                                messageScopeKey={messageScopeKey}
                                onApprovalDecision={onApprovalDecision}
                            />
                        </div>
                    </div>
                </div>
            </MessagePrimitive.If>

            <MessagePrimitive.If system>
                <div className={`${styles.messageRow} ${styles.messageRowSystem}`}>
                    <div className={styles.messageRail}>
                        <div className={`${styles.messageBubble} ${styles.systemBubble}`}>
                            <div className={styles.messageMetaRow}>
                                <span className={styles.messageRoleLabel}>
                                    {t('assistantUi.systemLabel', { defaultValue: 'System' })}
                                </span>
                                <span className={styles.messageMetaSpacer} />
                                {timestampLabel ? (
                                    <time className={styles.messageTimestamp} dateTime={timestampIso || undefined}>
                                        {timestampLabel}
                                    </time>
                                ) : null}
                            </div>
                            <MessagePrimitive.Parts
                                components={{
                                    Text: MarkdownTextPart,
                                }}
                            />
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
    const [isViewportScrolling, setIsViewportScrolling] = React.useState(false);
    const hideScrollbarTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const markViewportScrolling = React.useCallback(() => {
        setIsViewportScrolling(true);
        if (hideScrollbarTimerRef.current) {
            clearTimeout(hideScrollbarTimerRef.current);
        }
        hideScrollbarTimerRef.current = setTimeout(() => {
            setIsViewportScrolling(false);
            hideScrollbarTimerRef.current = null;
        }, 900);
    }, []);

    React.useEffect(() => {
        return () => {
            if (hideScrollbarTimerRef.current) {
                clearTimeout(hideScrollbarTimerRef.current);
                hideScrollbarTimerRef.current = null;
            }
        };
    }, []);

    return (
        <ThreadPrimitive.Root className={styles.threadRoot}>
            <ThreadPrimitive.Viewport
                className={`${styles.viewport}${isViewportScrolling ? ` ${styles.viewportScrolling}` : ''}`}
                onScroll={markViewportScrolling}
            >
                <ThreadPrimitive.Messages
                    components={{
                        Message: () => <AssistantUiMessage onApprovalDecision={onApprovalDecision} />,
                    }}
                />
            </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
    );
};
