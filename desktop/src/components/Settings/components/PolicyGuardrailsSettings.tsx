import { useEffect, useMemo, useState } from 'react';
import type { PolicyConfig } from '../../../types';
import styles from '../SettingsView.module.css';

interface PolicyGuardrailsSettingsProps {
    policyConfig: PolicyConfig;
    saving: boolean;
    onSave: (config: PolicyConfig) => Promise<void>;
}

const EFFECT_OPTIONS = [
    'secrets:read',
    'ui:control',
    'screen:capture',
    'filesystem:write',
    'network:outbound',
    'shell:write',
] as const;

function toMultiline(values: string[] | undefined): string {
    return (values ?? []).join('\n');
}

function parseMultiline(value: string): string[] {
    return Array.from(
        new Set(
            value
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean)
                .map((item) => item.toLowerCase())
        )
    ).sort();
}

export function PolicyGuardrailsSettings({
    policyConfig,
    saving,
    onSave,
}: PolicyGuardrailsSettingsProps) {
    const [allowDomains, setAllowDomains] = useState('');
    const [allowPaths, setAllowPaths] = useState('');
    const [blockCommands, setBlockCommands] = useState('');
    const [blockDomains, setBlockDomains] = useState('');
    const [blockPaths, setBlockPaths] = useState('');
    const [deniedEffects, setDeniedEffects] = useState<string[]>([]);

    useEffect(() => {
        setAllowDomains(toMultiline(policyConfig.allowlists?.domains));
        setAllowPaths(toMultiline(policyConfig.allowlists?.paths));
        setBlockCommands(toMultiline(policyConfig.blocklists?.commands));
        setBlockDomains(toMultiline(policyConfig.blocklists?.domains));
        setBlockPaths(toMultiline(policyConfig.blocklists?.paths));
        setDeniedEffects([...(policyConfig.deniedEffects ?? [])].sort());
    }, [policyConfig]);

    const summary = useMemo(
        () => ({
            allowDomains: parseMultiline(allowDomains).length,
            allowPaths: parseMultiline(allowPaths).length,
            blockedCommands: parseMultiline(blockCommands).length,
            blockedDomains: parseMultiline(blockDomains).length,
            blockedPaths: parseMultiline(blockPaths).length,
            deniedEffects: deniedEffects.length,
        }),
        [allowDomains, allowPaths, blockCommands, blockDomains, blockPaths, deniedEffects]
    );

    const toggleDeniedEffect = (effectType: string) => {
        setDeniedEffects((current) => (
            current.includes(effectType)
                ? current.filter((entry) => entry !== effectType)
                : [...current, effectType].sort()
        ));
    };

    const handleSave = async () => {
        await onSave({
            ...policyConfig,
            allowlists: {
                ...policyConfig.allowlists,
                domains: parseMultiline(allowDomains),
                paths: parseMultiline(allowPaths),
            },
            blocklists: {
                ...policyConfig.blocklists,
                commands: parseMultiline(blockCommands),
                domains: parseMultiline(blockDomains),
                paths: parseMultiline(blockPaths),
            },
            deniedEffects,
        });
    };

    return (
        <div className={styles.section} data-testid="policy-guardrails-settings">
            <div className={styles.sectionHeader}>
                <div>
                    <h3>Policy guardrails</h3>
                    <p>
                        Define host-level allowlists, blocklists, and denied effects for commands, domains, and workspace paths.
                    </p>
                </div>
                <div className={styles.inlineMeta}>
                    <span className={styles.scopeBadge}>{summary.allowDomains} allow domains</span>
                    <span className={styles.scopeBadge}>{summary.allowPaths} allow paths</span>
                    <span className={styles.scopeBadge}>{summary.blockedCommands} blocked commands</span>
                    <span className={styles.scopeBadge}>{summary.deniedEffects} denied effects</span>
                </div>
            </div>

            <div className={styles.policyGrid}>
                <PolicyTextarea
                    label="Domain allowlist"
                    hint="One hostname or domain fragment per line. Matching outbound requests are allowed into request scope automatically."
                    value={allowDomains}
                    onChange={setAllowDomains}
                    placeholder="api.example.com"
                    testId="policy-allow-domains"
                />
                <PolicyTextarea
                    label="Workspace path allowlist"
                    hint="One absolute path prefix per line. Matching filesystem and shell scopes can inherit these paths."
                    value={allowPaths}
                    onChange={setAllowPaths}
                    placeholder="D:\\projects\\trusted"
                    testId="policy-allow-paths"
                />
                <PolicyTextarea
                    label="Blocked commands"
                    hint="One base command per line. Requests using these commands are denied before approval."
                    value={blockCommands}
                    onChange={setBlockCommands}
                    placeholder="shutdown"
                    testId="policy-block-commands"
                />
                <PolicyTextarea
                    label="Blocked domains"
                    hint="One hostname or domain fragment per line. Matching outbound requests are denied."
                    value={blockDomains}
                    onChange={setBlockDomains}
                    placeholder="malicious.example"
                    testId="policy-block-domains"
                />
                <PolicyTextarea
                    label="Blocked paths"
                    hint="One absolute path prefix per line. Matching filesystem or shell requests are denied."
                    value={blockPaths}
                    onChange={setBlockPaths}
                    placeholder="C:\\Windows\\System32"
                    testId="policy-block-paths"
                />
            </div>

            <div className={styles.subsection}>
                <div className={styles.sectionHeader}>
                    <div>
                        <h3>Denied effects</h3>
                        <p>These effect types are rejected outright, even before approval UI appears.</p>
                    </div>
                </div>
                <div className={styles.optionGroup}>
                    {EFFECT_OPTIONS.map((effectType) => (
                        <button
                            key={effectType}
                            type="button"
                            className={styles.optionBtn}
                            aria-pressed={deniedEffects.includes(effectType)}
                            onClick={() => toggleDeniedEffect(effectType)}
                        >
                            {effectType}
                        </button>
                    ))}
                </div>
            </div>

            <div className={styles.inlineActions}>
                <button
                    type="button"
                    className={styles.verifyButton}
                    data-testid="policy-guardrails-save"
                    disabled={saving}
                    onClick={() => void handleSave()}
                >
                    {saving ? 'Saving policy...' : 'Save guardrails'}
                </button>
            </div>
        </div>
    );
}

function PolicyTextarea(props: {
    label: string;
    hint: string;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    testId: string;
}) {
    return (
        <label className={styles.field}>
            <span className={styles.label}>{props.label}</span>
            <textarea
                className={styles.textAreaField}
                value={props.value}
                onChange={(event) => props.onChange(event.target.value)}
                placeholder={props.placeholder}
                data-testid={props.testId}
                rows={5}
            />
            <span className={styles.hint}>{props.hint}</span>
        </label>
    );
}

export default PolicyGuardrailsSettings;
