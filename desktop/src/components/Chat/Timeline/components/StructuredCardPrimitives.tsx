import React from 'react';
import styles from '../Timeline.module.css';

interface StructuredInfoSectionProps {
    label: string;
    lines?: string[];
    children?: React.ReactNode;
}

interface StructuredTaskListSectionProps {
    label: string;
    items: Array<{
        id: string;
        title: string;
        statusLabel: string;
        statusClassName: string;
        meta?: string;
    }>;
    footerText?: string;
}

interface StructuredInputRowProps {
    value: string;
    placeholder: string;
    submitLabel: string;
    disabled?: boolean;
    onChange: (value: string) => void;
    onSubmit: () => void;
}

export const StructuredInfoSection: React.FC<StructuredInfoSectionProps> = ({
    label,
    lines,
    children,
}) => {
    if ((!lines || lines.length === 0) && !children) {
        return null;
    }

    return (
        <section className={styles.structuredSection}>
            <span className={styles.structuredSectionLabel}>{label}</span>
            {lines && lines.length > 0 ? (
                <div className={styles.structuredSectionLines}>
                    {lines.map((line) => (
                        <span key={`${label}-${line}`}>{line}</span>
                    ))}
                </div>
            ) : null}
            {children}
        </section>
    );
};

export const StructuredTaskListSection: React.FC<StructuredTaskListSectionProps> = ({
    label,
    items,
    footerText,
}) => {
    if (items.length === 0 && !footerText) {
        return null;
    }

    return (
        <section className={styles.structuredSection}>
            <span className={styles.structuredSectionLabel}>{label}</span>
            <div className={styles.taskListInCard}>
                {items.map((item) => (
                    <div key={item.id} className={styles.taskListRow}>
                        <div className={styles.taskListTitleRow}>
                            <span className={styles.taskListTitle}>{item.title}</span>
                            <span className={`${styles.taskListStatus} ${item.statusClassName}`}>
                                {item.statusLabel}
                            </span>
                        </div>
                        {item.meta ? <span className={styles.taskListDeps}>{item.meta}</span> : null}
                    </div>
                ))}
                {footerText ? <span className={styles.taskListDeps}>{footerText}</span> : null}
            </div>
        </section>
    );
};

export const StructuredInputRow: React.FC<StructuredInputRowProps> = ({
    value,
    placeholder,
    submitLabel,
    disabled,
    onChange,
    onSubmit,
}) => (
    <div className={styles.structuredInputRow}>
        <input
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            className={styles.structuredInput}
        />
        <button
            type="button"
            className={styles.structuredActionButton}
            onClick={onSubmit}
            disabled={disabled}
        >
            {submitLabel}
        </button>
    </div>
);
