export type TargetResolutionRuleTable = {
    precisionIntentPatterns: RegExp[];
    precisionSubjectPatterns: RegExp[];
    broadScopePatterns: RegExp[];
    explicitIdentifierPatterns: RegExp[];
};

/**
 * Execution-target resolution rules.
 * Keep these patterns data-driven so policy tuning does not require touching analyzer flow logic.
 */
export const TARGET_RESOLUTION_RULE_TABLE: TargetResolutionRuleTable = {
    precisionIntentPatterns: [
        /(检索|搜索|查询|查一下|查下|查|look up|search|find)/i,
        /(分析|解释|原因|why|latest|current|today|今天|最新|实时|as of)/i,
    ],
    precisionSubjectPatterns: [
        /(股价|涨跌|暴涨|暴跌|尾盘|盘口|成交量|价格|价位|买入价|目标价|市值|汇率|交易量)/i,
        /(error rate|latency|uptime|downtime|disconnect|version|market cap|volume|intraday|closing price|price surge|rally|plunge)/i,
    ],
    broadScopePatterns: [
        /(大盘|市场整体|全市场|板块|行业|指数|领涨板块|overview|overall|sector|index|leading sector|trend|趋势|landscape)/i,
        /(top\s*\d+|前\d+|best practice|最佳实践|教程|guide)/i,
    ],
    explicitIdentifierPatterns: [
        /\bhttps?:\/\/[^\s]+/i, // URL
        /(?:^|\s)(?:~\/|\/[^\s]+|\.[/\\][^\s]+)/, // filesystem path
        /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i, // email
        /\b(?=[a-z0-9_.-]*[a-z])[a-z0-9_.-]+\/(?=[a-z0-9_.-]*[a-z])[a-z0-9_.-]+\b/i, // owner/repo
        /\b(?:issue|ticket|bug|id|编号)\s*[:#：]?\s*[a-z0-9._-]{2,}\b/i, // explicit issue/ticket/id
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i, // UUID
        /\b(?:NASDAQ|NYSE|HKEX|SSE|SZSE|BSE|TSX)\s*[:：]\s*[A-Z0-9.\-]{1,10}\b/i,
        /\b(?:股票代码|ticker|symbol|exchange)\s*[:：]?\s*[A-Z0-9.\-]{1,15}\b/i,
        /\b\d{4,6}\.(?:HK|SS|SZ|SH)\b/i,
        /\b[A-Z]{1,5}\.[A-Z]{1,4}\b/,
        /\b[A-Z0-9]{2,10}\s*[:/]\s*[A-Z0-9]{2,12}\b/i,
        /\b[A-Z]{2}[A-Z0-9]{9}[0-9]\b/, // ISIN
        /\bCUSIP\s*[:：]?\s*[0-9A-Z]{9}\b/i,
    ],
};

export function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(text));
}

