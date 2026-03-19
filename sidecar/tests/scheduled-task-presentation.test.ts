import { describe, expect, test } from 'bun:test';
import {
    buildScheduledTaskCompletionMessage,
    buildScheduledTaskFailureMessage,
    buildScheduledTaskSpokenText,
    cleanScheduledTaskResultText,
    normalizeScheduledTaskResultText,
} from '../src/scheduling/scheduledTaskPresentation';

describe('scheduledTaskPresentation', () => {
    test('normalizes markdown-heavy task results for speech', () => {
        const normalized = normalizeScheduledTaskResultText('## 标题\n- [OpenClaw](https://example.com) **很强** `code`');
        expect(normalized).toBe('标题 OpenClaw 很强 code');
    });

    test('builds completion message for the original task session', () => {
        const message = buildScheduledTaskCompletionMessage('整理 Reddit', '这里是最终结果');
        expect(message).toBe('这里是最终结果');
    });

    test('drops clarification-heavy boilerplate from scheduled task results', () => {
        const cleaned = cleanScheduledTaskResultText(`当然可以！你这个需求很有价值。

不过你这句话最后停在“并将结果…”，看起来还没说完，所以我先补全几个关键项。

我理解你的需求是：

> 整理 10 篇高价值 Reddit 内容

1. 帖子 A：核心观点
2. 帖子 B：可执行经验

如果你愿意，你只要回一句：按默认开始。`);

        expect(cleaned).toContain('1. 帖子 A：核心观点');
        expect(cleaned).toContain('2. 帖子 B：可执行经验');
        expect(cleaned).not.toContain('按默认开始');
        expect(cleaned).not.toContain('你这个需求很有价值');
    });

    test('removes lightweight acknowledgement preambles from final result blocks', () => {
        const cleaned = cleanScheduledTaskResultText(`好的，按你的要求整理了 3 篇（仅保留标题、链接、一句启发）：

1. 标题：A
2. 标题：B`);

        expect(cleaned).toBe('1. 标题：A\n2. 标题：B');
    });

    test('strips trailing follow-up suggestions from final result blocks', () => {
        const cleaned = cleanScheduledTaskResultText(`1. 标题：A
2. 标题：B

如果你要，我现在也可以帮你改成 2 分钟后或立即执行一次。`);

        expect(cleaned).toBe('1. 标题：A\n2. 标题：B');
        expect(cleaned).not.toContain('2 分钟后');
    });

    test('builds failure message for the original task session', () => {
        const message = buildScheduledTaskFailureMessage('整理 Reddit', '模型超时');
        expect(message).toBe('定时任务“整理 Reddit”执行失败：模型超时');
    });

    test('builds speech-friendly spoken text', () => {
        const spoken = buildScheduledTaskSpokenText({
            title: '整理 Reddit',
            success: true,
            finalAssistantText: `当然可以！\n\n1. **帖子**: [OpenClaw](https://example.com)\n2. 经验总结\n\n如果你愿意，你只要回一句：按默认开始。`,
        });
        expect(spoken).not.toContain('定时任务已完成');
        expect(spoken).not.toContain('整理 Reddit');
        expect(spoken).not.toContain('https://');
        expect(spoken).toContain('OpenClaw');
        expect(spoken).not.toContain('按默认开始');
        expect(spoken).not.toContain('当然可以');
    });
});
