import { useEffect, useState } from 'react';
import type { SoulProfile } from '../../types';
import styles from './SettingsView.module.css';

interface SoulEditorProps {
    profile: SoulProfile;
    onSave: (profile: SoulProfile) => Promise<void> | void;
    saving?: boolean;
}

function toMultiline(values?: string[]): string {
    return (values ?? []).join('\n');
}

function fromMultiline(value: string): string[] {
    return value
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean);
}

export function SoulEditor({ profile, onSave, saving = false }: SoulEditorProps) {
    const [identity, setIdentity] = useState('');
    const [stablePreferences, setStablePreferences] = useState('');
    const [workingStyle, setWorkingStyle] = useState('');
    const [longTermGoals, setLongTermGoals] = useState('');
    const [avoid, setAvoid] = useState('');
    const [outputRules, setOutputRules] = useState('');

    useEffect(() => {
        setIdentity(profile.identity ?? '');
        setStablePreferences(toMultiline(profile.stablePreferences));
        setWorkingStyle(toMultiline(profile.workingStyle));
        setLongTermGoals(toMultiline(profile.longTermGoals));
        setAvoid(toMultiline(profile.avoid));
        setOutputRules(toMultiline(profile.outputRules));
    }, [profile]);

    const handleSave = async () => {
        await onSave({
            version: 1,
            identity: identity.trim(),
            stablePreferences: fromMultiline(stablePreferences),
            workingStyle: fromMultiline(workingStyle),
            longTermGoals: fromMultiline(longTermGoals),
            avoid: fromMultiline(avoid),
            outputRules: fromMultiline(outputRules),
            updatedAt: profile.updatedAt,
        });
    };

    return (
        <div>
            <div className={styles.sectionHeader}>
                <div>
                    <h3>Soul Profile</h3>
                    <p>
                        Stable preferences only. This profile is injected ahead of workspace policy,
                        current-session context, and retrieved vault memory.
                    </p>
                </div>
            </div>

            <div className={styles.stack}>
                <label className={styles.field}>
                    <span className={styles.label}>Identity</span>
                    <textarea
                        className={styles.textAreaField}
                        value={identity}
                        onChange={(event) => setIdentity(event.target.value)}
                        placeholder="Who you are, what role you want the agent to take, and any stable self-description."
                    />
                </label>

                <div className={styles.searchGrid}>
                    <label className={styles.field}>
                        <span className={styles.label}>Stable Preferences</span>
                        <textarea
                            className={styles.textAreaField}
                            value={stablePreferences}
                            onChange={(event) => setStablePreferences(event.target.value)}
                            placeholder="One preference per line."
                        />
                    </label>

                    <label className={styles.field}>
                        <span className={styles.label}>Working Style</span>
                        <textarea
                            className={styles.textAreaField}
                            value={workingStyle}
                            onChange={(event) => setWorkingStyle(event.target.value)}
                            placeholder="Preferred pace, rigor, communication style, review style."
                        />
                    </label>
                </div>

                <div className={styles.searchGrid}>
                    <label className={styles.field}>
                        <span className={styles.label}>Long-Term Goals</span>
                        <textarea
                            className={styles.textAreaField}
                            value={longTermGoals}
                            onChange={(event) => setLongTermGoals(event.target.value)}
                            placeholder="Persistent goals, not one-off tasks."
                        />
                    </label>

                    <label className={styles.field}>
                        <span className={styles.label}>Do Not Do</span>
                        <textarea
                            className={styles.textAreaField}
                            value={avoid}
                            onChange={(event) => setAvoid(event.target.value)}
                            placeholder="Taboos, non-negotiables, unacceptable behaviors."
                        />
                    </label>
                </div>

                <label className={styles.field}>
                    <span className={styles.label}>Output Rules</span>
                    <textarea
                        className={styles.textAreaField}
                        value={outputRules}
                        onChange={(event) => setOutputRules(event.target.value)}
                        placeholder="Formatting, citation, language, or delivery rules that should stay stable."
                    />
                </label>
            </div>

            <button
                type="button"
                className={`${styles.verifyButton} ${styles.sectionCta}`}
                onClick={() => void handleSave()}
                disabled={saving}
            >
                {saving ? 'Saving soul...' : 'Save soul profile'}
            </button>
        </div>
    );
}
