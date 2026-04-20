import { describe, expect, test } from 'bun:test';
import {
    detectTaskIntentDomain,
    normalizeResolvedAttachmentsMessage,
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

    test('does not force web_research for workspace-only debate orchestration tasks', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: [
                'Task: Multi-Agent Research Debate',
                'Read workspace/topic.md and generate workspace/debate/pro_argument.md, workspace/debate/con_argument.md,',
                'workspace/debate/rebuttal_pro.md, workspace/debate/rebuttal_con.md, workspace/debate/synthesis.md,',
                'then write final workspace/analysis.md.',
            ].join('\n'),
            workspacePath: process.cwd(),
        });
        expect(requirements).not.toContain('web_research');
        expect(requirements).toContain('artifact_write');
    });

    test('does not force web_research or command_execution for workspace decomposition instructions', () => {
        const message = [
            '# Task: Multi-Agent Project Decomposition',
            'Create workspace/orchestration/task_plan.json and workspace/orchestration/integration_log.md.',
            'Write workspace/project/tasknote.py, workspace/project/test_tasknote.py, workspace/project/README.md.',
            'Document acceptance evidence in integration log.',
        ].join('\n');
        const requirements = resolveTaskCapabilityRequirements({
            message,
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('artifact_write');
        expect(requirements).not.toContain('web_research');
        expect(requirements).not.toContain('command_execution');
        expect(detectTaskIntentDomain(message)).toBe('general');
    });

    test('does not force command_execution for staged workspace data-pipeline specs', () => {
        const message = [
            '# Task: Multi-Agent Data Pipeline Handoff',
            'Input: workspace/raw_data.csv',
            'Output: workspace/pipeline/stage1_clean.csv',
            'Output: workspace/pipeline/stage2_features.csv',
            'Output: workspace/pipeline/stage3_stats.json',
            'Output: workspace/pipeline/stage4_report.md',
            'Output: workspace/report.md',
        ].join('\n');
        const requirements = resolveTaskCapabilityRequirements({
            message,
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('artifact_write');
        expect(requirements).not.toContain('command_execution');
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

    test('infers web_research for buy-price follow-up query without explicit ticker', () => {
        const message = '根据上述信息，给我兖矿能源的买入价格';
        const requirements = resolveTaskCapabilityRequirements({
            message,
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('web_research');
        expect(detectTaskIntentDomain(message)).toBe('market');
    });

    test('infers web_research for business cooperation decision-support query', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '请评估我们和字节在 AI Agent 方向的商业合作可行性，给出合作方案建议和主要风险',
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('web_research');
    });

    test('infers web_research for platform trending content lookup queries', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '今天 blibli 上有什么热门视频？',
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('web_research');
    });

    test('infers web_research for generic trending-content lookup without platform keyword', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '今天有什么热门视频推荐？',
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('web_research');
    });

    test('does not over-trigger web_research for local directory listing requests with temporal words', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '列出当前目录下的所有文件并按大小排序',
            workspacePath: process.cwd(),
        });
        expect(requirements).not.toContain('web_research');
    });

    test('does not over-trigger web_research for local video folder operations', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '把 workspace/videos/热门视频 目录下的文件重命名并按日期归档',
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
        expect(requirements).not.toContain('artifact_write');
    });

    test('infers command_execution for explicit run_command token requests', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '请使用 run_command 执行 echo "CoworkAny Test Success" 并返回输出',
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('command_execution');
    });

    test('infers command_execution for resolved-attachment derivative tasks', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '[Resolved attachments]\n- /tmp/input.jpeg\n\n将附件图片转为 png 格式',
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('command_execution');
    });

    test('does not infer command_execution for resolved-attachment read-only requests', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '[Resolved attachments]\n- /tmp/input.jpeg\n\n请描述这张附件图片里有什么',
            workspacePath: process.cwd(),
        });
        expect(requirements).not.toContain('command_execution');
    });

    test('does not infer browser domain from attachment filenames containing screenshot words', () => {
        const message = [
            '[Resolved attachments]',
            '- /tmp/截屏2026-04-03 09.25.43.png',
            '- /tmp/截屏2026-04-06 21.01.29.png',
            '',
            '把附件图片合并为一个视频，每张图片播放 5s',
        ].join('\n');
        const requirements = resolveTaskCapabilityRequirements({
            message,
            workspacePath: process.cwd(),
        });
        expect(detectTaskIntentDomain(message)).toBe('general');
        expect(requirements).toContain('command_execution');
        expect(requirements).not.toContain('browser_automation');
    });

    test('normalizes single-line resolved attachment blocks before capability inference', () => {
        const message = '[Resolved attachments] - /tmp/截屏2025-10-17 22.01.27.png - /tmp/截屏2026-04-06 21.01.29.png 把附件图片合并为一个视频，每张图片播放 5s';
        const normalized = normalizeResolvedAttachmentsMessage(message);
        const requirements = resolveTaskCapabilityRequirements({
            message,
            workspacePath: process.cwd(),
        });
        expect(normalized).toContain('[Resolved attachments]\n- /tmp/截屏2025-10-17 22.01.27.png');
        expect(detectTaskIntentDomain(message)).toBe('general');
        expect(requirements).toContain('command_execution');
        expect(requirements).not.toContain('browser_automation');
    });

    test('normalizes and infers capabilities for single-line resolved attachments with absolute staged paths', () => {
        const attachmentPaths = [
            '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2025-10-17 22.01.27.png',
            '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2026-01-06 15.34.56.png',
            '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2026-04-06 21.01.29.png',
            '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2026-04-03 09.25.43.png',
            '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2026-01-17 11.30.46.png',
            '/Users/beihuang/Library/Application Support/com.coworkany.desktop/workspaces/workspace/.coworkany/attachments/staged/-截屏2026-01-17 11.30.35.png',
        ];
        const message = `[Resolved attachments] - ${attachmentPaths.join(' - ')} 把附件图片合并为一个视频，每张图片播放 5s`;
        const normalized = normalizeResolvedAttachmentsMessage(message);
        const requirements = resolveTaskCapabilityRequirements({
            message,
            workspacePath: process.cwd(),
        });
        expect(normalized).toContain('[Resolved attachments]');
        for (const attachmentPath of attachmentPaths) {
            expect(normalized).toContain(`- ${attachmentPath}`);
        }
        expect(detectTaskIntentDomain(message)).toBe('general');
        expect(requirements).toContain('command_execution');
        expect(requirements).not.toContain('browser_automation');
    });

    test('infers command_execution for colloquial attachment slideshow intent', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: [
                '[Resolved attachments]',
                '- /tmp/a.png',
                '- /tmp/b.png',
                '',
                '把这几张图弄成一个短片，每张停5秒',
            ].join('\n'),
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('command_execution');
    });

    test('does not infer artifact_write for command-output wording with script paths', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: [
                'Clean similar images in: ./images',
                'Use this exact script first: node "./remove_similar_images.mjs" "./images" --delete --threshold 0',
                'You must print DEDUPE_DONE marker from command output and then stop.',
            ].join('\n'),
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('command_execution');
        expect(requirements).not.toContain('artifact_write');
    });

    test('infers command_execution for recycle-bin cleanup intents', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '帮我清空回收站',
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('command_execution');
    });

    test('infers command_execution for folder move intents', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '把 /Users/demo/Downloads/tmp 移动到 /Users/demo/Documents/archive',
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('command_execution');
    });

    test('infers command_execution for generic local host-operation intents', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '请整理 Downloads 文件夹并归档到桌面',
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('command_execution');
    });

    test('infers command_execution for current date/time queries', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '今天是几号',
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('command_execution');
    });

    test('infers command_execution for english current date/time queries', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: "What's the current date today?",
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('command_execution');
        expect(requirements).not.toContain('web_research');
    });

    test('does not infer command_execution for read-only local directory listing requests', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '列出 workspace/images 目录下的文件并统计数量',
            workspacePath: process.cwd(),
        });
        expect(requirements).not.toContain('command_execution');
        expect(requirements).toContain('filesystem_read');
        expect(requirements).not.toContain('web_research');
    });

    test('infers command_execution for relative-path move intents', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '请把 workspace/videos/热门视频 移动到 archive',
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('command_execution');
        expect(requirements).not.toContain('web_research');
    });

    test('does not infer command_execution for explicit "do not execute commands" constraints', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '请用一句中文回复“桌面端回复回归验证通过”，不要执行命令或调用工具。',
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
        expect(requirements).toContain('artifact_write');
        expect(requirements).not.toContain('command_execution');
    });

    test('infers artifact_write for explicit file replacement tasks', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '把 .coworkany/test-workspace/fs03-replace.txt 中的 Hello World 替换成 Hello CoworkAny',
            workspacePath: process.cwd(),
        });
        expect(requirements).toContain('artifact_write');
    });

    test('does not infer artifact_write for pure external research without local file intent', () => {
        const requirements = resolveTaskCapabilityRequirements({
            message: '搜索今天 AI 行业最新新闻并总结三个重点',
            workspacePath: process.cwd(),
        });
        expect(requirements).not.toContain('artifact_write');
        expect(requirements).toContain('web_research');
    });
});
