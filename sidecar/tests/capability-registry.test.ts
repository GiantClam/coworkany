import { describe, expect, test } from 'bun:test';
import {
    detectTaskIntentDomain,
    resolveTaskCapabilityRequirements,
} from '../src/mastra/capabilityRegistry';

describe('capabilityRegistry', () => {
    test('infers web_research for generic external lookup tasks beyond stock-only wording', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '请帮我查询今天 AI 行业的最新新闻并总结三点',
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('web_research');
        expect(detectTaskIntentDomain('请帮我查询今天 AI 行业的最新新闻并总结三点')).toBe('news');
    });

    test('does not over-trigger web_research for code maintenance text with date words', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '请修复今天新增测试失败并更新对应函数',
            workspacePath: process.cwd(),
        });
        expect(requirements).not.toContain('web_research');
    });

    test('infers browser_automation for browser operation tasks', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '打开网页并截图保存当前页面',
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('browser_automation');
    });
});
