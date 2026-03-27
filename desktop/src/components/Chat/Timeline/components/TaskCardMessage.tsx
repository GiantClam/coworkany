import React from 'react';
import styles from '../Timeline.module.css';
import type { TaskCardItem } from '../../../../types';
import { StructuredMessageCard } from './StructuredMessageCard';
import { buildTaskCardViewModel, type TaskCardViewModel } from './taskCardViewModel';
import {
    StructuredButtonRow,
    StructuredInfoSection,
    StructuredInputRow,
    StructuredTaskListSection,
} from './StructuredCardPrimitives';

interface TaskCardMessageProps {
    item?: TaskCardItem;
    viewModel?: TaskCardViewModel;
    layout?: 'timeline' | 'board';
    onTaskCollaborationSubmit?: (input: {
        taskId?: string;
        cardId: string;
        actionId?: string;
        value: string;
    }) => void;
}

const TaskCardMessageComponent: React.FC<TaskCardMessageProps> = ({
    item,
    viewModel,
    layout = 'timeline',
    onTaskCollaborationSubmit,
}) => {
    const [inputValue, setInputValue] = React.useState('');
    const model = React.useMemo(
        () => viewModel ?? (item ? buildTaskCardViewModel(item, { layout }) : null),
        [item, layout, viewModel],
    );
    const collaboration = model?.collaboration;

    React.useEffect(() => {
        if (!model) {
            return;
        }
        setInputValue('');
    }, [model?.collaboration?.actionId, model?.id]);

    const handleSubmit = React.useCallback(() => {
        const value = inputValue.trim();
        if (!value || !collaboration?.input || !model) {
            return;
        }
        onTaskCollaborationSubmit?.({
            taskId: model.taskId,
            cardId: model.id,
            actionId: collaboration.actionId,
            value,
        });
        setInputValue('');
    }, [collaboration?.actionId, collaboration?.input, inputValue, model, onTaskCollaborationSubmit]);

    const submitCollaborationValue = React.useCallback((value: string) => {
        const normalizedValue = value.trim();
        if (!normalizedValue || !model) {
            return;
        }
        onTaskCollaborationSubmit?.({
            taskId: model.taskId,
            cardId: model.id,
            actionId: collaboration?.actionId,
            value: normalizedValue,
        });
    }, [collaboration?.actionId, model, onTaskCollaborationSubmit]);

    if (!model) {
        return null;
    }

    if (model.presentation === 'hidden') {
        return null;
    }

    return (
        <StructuredMessageCard
            kind={model.summary.kind}
            hideHeader={model.presentation === 'input_panel'}
            kicker={model.summary.kicker}
            title={model.summary.title}
            subtitle={model.summary.subtitle}
            statusLabel={model.summary.statusLabel}
            statusTone={model.summary.statusTone}
            className={model.layout === 'board' ? styles.taskCardBoardLayout : undefined}
        >
            {model.workflowLabel ? (
                <span className={styles.taskWorkflowLabel}>{model.workflowLabel}</span>
            ) : null}

            <div className={styles.taskCardContent}>
                {model.taskSection ? (
                    <StructuredTaskListSection
                        label={model.taskSection.label}
                        items={model.taskSection.items.map((task) => ({
                            id: `${model.id}-${task.id}`,
                            title: task.title,
                            statusLabel: task.statusLabel,
                            statusClassName: styles[`taskListStatus${task.statusKey}`],
                            meta: task.dependenciesText,
                        }))}
                        footerText={model.taskSection.hiddenCount > 0 ? `+${model.taskSection.hiddenCount} more tasks` : undefined}
                    />
                ) : null}

                {model.sections.length > 0 ? (
                    <div className={styles.taskCardSections}>
                        {model.sections.map((section) => (
                            <StructuredInfoSection
                                key={`${model.id}-${section.label}`}
                                label={section.label}
                                lines={section.lines}
                            />
                        ))}
                    </div>
                ) : null}

                {model.resultSection ? (
                    <StructuredInfoSection
                        label={model.resultSection.label}
                        lines={model.resultSection.lines}
                    />
                ) : null}

                {collaboration ? (
                    <section className={styles.taskCardCollaboration}>
                        <span className={styles.structuredSectionLabel}>Collaboration</span>
                        <div className={styles.taskCardCollaborationBody}>
                            <strong className={styles.taskCardCollaborationTitle}>{collaboration.title}</strong>
                            {collaboration.description ? (
                                <p className={styles.taskCardSubtitle}>{collaboration.description}</p>
                            ) : null}
                            <StructuredInfoSection label="Questions" lines={collaboration.questions} />
                            <StructuredInfoSection label="Instructions" lines={collaboration.instructions} />
                            {!collaboration.input && collaboration.choices && collaboration.choices.length > 0 ? (
                                <StructuredButtonRow
                                    buttons={collaboration.choices.map((choice) => ({
                                        key: choice.value,
                                        label: choice.label,
                                    }))}
                                    onPress={submitCollaborationValue}
                                />
                            ) : null}
                            {!collaboration.input && collaboration.action ? (
                                <StructuredButtonRow
                                    buttons={[{
                                        key: collaboration.action.label,
                                        label: collaboration.action.label,
                                    }]}
                                    onPress={submitCollaborationValue}
                                />
                            ) : null}
                            {collaboration.input ? (
                                <StructuredInputRow
                                    value={inputValue}
                                    onChange={setInputValue}
                                    placeholder={collaboration.input.placeholder}
                                    submitLabel={collaboration.input.submitLabel}
                                    onSubmit={handleSubmit}
                                    disabled={inputValue.trim().length === 0}
                                />
                            ) : null}
                        </div>
                    </section>
                ) : null}

            </div>
        </StructuredMessageCard>
    );
};

export const TaskCardMessage = React.memo(TaskCardMessageComponent);

TaskCardMessage.displayName = 'TaskCardMessage';
