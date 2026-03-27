import React from 'react';
import styles from '../Timeline.module.css';
import type { AssistantTurnItem } from '../../../../types';
import { sanitizeDisplayText } from '../textSanitizer';
import { buildAssistantTurnCardSchemas } from './assistantTurnCardSchema';
import { AssistantTurnCardStack } from './AssistantTurnCardStack';

type StepTone = 'neutral' | 'running' | 'success' | 'failed';

interface AssistantTurnBlockProps {
    item: AssistantTurnItem;
    pendingLabel?: string;
    onTaskCollaborationSubmit?: (input: {
        taskId?: string;
        cardId: string;
        actionId?: string;
        value: string;
    }) => void;
}

function stepToneClass(tone: StepTone): string {
    switch (tone) {
        case 'running':
            return styles.assistantTurnStepRunning;
        case 'success':
            return styles.assistantTurnStepSuccess;
        case 'failed':
            return styles.assistantTurnStepFailed;
        default:
            return styles.assistantTurnStepNeutral;
    }
}

const AssistantTurnBlockComponent: React.FC<AssistantTurnBlockProps> = ({
    item,
    pendingLabel,
    onTaskCollaborationSubmit,
}) => {
    const visibleSteps = (item.steps || []).filter((step) => {
        const normalizedTitle = sanitizeDisplayText(step.title).toLowerCase();
        return normalizedTitle !== 'task plan'
            && normalizedTitle !== 'execute'
            && normalizedTitle !== 'summary';
    });
    const cards = React.useMemo(
        () => buildAssistantTurnCardSchemas(item, pendingLabel),
        [item, pendingLabel],
    );

    return (
        <div className={styles.assistantTurnBlock}>
            <div className={styles.assistantThreadBrand}>
                <span className={styles.assistantThreadBrandMark} aria-hidden={true}>✶</span>
                <span className={styles.assistantThreadBrandName}>coworkany</span>
                <span className={styles.assistantThreadBrandChip}>Lite</span>
            </div>

            {visibleSteps.length > 0 ? (
                <div className={styles.assistantTurnSteps}>
                    {visibleSteps.map((step) => (
                        <div key={step.id} className={`${styles.assistantTurnStep} ${stepToneClass(step.tone)}`}>
                            <span className={styles.assistantTurnStepDot} aria-hidden={true} />
                            <div className={styles.assistantTurnStepText}>
                                <span className={styles.assistantTurnStepTitle}>{sanitizeDisplayText(step.title)}</span>
                                {step.detail ? <span className={styles.assistantTurnStepDetail}>{step.detail}</span> : null}
                            </div>
                        </div>
                    ))}
                </div>
            ) : null}

            <AssistantTurnCardStack
                cards={cards}
                onTaskCollaborationSubmit={onTaskCollaborationSubmit}
            />
        </div>
    );
};

export const AssistantTurnBlock = React.memo(AssistantTurnBlockComponent);
AssistantTurnBlock.displayName = 'AssistantTurnBlock';
