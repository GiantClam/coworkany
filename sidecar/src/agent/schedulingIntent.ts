const RECURRING_PATTERNS: RegExp[] = [
    /每[隔]?\s*\d+\s*(分钟|小时|天|日|周|星期|月)/i,
    /每(分钟|小时|天|日|周|星期|月)/i,
    /每周|每月|每天|每日|定时|定期|周期性|循环执行|自动执行/i,
    /every\s+\d+\s*(minute|minutes|hour|hours|day|days|week|weeks|month|months)/i,
    /\b(every hour|every day|every week|every month|hourly|daily|weekly|monthly|recurring|repeat|schedule|scheduled|cron|periodic)\b/i,
];

export function isRecurringScheduleRequest(message: string): boolean {
    const text = message.trim();
    if (!text) {
        return false;
    }

    return RECURRING_PATTERNS.some((pattern) => pattern.test(text));
}

export function getSchedulingDirective(message: string): string {
    if (!isRecurringScheduleRequest(message)) {
        return '';
    }

    return `## Scheduling Priority

The current user request is a recurring scheduling request.

- If the user asks for something to happen every hour/day/week/month, or uses words like 定时 / 每小时 / recurring / schedule / cron, you MUST prefer \`scheduled_task_create\`.
- Use \`set_reminder\` only for one-off reminder requests.
- Do NOT degrade this into a plain \`task_create\` when the user clearly wants recurring execution.
- If the task content itself involves research, email, calendar, or file work, first create the recurring schedule, then explain what will run on each trigger.`;
}

export function shouldSuppressTriggeredSkillForScheduling(skillName: string, message: string): boolean {
    if (!isRecurringScheduleRequest(message)) {
        return false;
    }

    return ['stock-research', 'research-topic'].includes(skillName);
}
