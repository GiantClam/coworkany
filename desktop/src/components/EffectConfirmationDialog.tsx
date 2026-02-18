/**
 * Effect Confirmation Dialog
 *
 * Modal dialog for confirming potentially risky effects.
 * Shows effect details, risk level, and allows approve/deny.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import './EffectConfirmationDialog.css';

// ============================================================================
// Types
// ============================================================================

export type EffectType =
    | 'filesystem:read'
    | 'filesystem:write'
    | 'shell:read'
    | 'shell:write'
    | 'network:outbound'
    | 'secrets:read'
    | 'screen:capture'
    | 'ui:control';

export interface EffectRequest {
    requestId: string;
    sessionId: string;
    effectType: EffectType;
    description: string;
    details: Record<string, unknown>;
    riskLevel: number; // 1-100
    source: 'agent' | 'toolpack' | 'claude_skill';
    sourceId?: string;
}

export interface EffectConfirmationDialogProps {
    request: EffectRequest | null;
    open: boolean;
    onApprove: (requestId: string, remember: boolean) => void;
    onDeny: (requestId: string) => void;
    onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function getRiskColor(level: number): string {
    if (level >= 80) return '#dc2626'; // red
    if (level >= 60) return '#ea580c'; // orange
    if (level >= 40) return '#ca8a04'; // yellow
    return '#16a34a'; // green
}

function getEffectIcon(type: EffectType): string {
    switch (type) {
        case 'filesystem:read':
            return '📄';
        case 'filesystem:write':
            return '✏️';
        case 'shell:read':
            return '💻';
        case 'shell:write':
            return '⚡';
        case 'network:outbound':
            return '🌐';
        case 'secrets:read':
            return '🔑';
        case 'screen:capture':
            return '📸';
        case 'ui:control':
            return '🖱️';
        default:
            return '❓';
    }
}

// ============================================================================
// Component
// ============================================================================

export function EffectConfirmationDialog({
    request,
    open,
    onApprove,
    onDeny,
    onClose,
}: EffectConfirmationDialogProps) {
    const { t } = useTranslation();
    const [rememberChoice, setRememberChoice] = useState(false);

    if (!request) return null;

    const handleApprove = () => {
        onApprove(request.requestId, rememberChoice);
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
                <Dialog.Content className="effect-dialog-content">
                    {/* Header */}
                    <div className="effect-dialog-header">
                        <div className="effect-icon">
                            {getEffectIcon(request.effectType)}
                        </div>
                        <div className="effect-title-area">
                            <Dialog.Title className="effect-dialog-title">
                                {t('effect.permissionRequired')}
                            </Dialog.Title>
                            <Dialog.Description className="effect-dialog-description">
                                {request.description}
                            </Dialog.Description>
                        </div>
                    </div>

                    {/* Risk Indicator */}
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

                    {/* Details */}
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

                        {/* Effect-specific details */}
                        {Object.entries(request.details).map(([key, value]) => (
                            <div className="detail-row" key={key}>
                                <span className="detail-label">{key}:</span>
                                <span className="detail-value detail-code">
                                    {typeof value === 'string'
                                        ? value
                                        : JSON.stringify(value)}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Remember Checkbox */}
                    <label className="remember-checkbox">
                        <input
                            type="checkbox"
                            checked={rememberChoice}
                            onChange={(e) => setRememberChoice(e.target.checked)}
                        />
                        <span>{t('effect.rememberChoice')}</span>
                    </label>

                    {/* Actions */}
                    <div className="effect-dialog-actions">
                        <button
                            className={clsx('effect-btn', 'deny-btn')}
                            onClick={handleDeny}
                        >
                            {t('effect.deny')}
                        </button>
                        <button
                            className={clsx('effect-btn', 'approve-btn')}
                            onClick={handleApprove}
                        >
                            {t('effect.approve')}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

export default EffectConfirmationDialog;
