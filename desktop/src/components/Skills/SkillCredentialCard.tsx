import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SkillRecord } from '../../hooks/useSkills';
import { useSkills } from '../../hooks/useSkills';
import {
    deleteSkillCredentials,
    getSkillCredentials,
    saveSkillCredentials,
    syncEnabledSkillEnvironment,
} from '../../lib/skillCredentials';

interface SkillCredentialCardProps {
    skillId: string;
    skillName: string;
    requiredEnv: string[];
    source?: string;
    showLifecycleHint?: boolean;
}

export const SkillCredentialCard: React.FC<SkillCredentialCardProps> = ({
    skillId,
    skillName,
    requiredEnv,
    source,
    showLifecycleHint = true,
}) => {
    const { t } = useTranslation();
    const { skills } = useSkills({ autoRefresh: true });
    const [draft, setDraft] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<string | null>(null);

    const normalizedEnv = useMemo(
        () => requiredEnv
            .map((envVar) => envVar.trim())
            .filter((envVar, index, list) => envVar.length > 0 && list.indexOf(envVar) === index),
        [requiredEnv]
    );

    const installedSkill = useMemo(
        () => skills.find((skill) => skill.manifest.id === skillId),
        [skillId, skills]
    );

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            setStatus(null);
            try {
                const saved = await getSkillCredentials(skillId);
                if (cancelled) {
                    return;
                }
                setDraft(
                    Object.fromEntries(normalizedEnv.map((envVar) => [envVar, saved[envVar] ?? '']))
                );
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, [normalizedEnv, skillId]);

    if (normalizedEnv.length === 0) {
        return null;
    }

    const saveCredentials = async () => {
        setLoading(true);
        setStatus(null);
        try {
            await saveSkillCredentials(skillId, draft);
            await syncEnabledSkillEnvironment(skills as Pick<SkillRecord, 'enabled' | 'manifest'>[]);
            setStatus(t('skills.credentialsSaved'));
        } finally {
            setLoading(false);
        }
    };

    const clearCredentials = async () => {
        setLoading(true);
        setStatus(null);
        try {
            await deleteSkillCredentials(skillId);
            setDraft(Object.fromEntries(normalizedEnv.map((envVar) => [envVar, ''])));
            await syncEnabledSkillEnvironment(skills as Pick<SkillRecord, 'enabled' | 'manifest'>[]);
            setStatus(t('skills.credentialsCleared'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            width: '100%',
            padding: '14px',
            borderRadius: '16px',
            border: '1px solid rgba(118, 184, 255, 0.18)',
            background: 'linear-gradient(180deg, rgba(118, 184, 255, 0.08), rgba(118, 184, 255, 0.03))',
        }}>
            <div style={{ display: 'grid', gap: '4px' }}>
                <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                    {skillName} · {t('skills.credentialsTitle')}
                </strong>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {t('skills.credentialsHint')}
                </div>
                {source && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Source: {source}
                    </div>
                )}
            </div>

            {normalizedEnv.map((envVar) => (
                <label key={envVar} style={{ display: 'grid', gap: '6px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>{envVar}</span>
                    <input
                        className="input-field"
                        type="password"
                        value={draft[envVar] ?? ''}
                        placeholder={t('skills.credentialsPlaceholder', { envVar })}
                        onChange={(event) => {
                            const value = event.target.value;
                            setDraft((current) => ({ ...current, [envVar]: value }));
                            setStatus(null);
                        }}
                    />
                </label>
            ))}

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-primary" onClick={() => void saveCredentials()} disabled={loading}>
                    {t('common.save')}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => void clearCredentials()} disabled={loading}>
                    {t('skills.clearCredentials')}
                </button>
                {status && (
                    <span style={{ fontSize: '12px', color: 'var(--status-success)' }}>{status}</span>
                )}
            </div>

            {showLifecycleHint && installedSkill && !installedSkill.enabled && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {t('skills.credentialsDisabledHint')}
                </div>
            )}
        </div>
    );
};
