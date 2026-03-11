const X_FOLLOWING_PATTERNS: RegExp[] = [
    /\bx\b/i,
    /\btwitter\b/i,
    /x\.com/i,
    /关注/,
    /following/i,
    /followed/i,
    /帖文|推文|post|posts|timeline|feed/i,
];

const X_AI_RESEARCH_PATTERNS: RegExp[] = [
    /ai|人工智能|大模型|llm|agent|智能体/i,
    /有价值|值得关注|最新|摘要|总结|整理|提取|查看/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(text));
}

export function isXFollowingResearchRequest(message: string): boolean {
    const text = (message || '').trim();
    if (!text) {
        return false;
    }

    return matchesAny(text, X_FOLLOWING_PATTERNS) && matchesAny(text, X_AI_RESEARCH_PATTERNS);
}

export function shouldSuppressTriggeredSkillForBrowserFeed(skillName: string, message: string): boolean {
    if (!isXFollowingResearchRequest(message)) {
        return false;
    }

    return ['stock-research', 'research-topic'].includes(skillName);
}

export function getBrowserFeedDirective(message: string): string {
    if (!isXFollowingResearchRequest(message)) {
        return '';
    }

    return `## X/Twitter Feed Workflow

The current user request is about reviewing posts from followed accounts on X/Twitter.

- Prefer browser tools over generic web search when the user asks about their own Following feed.
- Navigate to \`https://x.com/home\` first, then switch to the \`Following\` tab if it is visible.
- If login is required, suspend the task and ask the user to log in. Do NOT keep looping on \`browser_screenshot\` and \`browser_get_content\`.
- Avoid repeated observation loops. After checking the page state 1-2 times, either click \`Following\`, navigate to the correct page, or suspend with a concrete login/action request.
- When feed content is visible, extract AI-related posts directly from the current page text before taking another screenshot.`;
}
