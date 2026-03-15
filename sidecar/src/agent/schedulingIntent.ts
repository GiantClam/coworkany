const RECURRING_PATTERNS: RegExp[] = [
    /\u6bcf\s*\d+\s*(\u5206\u949f|\u5c0f\u65f6|\u5929|\u5468|\u661f\u671f|\u4e2a?\u6708)/i,
    /\u6bcf\s*(\u5206\u949f|\u5c0f\u65f6|\u5929|\u5468|\u661f\u671f|\u4e2a?\u6708)/i,
    /\u5b9a\u65f6|\u5b9a\u671f|\u5468\u671f\u6027|\u5faa\u73af\u6267\u884c|\u81ea\u52a8\u6267\u884c/i,
    /every\s+\d+\s*(minute|minutes|hour|hours|day|days|week|weeks|month|months)/i,
    /\b(every hour|every day|every week|every month|hourly|daily|weekly|monthly|recurring|repeat|schedule|scheduled|cron|periodic)\b/i,
];

const DELAYED_TIME_PATTERNS: RegExp[] = [
    /\d+\s*(\u5206\u949f|\u5c0f\u65f6|\u5929)\s*(\u540e|\u4e4b\u540e)/i,
    /\b(in\s+\d+\s+(minute|minutes|hour|hours|day|days))\b/i,
    /\b(tomorrow|tonight|later today|next week|next month)\b/i,
    /\u660e\u5929|\u4eca\u665a|\u7a0d\u540e|\u5f85\u4f1a|\u7b49\u4f1a|\u4eca\u5929\u665a\u4e9b\u65f6\u5019/i,
];

const ACTIONABLE_WORK_PATTERNS: RegExp[] = [
    /reddit|email|calendar|report|summary|summarize|summarise|digest|check|search|research|analy[sz]e|analy[sz]is|crawl|collect|monitor|review|run|execute|send|news|stock/i,
    /\u603b\u7ed3|\u6458\u8981|\u6574\u7406|\u68c0\u7d22|\u641c\u7d22|\u8c03\u7814|\u5206\u6790|\u68c0\u67e5|\u6293\u53d6|\u6536\u96c6|\u76d1\u63a7|\u56de\u987e|\u6267\u884c|\u8fd0\u884c|\u53d1\u9001|\u65b0\u95fb|\u80a1\u7968/i,
];

const REMINDER_ONLY_PATTERNS: RegExp[] = [
    /\b(remind me|reminder|don't let me forget)\b/i,
    /\u63d0\u9192\u6211|\u63d0\u9192\u4e00\u4e0b|\u8bb0\u5f97|\u522b\u5fd8\u4e86/i,
];

export function isRecurringScheduleRequest(message: string): boolean {
    const text = message.trim();
    if (!text) {
        return false;
    }

    return RECURRING_PATTERNS.some((pattern) => pattern.test(text));
}

export function isReminderOnlyRequest(message: string): boolean {
    const text = message.trim();
    if (!text) {
        return false;
    }

    return REMINDER_ONLY_PATTERNS.some((pattern) => pattern.test(text))
        && !ACTIONABLE_WORK_PATTERNS.some((pattern) => pattern.test(text));
}

export function isExecutionScheduleRequest(message: string): boolean {
    const text = message.trim();
    if (!text) {
        return false;
    }

    if (isReminderOnlyRequest(text)) {
        return false;
    }

    if (isRecurringScheduleRequest(text)) {
        return ACTIONABLE_WORK_PATTERNS.some((pattern) => pattern.test(text));
    }

    const hasDelayedTime = DELAYED_TIME_PATTERNS.some((pattern) => pattern.test(text));
    const hasWorkIntent = ACTIONABLE_WORK_PATTERNS.some((pattern) => pattern.test(text));

    return hasDelayedTime && hasWorkIntent;
}

export function getSchedulingDirective(message: string): string {
    if (!isExecutionScheduleRequest(message)) {
        return '';
    }

    if (isRecurringScheduleRequest(message)) {
        return `## Scheduling Priority

The current user request is a recurring execution schedule.

- If the user asks for something to happen every hour/day/week/month, or uses words like 定时 / 每小时 / recurring / schedule / cron, you MUST use \`scheduled_task_create\`.
- For recurring schedules, use \`scheduleType: "interval"\` or \`scheduleType: "cron"\`.
- Use \`set_reminder\` only for pure reminder requests that notify the user without executing substantive work.
- Do NOT degrade this into a plain \`task_create\` when the user clearly wants recurring execution.
- If the task content itself involves research, email, calendar, file work, news monitoring, or stock tracking, first create the recurring schedule, then explain what will run on each trigger.`;
    }

    return `## Scheduling Priority

The current user request is a one-off delayed execution request.

- The user wants real work to happen in the future, not just a reminder notification.
- You MUST use \`scheduled_task_create\`, not \`set_reminder\`.
- For one-off delayed execution, use \`scheduleType: "date"\` and set \`runAt\` to the parsed ISO timestamp.
- Put the actual future work in \`taskQuery\` so the trigger executes the task when it fires.
- Use \`set_reminder\` only when the request is purely "remind me ..." without substantive work like searching, summarizing, checking, monitoring, or sending.`;
}

export function shouldSuppressTriggeredSkillForScheduling(skillName: string, message: string): boolean {
    if (!isExecutionScheduleRequest(message)) {
        return false;
    }

    return ['stock-research', 'research-topic'].includes(skillName);
}
