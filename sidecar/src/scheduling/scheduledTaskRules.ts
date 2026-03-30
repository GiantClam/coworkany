export type RelativeUnitKind = 'second' | 'minute' | 'hour' | 'day';
const CHINESE_NUMBER_SOURCE = '[零〇一二两兩三四五六七八九十百\\d]+';
const CHINESE_RELATIVE_UNIT_SOURCES = ['秒钟?', '分钟?', '分', '小时', '个小时', '天'] as const;
const ENGLISH_RELATIVE_UNIT_SOURCES = ['second', 'seconds', 'minute', 'minutes', 'hour', 'hours', 'day', 'days'] as const;
const RECURRING_INTERVAL_UNIT_SOURCES = ['分钟?', '分', '小时', '个小时', '天', 'minutes', 'minute', 'hours', 'hour', 'days', 'day'] as const;
const CHINESE_RELATIVE_UNIT_SOURCE = `(?:${CHINESE_RELATIVE_UNIT_SOURCES.join('|')})`;
const ENGLISH_RELATIVE_UNIT_SOURCE = `(?:${ENGLISH_RELATIVE_UNIT_SOURCES.join('|')})`;
const RECURRING_INTERVAL_UNIT_SOURCE = `(?:${RECURRING_INTERVAL_UNIT_SOURCES.join('|')})`;
export const SCHEDULED_TASK_PREFIX_PATTERNS: ReadonlyArray<RegExp> = [
    /^(?:请\s*)?(?:(?:帮我|帮忙|麻烦你)\s*)?(?:(?:创建|新建|设定|设置|安排|添加|建立)\s*)?(?:(?:一个|一条|个)\s*)?(?:定时任务|计划任务)\s*[:：,，]?\s*/u,
    /^(?:please\s+)?(?:(?:create|set|schedule|add)\s+)?(?:an?\s+)?scheduled\s+task\s*[:：,，-]?\s*/i,
];
export const RECURRING_MARKER_PATTERN = /\b(?:every)\b|每(?:隔)?/iu;
export const RECURRING_INTERVAL_PATTERN = new RegExp(
    `^(?:(${CHINESE_NUMBER_SOURCE})\\s*)?(${RECURRING_INTERVAL_UNIT_SOURCE})`,
    'iu'
);
export const INLINE_ENGLISH_RELATIVE_TIME_PATTERN = new RegExp(
    `^in\\s+(\\d+)\\s+(${ENGLISH_RELATIVE_UNIT_SOURCE})\\b`,
    'i'
);
export const INLINE_CHINESE_RELATIVE_TIME_PATTERN = new RegExp(
    `^(${CHINESE_NUMBER_SOURCE})\\s*(${CHINESE_RELATIVE_UNIT_SOURCE})(?:以?后|之?后)$`,
    'u'
);
export const LEADING_CHINESE_RELATIVE_TIME_PATTERN = new RegExp(
    `^(${CHINESE_NUMBER_SOURCE}\\s*${CHINESE_RELATIVE_UNIT_SOURCE}(?:以?后|之?后))[，,、\\s]*(.+)$`,
    'u'
);
export const LEADING_ENGLISH_RELATIVE_TIME_PATTERN = new RegExp(
    `^(in\\s+\\d+\\s+${ENGLISH_RELATIVE_UNIT_SOURCE})[\\s,:-]+(.+)$`,
    'i'
);
export const RECURRING_NOW_EXPRESSION_PATTERN =
    /^(?:从现在开始|从现在起|现在开始|立刻开始|马上开始|立即开始|from now|starting now|beginning now|begin now|now)$/iu;
export const CHAINED_SCHEDULE_PATTERN = new RegExp(
    `(?:^|[\\n。；;.!！？，,、])\\s*(?:然后|接着|随后|再|并且再|并再|and then|then|next)\\s*(?:再)?\\s*(?:等(?:待)?\\s*)?(${CHINESE_NUMBER_SOURCE}\\s*${CHINESE_RELATIVE_UNIT_SOURCE}(?:以?后|之?后)?|in\\s+\\d+\\s+${ENGLISH_RELATIVE_UNIT_SOURCE})\\s*[，,、\\s]*`,
    'giu'
);
export const STRIP_DANGLING_SPEECH_TAIL_PATTERN =
    /[，,、\s]*(?:并|然后|再)\s*(?:将|把)?\s*结果?$/iu;
export const SPEECH_DIRECTIVE_PATTERN_SOURCES: ReadonlyArray<string> = [
    '(?:,|，|\\s)*(?:并|然后|再)?(?:将|把)?结果?(?:用)?语音播报给我(?=[。.!！；;，,、\\s]|$)',
    '(?:,|，|\\s)*(?:并|然后|再)?(?:将|把)?结果?(?:用)?语音播报(?=[。.!！；;，,、\\s]|$)',
    '(?:,|，|\\s)*(?:并|然后|再)?(?:将|把)?结果?(?:朗读|读|念|说)给我听(?=[。.!！；;，,、\\s]|$)',
    '(?:,|，|\\s)*(?:并|然后|再)?(?:用)?语音播报给我(?=[。.!！；;，,、\\s]|$)',
    '(?:,|，|\\s)*(?:并|然后|再)?(?:用)?语音播报(?=[。.!！；;，,、\\s]|$)',
    '(?:,|，|\\s)*(?:并|然后|再)?朗读给我听(?=[。.!！；;，,、\\s]|$)',
    '(?:,|，|\\s)*(?:并|然后|再)?读给我听(?=[。.!！；;，,、\\s]|$)',
    '(?:,|，|\\s)*(?:并|然后|再)?说给我听(?=[。.!！；;，,、\\s]|$)',
    '(?:,|，|\\s)*(?:and then |and )?(?:speak|read)(?: the result| it)?(?: aloud)?(?: to me)?(?=[.!,;\\s]|$)',
];
export const SPEECH_FALLBACK_MARKER_PATTERN = /(语音|朗读|读出来|说给我听|播报|read aloud|speak)/iu;
export function resolveRelativeUnitKind(unitRaw: string): RelativeUnitKind | null {
    const normalized = unitRaw.trim().toLowerCase();
    if (/^(?:second|seconds|秒钟?|秒)$/iu.test(normalized)) {
        return 'second';
    }
    if (/^(?:minute|minutes|分钟?|分)$/iu.test(normalized)) {
        return 'minute';
    }
    if (/^(?:hour|hours|小时|个小时)$/iu.test(normalized)) {
        return 'hour';
    }
    if (/^(?:day|days|天)$/iu.test(normalized)) {
        return 'day';
    }
    return null;
}
