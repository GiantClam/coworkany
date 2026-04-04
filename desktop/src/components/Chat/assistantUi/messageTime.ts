export function formatAssistantUiTimestamp(
    input: Date | string | number | null | undefined,
    locale?: string,
): string {
    if (!input) {
        return '';
    }

    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const now = new Date();
    const isSameDay = date.toDateString() === now.toDateString();
    const isSameYear = date.getFullYear() === now.getFullYear();

    const timeLabel = new Intl.DateTimeFormat(locale || undefined, {
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);

    if (isSameDay) {
        return timeLabel;
    }

    const dateLabel = new Intl.DateTimeFormat(locale || undefined, {
        month: 'short',
        day: 'numeric',
        ...(isSameYear ? {} : { year: 'numeric' }),
    }).format(date);

    return `${dateLabel} ${timeLabel}`;
}

export function toTimestampIsoString(input: Date | string | number | null | undefined): string {
    if (!input) {
        return '';
    }

    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return date.toISOString();
}
