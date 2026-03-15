/**
 * ToolCard Component
 *
 * Displays tool call item with expandable details
 */

import React, { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import styles from '../Timeline.module.css';
import type { ToolCallItem } from '../../../../types';
import { MarkdownContent } from '../../../Common/MarkdownContent';
import { toast } from '../../../Common/ToastProvider';

interface ToolCardProps {
    item: ToolCallItem;
}

interface GeneratedFileResult {
    filePath: string;
    size?: number;
}

function isLikelyLocalPath(value: unknown): value is string {
    return typeof value === 'string'
        && value.length > 0
        && !/^https?:\/\//i.test(value)
        && /[\\/]/.test(value);
}

function extractGeneratedFileResult(
    toolName: string,
    structuredResult: Record<string, any> | null
): GeneratedFileResult | null {
    if (!structuredResult || structuredResult.success !== true) {
        return null;
    }

    const pathCandidate = [
        structuredResult.path,
        structuredResult.filePath,
        structuredResult.outputPath,
        structuredResult.savedPath,
    ].find(isLikelyLocalPath);

    if (!pathCandidate) {
        return null;
    }

    const toolLooksLikeFileWrite = toolName === 'write_to_file'
        || toolName === 'replace_file_content'
        || toolName === 'export_conversation';

    if (!toolLooksLikeFileWrite && typeof structuredResult.size !== 'number') {
        return null;
    }

    return {
        filePath: pathCandidate,
        size: typeof structuredResult.size === 'number' ? structuredResult.size : undefined,
    };
}

const ToolCardComponent: React.FC<ToolCardProps> = ({ item }) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const [openingFolder, setOpeningFolder] = useState(false);

    const structuredResult = useMemo(() => {
        if (!item.result || typeof item.result !== 'string') {
            return typeof item.result === 'object' ? item.result as Record<string, any> : null;
        }

        try {
            return JSON.parse(item.result) as Record<string, any>;
        } catch {
            return null;
        }
    }, [item.result]);

    const generatedFile = useMemo(
        () => extractGeneratedFileResult(item.toolName, structuredResult),
        [item.toolName, structuredResult]
    );

    const commandLearningSummary = useMemo(() => {
        if (!structuredResult) return null;

        const systemContext = structuredResult.systemContext as Record<string, any> | undefined;
        const commandKnowledge = structuredResult.commandKnowledge as Record<string, any> | undefined;
        const learningPath = structuredResult.learningPath as Record<string, any> | undefined;
        const baseCommand = structuredResult.baseCommand as string | undefined;

        if (!systemContext && !commandKnowledge && !learningPath && !baseCommand) {
            return null;
        }

        return {
            baseCommand,
            platformName: systemContext?.platformName as string | undefined,
            shellFamily: systemContext?.shellFamily as string | undefined,
            category: commandKnowledge?.category as string | undefined,
            reason: commandKnowledge?.reason as string | undefined,
            helpHints: Array.isArray(commandKnowledge?.helpHints) ? commandKnowledge.helpHints as string[] : [],
            sequence: Array.isArray(learningPath?.sequence) ? learningPath.sequence as string[] : [],
            executable: structuredResult.resolved_executable as string | undefined,
        };
    }, [structuredResult]);

    // Detect "soft" errors in text results (e.g. "## Search Failed")
    const isSoftError = useMemo(() => {
        if (item.status === 'failed') return true;
        if (typeof item.result === 'string') {
            return item.result.includes('Search Failed') ||
                item.result.startsWith('Error:');
        }
        return false;
    }, [item.status, item.result]);

    const displayStatus = isSoftError ? 'failed' : item.status;

    // Generate a preview string
    const preview = useMemo(() => {
        if (!item.result) return '';
        const str = typeof item.result === 'string' ? item.result : JSON.stringify(item.result);
        // Clean up markdown headers for preview
        const cleaned = str.replace(/[#*`]/g, '').replace(/\s+/g, ' ').trim();
        return cleaned.length > 60 ? cleaned.slice(0, 60) + '...' : cleaned;
    }, [item.result]);

    const handleOpenFolder = async () => {
        if (!generatedFile || openingFolder) return;

        try {
            setOpeningFolder(true);
            await invoke('open_local_path', {
                input: {
                    path: generatedFile.filePath,
                    revealParent: true,
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(t('chat.openFolderFailedTitle'), message);
        } finally {
            setOpeningFolder(false);
        }
    };

    return (
        <div className={styles.timelineItem}>
            <div className={styles.toolCard} data-status={displayStatus}>
                <div className={styles.toolHeader} onClick={() => setExpanded(!expanded)}>
                    <div className={styles.toolInfo}>
                        <span className={styles.toolIcon}>🔧</span>
                        <strong className={styles.toolName}>{item.toolName}</strong>
                        {(item.repeatCount ?? 1) > 1 && (
                            <span className={styles.toolRepeatBadge}>x{item.repeatCount}</span>
                        )}
                        {!expanded && preview && (
                            <span className={styles.toolPreview}>
                                {preview}
                            </span>
                        )}
                    </div>
                    <div className={styles.toolStatus}>
                        <span className={styles.statusDot} data-status={displayStatus} />
                        <span>{displayStatus.toUpperCase()}</span>
                    </div>
                </div>
                {expanded && (
                    <div className={styles.toolBody}>
                        {item.args && (
                            <div className={styles.inputSection}>
                                <div className={styles.sectionLabel}>{t('chat.input')}</div>
                                <pre className={styles.codeBlock}>
                                    {JSON.stringify(item.args, null, 2)}
                                </pre>
                            </div>
                        )}
                        {item.result && (
                            <div className={styles.outputSection}>
                                <div className={styles.sectionLabel}>{t('chat.output')}</div>
                                {generatedFile && (
                                    <div className={styles.generatedFilePanel}>
                                        <div className={styles.generatedFilePath}>
                                            {t('chat.fileSavedAt')}: {generatedFile.filePath}
                                        </div>
                                        <button
                                            type="button"
                                            className={styles.generatedFileAction}
                                            onClick={handleOpenFolder}
                                            disabled={openingFolder}
                                        >
                                            {openingFolder ? t('common.loading') : t('chat.openContainingFolder')}
                                        </button>
                                    </div>
                                )}
                                {commandLearningSummary && (
                                    <div className={styles.commandLearningPanel}>
                                        <div className={styles.commandLearningRow}>
                                            {commandLearningSummary.baseCommand && (
                                                <span className={styles.commandChip}>cmd: {commandLearningSummary.baseCommand}</span>
                                            )}
                                            {commandLearningSummary.platformName && (
                                                <span className={styles.commandChip}>os: {commandLearningSummary.platformName}</span>
                                            )}
                                            {commandLearningSummary.shellFamily && (
                                                <span className={styles.commandChip}>shell: {commandLearningSummary.shellFamily}</span>
                                            )}
                                            {commandLearningSummary.category && (
                                                <span className={styles.commandChip}>type: {commandLearningSummary.category}</span>
                                            )}
                                        </div>
                                        {commandLearningSummary.reason && (
                                            <div className={styles.commandLearningReason}>{commandLearningSummary.reason}</div>
                                        )}
                                        {commandLearningSummary.helpHints.length > 0 && (
                                            <div className={styles.commandLearningHints}>
                                                Help: {commandLearningSummary.helpHints.join(' | ')}
                                            </div>
                                        )}
                                        {commandLearningSummary.sequence.length > 0 && (
                                            <div className={styles.commandLearningHints}>
                                                Path: {commandLearningSummary.sequence.join(' -> ')}
                                            </div>
                                        )}
                                        {commandLearningSummary.executable && (
                                            <div className={styles.commandLearningHints}>
                                                Exec: {commandLearningSummary.executable}
                                            </div>
                                        )}
                                    </div>
                                )}
                                <div className={styles.markdownBody}>
                                    {typeof item.result === 'string' ? (
                                        <MarkdownContent content={item.result} />
                                    ) : (
                                        <pre className={styles.codeBlock}>
                                            {JSON.stringify(item.result, null, 2)}
                                        </pre>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// Custom comparison function to prevent unnecessary re-renders
// Only re-render when the tool call data actually changes
const arePropsEqual = (prevProps: ToolCardProps, nextProps: ToolCardProps): boolean => {
    return (
        prevProps.item.id === nextProps.item.id &&
        prevProps.item.toolName === nextProps.item.toolName &&
        prevProps.item.status === nextProps.item.status &&
        prevProps.item.result === nextProps.item.result &&
        prevProps.item.repeatCount === nextProps.item.repeatCount &&
        JSON.stringify(prevProps.item.args) === JSON.stringify(nextProps.item.args)
    );
};

export const ToolCard = React.memo(ToolCardComponent, arePropsEqual);

ToolCard.displayName = 'ToolCard';
