import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import './EffectConfirmationDialog.css';

export type EffectType =
    | 'filesystem:read'
    | 'filesystem:write'
    | 'shell:read'
    | 'shell:write'
    | 'network:outbound'
    | 'secrets:read'
    | 'screen:capture'
    | 'ui:control';

export type ApprovalMode = 'once' | 'session' | 'permanent';

export interface EffectRequest {
    requestId: string;
    effectType: EffectType;
    description: string;
    details: Record<string, unknown>;
    riskLevel: number;
    source: 'agent' | 'toolpack' | 'claude_skill';
    sourceId?: string;
    policy?: string;
    allowedApprovalModes?: ApprovalMode[];
    commandBase?: string;
}

export interface EffectConfirmationDialogProps {
    request: EffectRequest | null;
    open: boolean;
    onApprove: (requestId: string, approvalMode: ApprovalMode) => void;
    onDeny: (requestId: string) => void;
    onClose: () => void;
}

function getRiskColor(level: number): string {
    if (level >= 80) return '#dc2626';
    if (level >= 60) return '#ea580c';
    if (level >= 40) return '#ca8a04';
    return '#16a34a';
}

function getEffectIcon(type: EffectType): string {
    switch (type) {
        case 'filesystem:read':
            return 'Read';
        case 'filesystem:write':
            return 'Write';
        case 'shell:read':
            return 'CLI';
        case 'shell:write':
            return 'Exec';
        case 'network:outbound':
            return 'Net';
        case 'secrets:read':
            return 'Secret';
        case 'screen:capture':
            return 'Screen';
        case 'ui:control':
            return 'UI';
        default:
            return 'Effect';
    }
}

function getModeLabel(mode: ApprovalMode, commandBase?: string): string {
    if (mode === 'permanent') {
        return commandBase ? `Always allow ${commandBase}` : 'Always allow';
    }
    if (mode === 'session') {
        return 'Allow this session';
    }
    return 'Allow once';
}

export function EffectConfirmationDialog({
    request,
    open,
    onApprove,
    onDeny,
    onClose,
}: EffectConfirmationDialogProps) {
    const { t } = useTranslation();
    const allowedModes = useMemo<ApprovalMode[]>(
        () => request?.allowedApprovalModes?.length ? request.allowedApprovalModes : ['once'],
        [request]
    );
    const [approvalMode, setApprovalMode] = useState<ApprovalMode>(allowedModes[0] ?? 'once');

    useEffect(() => {
        setApprovalMode(allowedModes[0] ?? 'once');
    }, [allowedModes, request?.requestId]);

    if (!request) return null;

    const handleApprove = () => {
        onApprove(request.requestId, approvalMode);
        onClose();
    };

    const handleDeny = () => {
        onDeny(request.requestId);
        onClose();
    };

    const riskColor = getRiskColor(request.riskLevel);
    const riskLabelKey = request.riskLevel >= 80 ? 'riskCritical' : request.riskLevel >= 60 ? 'riskHigh' : request.riskLevel >= 40 ? 'riskMedium' : 'riskLow';
    const riskLabel = t(`effect.${riskLabelKey}`);

    return (
        <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="effect-dialog-overlay" />
                <Dialog.Content className="effect-dialog-content" data-testid="effect-confirmation-dialog">
                    <div className="effect-dialog-header">
                        <div className="effect-icon">{getEffectIcon(request.effectType)}</div>
                        <div className="effect-title-area">
                            <Dialog.Title className="effect-dialog-title">
                                {t('effect.permissionRequired')}
                            </Dialog.Title>
                            <Dialog.Description className="effect-dialog-description">
                                {request.description}
                            </Dialog.Description>
                        </div>
                    </div>

                    <div className="effect-risk-section">
                        <div className="risk-label">{t('effect.riskLevel')}</div>
                        <div className="risk-meter">
                            <div
                                className="risk-fill"
                                style={{
                                    width: `${request.riskLevel}%`,
                                    backgroundColor: riskColor,
                                }}
                            />
                        </div>
                        <div className="risk-value" style={{ color: riskColor }}>
                            {riskLabel} ({request.riskLevel}/100)
                        </div>
                    </div>

                    <div className="effect-details">
                        <div className="detail-row">
                            <span className="detail-label">{t('effect.effectType')}:</span>
                            <span className="detail-value">{request.effectType}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">{t('effect.source')}:</span>
                            <span className="detail-value">
                                {request.source}
                                {request.sourceId && ` (${request.sourceId})`}
                            </span>
                        </div>
                        {request.commandBase && (
                            <div className="detail-row">
                                <span className="detail-label">command:</span>
                                <span className="detail-value detail-code">{request.commandBase}</span>
                            </div>
                        )}
                        {Object.entries(request.details).map(([key, value]) => (
                            <div className="detail-row" key={key}>
                                <span className="detail-label">{key}:</span>
                                <span className="detail-value detail-code">
                                    {typeof value === 'string' ? value : JSON.stringify(value)}
                                </span>
                            </div>
                        ))}
                    </div>

                    <div className="approval-mode-group">
                        <div className="approval-mode-label">Approval scope</div>
                        <div className="approval-mode-options">
                            {allowedModes.map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    data-testid={`approval-mode-${mode}`}
                                    className={clsx('approval-mode-option', approvalMode === mode && 'is-selected')}
                                    onClick={() => setApprovalMode(mode)}
                                >
                                    {getModeLabel(mode, request.commandBase)}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="effect-dialog-actions">
                        <button data-testid="effect-deny" className={clsx('effect-btn', 'deny-btn')} onClick={handleDeny}>
                            {t('effect.deny')}
                        </button>
                        <button data-testid="effect-approve" className={clsx('effect-btn', 'approve-btn')} onClick={handleApprove}>
                            {t('effect.approve')}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

export default EffectConfirmationDialog;
