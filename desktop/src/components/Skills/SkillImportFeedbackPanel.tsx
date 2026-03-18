import type { CSSProperties } from 'react';
import type { SkillImportFeedback } from '../../lib/skillImport';

type SkillImportFeedbackPanelProps = {
    feedback: SkillImportFeedback | SkillImportFeedback[] | null;
    title?: string;
};

const panelStyle: CSSProperties = {
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-panel)',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
};

const sectionTitleStyle: CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
};

const itemStyle: CSSProperties = {
    fontSize: '13px',
    color: 'var(--text-primary)',
    wordBreak: 'break-word',
};

const codeStyle: CSSProperties = {
    fontFamily: 'var(--font-code)',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    background: 'var(--bg-element)',
    borderRadius: '6px',
    padding: '6px 8px',
};

function renderAttemptLabel(attempt: SkillImportFeedback['installResults'][number]): string {
    return attempt.command || attempt.url || attempt.label;
}

function renderPlanLabel(plan: NonNullable<SkillImportFeedback['dependencyCheck']>['installPlans'][number]): string {
    return plan.command || plan.url || plan.label;
}

export function SkillImportFeedbackPanel({
    feedback,
    title = 'Dependency install results',
}: SkillImportFeedbackPanelProps) {
    const items = Array.isArray(feedback) ? feedback.filter(Boolean) : feedback ? [feedback] : [];
    if (items.length === 0) return null;

    return (
        <div style={panelStyle}>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
            {items.map((item, index) => (
                <div
                    key={`${item.skillId ?? 'skill'}-${index}`}
                    style={{
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        padding: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                        background: 'var(--bg-app)',
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            {item.skillId || `Import #${index + 1}`}
                        </div>
                        <div style={{ fontSize: '12px', color: item.success ? 'var(--status-success)' : 'var(--status-error)' }}>
                            {item.success ? 'Imported' : 'Import failed'}
                        </div>
                    </div>

                    {item.error && (
                        <div style={{ ...itemStyle, color: 'var(--status-error)' }}>{item.error}</div>
                    )}

                    {item.warnings.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={sectionTitleStyle}>Warnings</div>
                            {item.warnings.map((warning) => (
                                <div key={warning} style={{ ...itemStyle, color: 'var(--status-warning)' }}>
                                    {warning}
                                </div>
                            ))}
                        </div>
                    )}

                    {item.dependencyCheck && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={sectionTitleStyle}>Dependency status</div>
                            <div style={itemStyle}>
                                {item.dependencyCheck.satisfied
                                    ? 'All declared dependencies are currently satisfied.'
                                    : 'Some declared dependencies are still missing.'}
                            </div>
                            {!item.dependencyCheck.platformEligible && (
                                <div style={{ ...itemStyle, color: 'var(--status-warning)' }}>
                                    This skill targets a different operating system.
                                </div>
                            )}
                            {item.dependencyCheck.missing.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {item.dependencyCheck.missing.map((missing) => (
                                        <div key={missing} style={codeStyle}>{missing}</div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {item.installResults.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={sectionTitleStyle}>Installer attempts</div>
                            {item.installResults.map((attempt, attemptIndex) => (
                                <div key={`${attempt.label}-${attemptIndex}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <div style={{ ...itemStyle, color: attempt.success ? 'var(--status-success)' : 'var(--text-primary)' }}>
                                        {attempt.success ? 'Success' : attempt.skipped ? 'Skipped' : 'Failed'}: {attempt.label}
                                    </div>
                                    <div style={codeStyle}>{renderAttemptLabel(attempt)}</div>
                                    {attempt.error && (
                                        <div style={{ ...itemStyle, color: 'var(--status-error)' }}>{attempt.error}</div>
                                    )}
                                    {attempt.targetPath && (
                                        <div style={{ ...itemStyle, color: 'var(--text-secondary)' }}>
                                            Installed to: {attempt.targetPath}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {item.dependencyCheck && item.dependencyCheck.installPlans.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={sectionTitleStyle}>Available installers</div>
                            {item.dependencyCheck.installPlans.map((plan, planIndex) => (
                                <div key={`${plan.label}-${planIndex}`} style={codeStyle}>
                                    {renderPlanLabel(plan)}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
