const HOST_CONTROL_ABSOLUTE_HOUR_CUE_PATTERN = /([01]?\d|2[0-3])\s*点/u;
const CHINESE_NUMERIC_PATTERN = /[零〇一二两兩三四五六七八九十]/u;
const ENGLISH_RELATIVE_MINUTE_CUE_PATTERN = /\b(?:in|after)\s+(\d+)\s*(?:minutes?|mins?)\b/iu;
const ENGLISH_RELATIVE_HOUR_CUE_PATTERN = /\b(?:in|after)\s+(\d+)\s*(?:hours?|hrs?)\b/iu;
const CHINESE_RELATIVE_DELAY_CUE_PATTERN = /([0-9０-９零〇一二两兩三四五六七八九十]+)\s*(分(?:钟)?|小(?:时|時))\s*(?:后|以后|之后)/u;
const CHINESE_HALF_HOUR_CUE_PATTERN = /半\s*小(?:时|時)\s*(?:后|以后|之后)/u;

export const HOST_CONTROL_APPROVAL_PATTERN = /\b(shutdown|reboot|poweroff|halt|empty\s+(?:the\s+)?(?:trash|recycle\s+bin)|clear\s+(?:the\s+)?(?:trash|recycle\s+bin))\b|关机|重启|清空(?:回收站|垃圾桶)/iu;

function normalizeFullWidthDigits(value: string): string {
    return value.replace(/[０-９]/gu, (char) => String(char.charCodeAt(0) - 0xFF10));
}

function parseChineseNumber(raw: string): number {
    const normalized = raw
        .trim()
        .replace(/兩/gu, '两')
        .replace(/[〇零]/gu, '0');

    const digits: Record<string, number> = {
        '0': 0,
        '一': 1,
        '二': 2,
        '两': 2,
        '三': 3,
        '四': 4,
        '五': 5,
        '六': 6,
        '七': 7,
        '八': 8,
        '九': 9,
    };

    if (normalized === '十') {
        return 10;
    }

    const tenIndex = normalized.indexOf('十');
    if (tenIndex >= 0) {
        const left = normalized.slice(0, tenIndex);
        const right = normalized.slice(tenIndex + 1);
        const tens = left ? (digits[left] ?? 0) : 1;
        const ones = right ? (digits[right] ?? 0) : 0;
        return tens * 10 + ones;
    }

    return normalized.split('').reduce((acc, char) => acc * 10 + (digits[char] ?? 0), 0);
}

function parseNumericAmount(raw: string): number | null {
    const normalized = normalizeFullWidthDigits(raw.trim());
    if (/^\d+$/u.test(normalized)) {
        const amount = Number(normalized);
        return Number.isFinite(amount) ? amount : null;
    }
    if (!CHINESE_NUMERIC_PATTERN.test(normalized)) {
        return null;
    }
    const amount = parseChineseNumber(normalized);
    return Number.isFinite(amount) ? amount : null;
}

function deriveHostControlRelativeDelayMinutes(message: string): number | null {
    const englishMinuteMatch = message.match(ENGLISH_RELATIVE_MINUTE_CUE_PATTERN);
    if (englishMinuteMatch?.[1]) {
        const amount = Number(englishMinuteMatch[1]);
        if (Number.isFinite(amount) && amount > 0) {
            return Math.max(1, Math.floor(amount));
        }
    }

    const englishHourMatch = message.match(ENGLISH_RELATIVE_HOUR_CUE_PATTERN);
    if (englishHourMatch?.[1]) {
        const amount = Number(englishHourMatch[1]);
        if (Number.isFinite(amount) && amount > 0) {
            return Math.max(1, Math.floor(amount * 60));
        }
    }

    if (CHINESE_HALF_HOUR_CUE_PATTERN.test(message)) {
        return 30;
    }

    const chineseDelayMatch = message.match(CHINESE_RELATIVE_DELAY_CUE_PATTERN);
    if (chineseDelayMatch?.[1] && chineseDelayMatch[2]) {
        const amount = parseNumericAmount(chineseDelayMatch[1]);
        if (!Number.isFinite(amount) || amount === null || amount <= 0) {
            return null;
        }
        const unit = chineseDelayMatch[2];
        const delayMinutes = /^小(?:时|時)/u.test(unit) ? amount * 60 : amount;
        return Math.max(1, Math.floor(delayMinutes));
    }

    return null;
}

export function deriveHostControlShellCommand(message: string): string {
    const normalized = message.trim();
    const isTrashCleanup = /\b(empty\s+(?:the\s+)?(?:trash|recycle\s+bin)|clear\s+(?:the\s+)?(?:trash|recycle\s+bin))\b|清空(?:回收站|垃圾桶)/iu.test(normalized);

    if (isTrashCleanup) {
        if (process.platform === 'darwin') {
            return `osascript -e 'tell application "Finder" to empty the trash'`;
        }
        if (process.platform === 'win32') {
            return 'PowerShell -NoProfile -Command "Clear-RecycleBin -Force"';
        }
        return 'if command -v gio >/dev/null 2>&1; then gio trash --empty; elif command -v trash-empty >/dev/null 2>&1; then trash-empty; else echo "no_supported_trash_cli"; exit 127; fi';
    }

    const isReboot = /\b(reboot)\b|重启/u.test(normalized);
    const relativeDelayMinutes = deriveHostControlRelativeDelayMinutes(normalized);
    if (relativeDelayMinutes !== null) {
        return isReboot
            ? `sudo shutdown -r +${relativeDelayMinutes}`
            : `sudo shutdown -h +${relativeDelayMinutes}`;
    }

    const hourMatch = normalized.match(HOST_CONTROL_ABSOLUTE_HOUR_CUE_PATTERN);
    if (hourMatch?.[1]) {
        const hour = hourMatch[1].padStart(2, '0');
        return isReboot
            ? `sudo shutdown -r ${hour}00`
            : `sudo shutdown -h ${hour}00`;
    }

    return isReboot
        ? 'sudo shutdown -r now'
        : 'sudo shutdown -h now';
}
