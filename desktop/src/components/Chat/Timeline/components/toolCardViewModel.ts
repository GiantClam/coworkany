import type { ToolCallItem } from '../../../../types';

export interface ToolCardSectionViewModel {
    label: string;
    content:
    | {
        type: 'json';
        value: string;
    }
    | {
        type: 'markdown';
        value: string;
    };
}

export interface ToolCardViewModel {
    id: string;
    summary: {
        kind: 'tool';
        kicker: string;
        title: string;
        preview?: string;
        eventDetail?: string;
        statusLabel: string;
        statusTone: 'running' | 'success' | 'failed';
    };
    sections: ToolCardSectionViewModel[];
}

export function buildToolCardViewModel(
    item: ToolCallItem,
): ToolCardViewModel {
    const isSoftError = item.status === 'failed' || (
        typeof item.result === 'string'
        && (
            item.result.includes('❌')
            || item.result.includes('Search Failed')
            || item.result.startsWith('Error:')
        )
    );
    const displayStatus = isSoftError ? 'failed' : item.status;
    const preview = !item.result
        ? ''
        : (() => {
            const raw = typeof item.result === 'string' ? item.result : JSON.stringify(item.result);
            const cleaned = raw.replace(/[#*`]/g, '').replace(/\s+/g, ' ').trim();
            return cleaned.length > 60 ? `${cleaned.slice(0, 60)}...` : cleaned;
        })();
    const eventDetail = displayStatus === 'running'
        ? `Waiting for ${item.toolName || 'tool'} result`
        : displayStatus === 'success'
            ? (preview ? `Result: ${preview}` : 'Tool call completed')
            : (preview ? `Error: ${preview}` : 'Tool call failed');

    const sections: ToolCardSectionViewModel[] = [];
    if (item.args) {
        sections.push({
            label: 'Input',
            content: {
                type: 'json',
                value: JSON.stringify(item.args, null, 2),
            },
        });
    }
    if (item.result) {
        sections.push({
            label: 'Output',
            content: typeof item.result === 'string'
                ? {
                    type: 'markdown',
                    value: item.result,
                }
                : {
                    type: 'json',
                    value: JSON.stringify(item.result, null, 2),
                },
        });
    }

    return {
        id: item.id,
        summary: {
            kind: 'tool',
            kicker: 'Tool event',
            title: item.toolName,
            preview: preview || undefined,
            eventDetail,
            statusLabel: displayStatus === 'running'
                ? 'Running'
                : displayStatus === 'success'
                    ? 'Completed'
                    : 'Failed',
            statusTone: displayStatus === 'running' ? 'running' : displayStatus === 'success' ? 'success' : 'failed',
        },
        sections,
    };
}
