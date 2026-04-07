import React from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { toast } from '../../../Common/ToastProvider';
import { ModalDialog } from '../../../Common/ModalDialog';
import styles from '../Timeline.module.css';
import { downloadRemoteFile, openLocalFile, fetchRemoteTextPreview, readLocalTextPreview } from '../../../../lib/fileActions';
import { isExternalHref } from '../../../../lib/externalLinks';
import { processMessageContent } from '../../../../lib/text/messageProcessor';
import { buildRichMessageSegments, looksLikeHtmlDocument, type RichMessageFileRef } from '../../../../lib/text/richMessageSegments';
import type { InlineFileAttachment } from '../../../../lib/text/inlineAttachments';

interface RichMessageContentProps {
    content: string;
    inlineFiles?: InlineFileAttachment[];
    className?: string;
}

interface PreviewModalState {
    title: string;
    html: string;
}

function getFileActionLabel(file: RichMessageFileRef, t: ReturnType<typeof useTranslation>['t']): string {
    if (file.kind === 'remote') {
        return t('chat.download', { defaultValue: '下载' });
    }

    if (file.kind === 'local') {
        return t('chat.openFile', { defaultValue: '打开文件' });
    }

    return t('chat.previewFile', { defaultValue: '预览内容' });
}

async function handleFileAction(
    file: RichMessageFileRef,
    t: ReturnType<typeof useTranslation>['t'],
): Promise<void> {
    if (file.kind === 'inline') {
        return;
    }

    if (file.kind === 'local') {
        await openLocalFile(file.source);
        return;
    }

    const result = await downloadRemoteFile(file.source, file.label);
    toast.success(
        t('chat.fileDownloaded', { defaultValue: '文件已下载' }),
        result.savedPath,
    );
}

function escapeHtmlAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function withBaseHref(html: string, source?: RichMessageFileRef): string {
    if (!source || source.kind !== 'remote') {
        return html;
    }

    const baseTag = `<base href="${escapeHtmlAttribute(source.source)}">`;
    if (/<head[\s>]/i.test(html)) {
        return html.replace(/<head(\s*[^>]*)>/i, `<head$1>${baseTag}`);
    }

    if (/<html[\s>]/i.test(html)) {
        return html.replace(/<html(\s*[^>]*)>/i, `<html$1><head>${baseTag}</head>`);
    }

    return `<!doctype html><html><head>${baseTag}</head><body>${html}</body></html>`;
}

async function loadHtmlPreview(
    source?: RichMessageFileRef,
    inlineContent?: string,
): Promise<{ html: string; truncated: boolean }> {
    if (inlineContent && looksLikeHtmlDocument(inlineContent)) {
        return {
            html: inlineContent,
            truncated: false,
        };
    }

    if (!source) {
        throw new Error('No HTML source available.');
    }

    if (source.kind === 'inline') {
        throw new Error('Inline file preview content is unavailable.');
    }

    const preview = source.kind === 'local'
        ? await readLocalTextPreview(source.source)
        : await fetchRemoteTextPreview(source.source);

    if (!looksLikeHtmlDocument(preview.content)) {
        throw new Error('Preview content is not valid HTML.');
    }

    return {
        html: preview.content,
        truncated: preview.truncated,
    };
}

const MarkdownSegment = React.memo(function MarkdownSegment({ content, className }: { content: string; className?: string }) {
    return (
        <div className={className}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={{
                    code(props) {
                        const { children, className } = props;
                        const languageClass = typeof className === 'string' ? className : '';
                        const isInline = !languageClass.includes('language-');
                        if (isInline) {
                            return (
                                <code {...props} className={className}>
                                    {children}
                                </code>
                            );
                        }

                        return (
                            <pre className={styles.codeBlock}>
                                <code className={languageClass}>
                                    {String(children).replace(/\n$/, '')}
                                </code>
                            </pre>
                        );
                    },
                    a(props) {
                        const { href, children, ...rest } = props;
                        const isExternal = isExternalHref(href);
                        return (
                            <a
                                {...rest}
                                href={href}
                                target={isExternal ? '_blank' : undefined}
                                rel={isExternal ? 'noopener noreferrer' : undefined}
                            >
                                {children}
                            </a>
                        );
                    }
                }}
            >
                {processMessageContent(content, {
                    compactMarkdown: false,
                    cleanNewlines: true,
                })}
            </ReactMarkdown>
        </div>
    );
});

function FileCard({ file }: { file: RichMessageFileRef }) {
    const { t } = useTranslation();
    const actionLabel = getFileActionLabel(file, t);
    const clickable = file.kind !== 'inline';

    const onClick = React.useCallback(() => {
        if (!clickable) {
            return;
        }

        void handleFileAction(file, t).catch((error) => {
            toast.error(
                t('chat.fileActionFailed', { defaultValue: '文件操作失败' }),
                error instanceof Error ? error.message : String(error),
            );
        });
    }, [clickable, file, t]);

    return (
        <button
            type="button"
            className={`${styles.fileCard} ${clickable ? styles.fileCardClickable : ''}`.trim()}
            onClick={onClick}
            disabled={!clickable}
        >
            <span className={styles.fileCardIcon} aria-hidden="true">FILE</span>
            <span className={styles.fileCardBody}>
                <span className={styles.fileCardTitle}>{file.label}</span>
                <span className={styles.fileCardPath}>{file.displayPath}</span>
            </span>
            <span className={styles.fileCardAction}>
                {actionLabel}
            </span>
        </button>
    );
}

