/**
 * Conversation Export Utility
 *
 * Converts a TaskSession into a Markdown string and triggers a download.
 */

import type { TaskSession } from '../types';

/**
 * Convert a TaskSession to Markdown format
 */
export function sessionToMarkdown(session: TaskSession): string {
    const lines: string[] = [];

    lines.push(`# ${session.title || 'Conversation'}`);
    lines.push('');
    lines.push(`**Date**: ${new Date(session.createdAt).toLocaleString()}`);
    lines.push(`**Status**: ${session.status}`);

    if (session.tokenUsage) {
        lines.push(`**Tokens**: Input ${session.tokenUsage.inputTokens.toLocaleString()}, Output ${session.tokenUsage.outputTokens.toLocaleString()}`);
        if (session.tokenUsage.estimatedCost) {
            lines.push(`**Estimated Cost**: $${session.tokenUsage.estimatedCost.toFixed(4)}`);
        }
    }

    lines.push('');
    lines.push('---');
    lines.push('');

    for (const msg of session.messages) {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        lines.push(`## ${role}`);
        lines.push('');
        lines.push(msg.content);
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Download a Markdown string as a file
 */
export function downloadMarkdown(content: string, filename: string): void {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Export the session as a Markdown file
 */
export function exportSession(session: TaskSession): void {
    const md = sessionToMarkdown(session);
    const dateStr = new Date(session.createdAt).toISOString().slice(0, 10);
    const title = (session.title || 'conversation').replace(/[^a-zA-Z0-9\u4e00-\u9fa5-_]/g, '_').slice(0, 50);
    const filename = `${title}_${dateStr}.md`;
    downloadMarkdown(md, filename);
}
