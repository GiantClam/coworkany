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

    test('does not over-trigger web_research for local web task ids and output-path instructions', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '请完成 web-004-form-inventory：读取 workspace/form.html 并写入 workspace/form_fields.json',
            workspacePath: process.cwd(),
        });
        expect(requirements).not.toContain('web_research');
    });

    test('infers web_research for investment advice query with ticker format', () => {
        const message = '帮我研究 Nvidia (NVDA) 最近的表现，给出投资建议（买入/持有/卖出），说明理由';
        const requirements = resolveTaskCapabilityRequirements({
            message,
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('web_research');
        expect(detectTaskIntentDomain(message)).toBe('market');
    });

    test('does not over-trigger web_research for local directory listing requests with temporal words', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '列出当前目录下的所有文件并按大小排序',
            workspacePath: process.cwd(),
        });
        expect(requirements).not.toContain('web_research');
    });

    test('infers command_execution for shell-backed cleanup requests', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '清除 ./images 目录下的相似图片并输出执行结果',
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('command_execution');
    });

    test('does not over-trigger command_execution for read-only directory listing requests', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '列出 workspace/images 目录下的文件并统计数量',
            workspacePath: process.cwd(),
        });
        expect(requirements).not.toContain('command_execution');
    });

    test('keeps web_research for market query even when user asks to save output locally', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '查询 NVDA 最新股价并把结果写入 ./reports/nvda.md',
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('web_research');
    });
});