function HtmlPreviewCard({
    title,
    source,
    inlineContent,
    onExpand,
}: {
    title: string;
    source?: RichMessageFileRef;
    inlineContent?: string;
    onExpand: (payload: PreviewModalState) => void;
}) {
    const { t } = useTranslation();
    const [previewState, setPreviewState] = React.useState<{
        loading: boolean;
        html: string | null;
        error: string | null;
        truncated: boolean;
    }>({
        loading: true,
        html: null,
        error: null,
        truncated: false,
    });

    React.useEffect(() => {
        let cancelled = false;

        void loadHtmlPreview(source, inlineContent)
            .then((result) => {
                if (cancelled) return;
                setPreviewState({
                    loading: false,
                    html: withBaseHref(result.html, source),
                    error: null,
                    truncated: result.truncated,
                });
            })
            .catch((error) => {
                if (cancelled) return;
                setPreviewState({
                    loading: false,
                    html: null,
                    error: error instanceof Error ? error.message : String(error),
                    truncated: false,
                });
            });

        return () => {
            cancelled = true;
        };
    }, [inlineContent, source]);

    const actionLabel = source && source.kind !== 'inline' ? getFileActionLabel(source, t) : null;

    const handlePrimaryAction = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (!source || source.kind === 'inline') {
            return;
        }

        void handleFileAction(source, t).catch((error) => {
            toast.error(
                t('chat.fileActionFailed', { defaultValue: '文件操作失败' }),
                error instanceof Error ? error.message : String(error),
            );
        });
    }, [source, t]);

    const handleExpand = React.useCallback(() => {
        if (!previewState.html) {
            return;
        }
        onExpand({
            title,
            html: previewState.html,
        });
    }, [onExpand, previewState.html, title]);

    return (
        <div className={styles.htmlPreviewCard}>
            <div className={styles.htmlPreviewHeader}>
                <div className={styles.htmlPreviewMeta}>
                    <span className={styles.htmlPreviewKicker}>HTML</span>
                    <span className={styles.htmlPreviewTitle}>{title}</span>
                    {source ? <span className={styles.htmlPreviewPath}>{source.displayPath}</span> : null}
                </div>
                <div className={styles.htmlPreviewActions}>
                    {actionLabel ? (
                        <button
                            type="button"
                            className={styles.htmlPreviewActionButton}
                            onClick={handlePrimaryAction}
                        >
                            {actionLabel}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className={styles.htmlPreviewActionButton}
                        onClick={handleExpand}
                        disabled={!previewState.html}
                    >
                        {t('chat.expandPreview', { defaultValue: '放大预览' })}
                    </button>
                </div>
            </div>

            <button
                type="button"
                className={styles.htmlPreviewViewport}
                onClick={handleExpand}
                disabled={!previewState.html}
            >
                {previewState.loading ? (
                    <span className={styles.htmlPreviewPlaceholder}>
                        {t('chat.loadingPreview', { defaultValue: '正在加载预览…' })}
                    </span>
                ) : null}

                {!previewState.loading && previewState.error ? (
                    <span className={styles.htmlPreviewPlaceholder}>
                        {previewState.error}
                    </span>
                ) : null}

                {!previewState.loading && previewState.html ? (
                    <iframe
                        title={title}
                        srcDoc={previewState.html}
                        className={styles.htmlPreviewFrame}
                        sandbox="allow-scripts allow-forms"
                    />
                ) : null}
            </button>

            {previewState.truncated ? (
                <div className={styles.htmlPreviewHint}>
                    {t('chat.previewTruncated', { defaultValue: '预览内容过长，已截断显示。' })}
                </div>
            ) : null}
        </div>
    );
}

export function RichMessageContent({
    content,
    inlineFiles = [],
    className,
}: RichMessageContentProps) {
    const { t } = useTranslation();
    const [modalState, setModalState] = React.useState<PreviewModalState | null>(null);
    const segments = React.useMemo(
        () => buildRichMessageSegments(content, inlineFiles),
        [content, inlineFiles],
    );

    return (
        <>
            <div className={`${styles.richMessageContent} ${className ?? ''}`.trim()}>
                {segments.map((segment, index) => {
                    if (segment.type === 'markdown') {
                        return (
                            <MarkdownSegment
                                key={`markdown-${index}`}
                                content={segment.content}
                                className={className}
                            />
                        );
                    }

                    if (segment.type === 'file') {
                        return <FileCard key={`file-${segment.file.source}-${index}`} file={segment.file} />;
                    }

                    return (
                        <HtmlPreviewCard
                            key={`html-${segment.title}-${index}`}
                            title={segment.title}
                            source={segment.source}
                            inlineContent={segment.inlineContent}
                            onExpand={setModalState}
                        />
                    );
                })}
            </div>

            <ModalDialog
                open={modalState !== null}
                onClose={() => setModalState(null)}
                title={modalState?.title || t('chat.htmlPreviewTitle', { defaultValue: 'HTML 预览' })}
            >
                <div className={styles.htmlPreviewModalBody}>
                    {modalState?.html ? (
                        <iframe
                            title={modalState.title}
                            srcDoc={modalState.html}
                            className={styles.htmlPreviewModalFrame}
                            sandbox="allow-scripts allow-forms"
                        />
                    ) : null}
                </div>
            </ModalDialog>
        </>
    );
}
