export function extractAssistantText(rawLogs: string): string {
    const lines = rawLogs.split('\n');
    const chunks: string[] = [];

    for (const line of lines) {
        if (!line.includes('"type":"TEXT_DELTA"')) continue;
        const deltaMatch = line.match(/"delta":"([\s\S]*?)","role":"assistant"/);
        if (!deltaMatch) continue;

        try {
            const decoded = JSON.parse(`"${deltaMatch[1]}"`) as string;
            chunks.push(decoded);
        } catch {
            chunks.push(deltaMatch[1]);
        }
    }

    return chunks.join('');
}

export function countStructuredPostsInAssistant(rawLogs: string): number {
    const assistantText = extractAssistantText(rawLogs);
    let found = 0;

    for (let i = 1; i <= 10; i++) {
        const marker = `[POST_${String(i).padStart(2, '0')}]`;
        if (assistantText.includes(marker)) {
            found += 1;
        }
    }

    return found;
}

export interface ParsedStructuredPost {
    index: number;
    rawLine: string;
    account: string;
    publishedAt: string;
    summary: string;
    link: string;
}

export function parseStructuredPosts(rawLogs: string): ParsedStructuredPost[] {
    const assistantText = extractAssistantText(rawLogs);
    const results: ParsedStructuredPost[] = [];

    for (let i = 1; i <= 10; i++) {
        const marker = `[POST_${String(i).padStart(2, '0')}]`;
        const nextMarker = `[POST_${String(i + 1).padStart(2, '0')}]`;
        const start = assistantText.indexOf(marker);
        if (start < 0) continue;

        const end = i === 10 ? assistantText.length : assistantText.indexOf(nextMarker, start + marker.length);
        const slice = assistantText.slice(start, end > -1 ? end : assistantText.length);
        const line = slice.replace(/\s+/g, ' ').trim();

        const payload = line.replace(marker, '').trim();
        const parts = payload.split('|').map((p) => p.trim());
        const [account = '', publishedAt = '', summary = '', link = ''] = parts;

        results.push({
            index: i,
            rawLine: line,
            account,
            publishedAt,
            summary,
            link,
        });
    }

    return results;
}

export function hasTenRealPosts(rawLogs: string): { ok: boolean; reason: string } {
    const posts = parseStructuredPosts(rawLogs);
    if (posts.length !== 10) {
        return { ok: false, reason: `structured post count is ${posts.length}` };
    }

    for (const post of posts) {
        const lowerSummary = post.summary.toLowerCase();
        const lowerLink = post.link.toLowerCase();

        if (!post.account || !post.publishedAt || !post.summary || !post.link) {
            return { ok: false, reason: `post ${post.index} has empty fields` };
        }
        if (lowerSummary.includes('无可用内容') || lowerSummary.includes('not available')) {
            return { ok: false, reason: `post ${post.index} contains placeholder summary` };
        }
        if (!(lowerLink.includes('x.com') || lowerLink.includes('twitter.com'))) {
            return { ok: false, reason: `post ${post.index} link is not X/Twitter` };
        }
    }

    return { ok: true, reason: '10 real posts validated' };
}

export function hasFinishedSignal(rawLogs: string, bodyText?: string | null): boolean {
    if (rawLogs.includes('TASK_FINISHED')) return true;
    if (/"type":"TASK_STATUS"[\s\S]*?"status":"(finished|completed)"/.test(rawLogs)) return true;
    if (bodyText?.toLowerCase().includes('ready for follow-up')) return true;
    return false;
}

export function hasFailedSignal(rawLogs: string): boolean {
    if (rawLogs.includes('TASK_FAILED')) return true;
    if (/"type":"TASK_STATUS"[\s\S]*?"status":"failed"/.test(rawLogs)) return true;
    return false;
}
