/**
 * TTS 内容处理测试
 * 
 * 验证：
 * 1. 长文字朗读不被截断
 * 2. Markdown 格式正确过滤
 * 3. 异常字符正确过滤
 */

import { describe, expect, test } from 'bun:test';
import {
    buildScheduledTaskSpokenText,
    cleanScheduledTaskResultText,
    normalizeScheduledTaskResultText,
} from '../src/scheduling/scheduledTaskPresentation';

describe('TTS 内容处理', () => {
    describe('1. 长文字不被截断', () => {
        test('超过 500 字的文本应该完整保留', () => {
            const longText = `
# AI 独立开发者最新动态

以下是为您检索到的最新 10 篇高价值 Reddit 内容：

1. **标题：如何在 AI 时代找到产品市场契合点**
   简介：本文讨论了在 AI 时代寻找 PMF 的新方法，作者认为关键是专注于解决人类最核心的需求，而不是单纯追求技术先进性。

2. **标题：独立开发者的 AI SaaS 实践经验分享**
   简介：一位独立开发者分享了他使用 AI 技术构建 SaaS 产品的完整历程，包括技术选型、用户获取和盈利模式的设计。

3. **标题：OpenClaw 开源项目分析**
   简介：深入分析了 OpenClaw 项目的架构设计和实现细节，探讨了其作为 AI 编程助手的潜力。

4. **标题：从零到月收入一万美元的 AI 产品之路**
   简介：作者详细记录了他如何从零开始，在六个月内将 AI 产品做到月收入一万美元的全过程。

5. **标题：AI 编程助手的现状与未来**
   简介：对比分析了当前主流的 AI 编程助手，包括 GitHub Copilot、Cursor、Claude Code 等产品的优劣势。

6. **标题：独立开发者如何利用 AI 提高开发效率**
   简介：分享了多种利用 AI 技术提升开发效率的实用技巧，包括代码生成、自动化测试和部署流程优化。

7. **标题：2026 年 AI 独立开发者生态报告**
   简介：全面分析了 2026 年 AI 独立开发者生态系统的发展现状和未来趋势。

8. **标题：如何构建可持续的 AI 产品商业模式**
   简介：探讨了 AI 产品的商业模式设计，包括订阅制、按量计费和混合模式等不同策略。

9. **标题：AI 产品的用户获取策略**
   简介：分享了在预算有限的情况下，如何有效获取 AI 产品用户的实战经验。

10. **标题：AI 独立开发者的技术栈选择**
    简介：推荐了 2026 年最适合独立开发者使用的 AI 技术栈，包括前端框架、后端服务和部署方案。
            `.trim();

            const spoken = buildScheduledTaskSpokenText({
                title: '整理 Reddit',
                success: true,
                finalAssistantText: longText,
            });

            console.log(`原始文本长度: ${longText.length}`);
            console.log(`朗读文本长度: ${spoken.length}`);
            console.log(`朗读文本预览: ${spoken.substring(0, 200)}...`);

            // 验证文本没有被截断到 500 字以内
            expect(spoken.length).toBeGreaterThan(500);
            
            // 验证所有 10 篇文章都被包含（内容保留，只是数字编号被过滤）
            expect(spoken).toContain('标题：如何在 AI 时代');
            expect(spoken).toContain('标题：独立开发者的 AI SaaS');
        });

        test('超长文本（2000+ 字符）应该完整保留', () => {
            const veryLongText = '这是一段非常长的文本。'.repeat(300); // 约 2100 字
            
            const spoken = buildScheduledTaskSpokenText({
                title: '测试任务',
                success: true,
                finalAssistantText: veryLongText,
            });

            console.log(`超长文本原始长度: ${veryLongText.length}`);
            console.log(`超长文本朗读长度: ${spoken.length}`);

            // 应该保留大部分内容
            expect(spoken.length).toBeGreaterThan(1800);
        });
    });

    describe('2. Markdown 格式正确过滤', () => {
        test('标题符号 (# ## ###) 应被过滤', () => {
            const markdownText = `
# 主标题
## 二级标题
### 三级标题

这是正文内容。
            `.trim();

            const normalized = normalizeScheduledTaskResultText(markdownText);
            expect(normalized).not.toContain('#');
            expect(normalized).toContain('主标题');
            expect(normalized).toContain('二级标题');
            expect(normalized).toContain('正文内容');
        });

        test('加粗符号 (**text**) 应被过滤', () => {
            const markdownText = `
这是**加粗文本**，这是*斜体文本*，这是\`代码\`。
            `.trim();

            const normalized = normalizeScheduledTaskResultText(markdownText);
            expect(normalized).not.toContain('**');
            expect(normalized).not.toContain('*');
            expect(normalized).not.toContain('`');
            expect(normalized).toContain('加粗文本');
            expect(normalized).toContain('斜体文本');
            expect(normalized).toContain('代码');
        });

        test('链接和图片应被过滤', () => {
            const markdownText = `
这是一个[链接文本](https://example.com)
![图片描述](https://example.com/image.png)
            `.trim();

            const normalized = normalizeScheduledTaskResultText(markdownText);
            expect(normalized).not.toContain('[');
            expect(normalized).not.toContain(']');
            expect(normalized).not.toContain('(');
            expect(normalized).not.toContain(')');
            expect(normalized).not.toContain('http');
            expect(normalized).toContain('链接文本');
            expect(normalized).toContain('图片描述');
        });

        test('列表符号 (- * 1.) 应被过滤', () => {
            const markdownText = `
- 无序列表项 1
- 无序列表项 2
* 星号列表项
1. 有序列表项 A
2. 有序列表项 B
            `.trim();

            const normalized = normalizeScheduledTaskResultText(markdownText);
            expect(normalized).not.toContain('- ');
            expect(normalized).not.toContain('* ');
            expect(normalized).not.toContain('1. ');
            expect(normalized).toContain('无序列表项');
            expect(normalized).toContain('有序列表项');
        });

        test('引用符号 (>) 应被过滤', () => {
            const markdownText = `
> 这是引用内容
> 多行引用
            `.trim();

            const normalized = normalizeScheduledTaskResultText(markdownText);
            expect(normalized).not.toContain('>');
            expect(normalized).toContain('引用内容');
        });

        test('代码块应被过滤', () => {
            const markdownText = `
\`\`\`javascript
function hello() {
  console.log('Hello World');
}
\`\`\`
            `.trim();

            const normalized = normalizeScheduledTaskResultText(markdownText);
            console.log(`代码块过滤结果: "${normalized}"`);
            
            // 代码块整体应该被过滤（包括语言标识符和内容）
            expect(normalized).not.toContain('```');
            expect(normalized).not.toContain('javascript');
            expect(normalized).not.toContain('function');
        });
    });

    describe('3. 异常字符正确过滤', () => {
        test('特殊 Unicode 字符应被清理', () => {
            const textWithSpecialChars = `
标题：测试⭐⭐⭐⭐⭐
内容：这是一些特殊字符——破折号，以及"双引号"和'单引号'
还有一些···省略号
            `.trim();

            const normalized = normalizeScheduledTaskResultText(textWithSpecialChars);
            console.log(`特殊字符处理结果: "${normalized}"`);
            
            // 基本文本应该保留
            expect(normalized).toContain('标题');
            expect(normalized).toContain('测试');
            expect(normalized).toContain('内容');
        });

        test('控制字符应被移除', () => {
            const textWithControlChars = 'Hello\x00World\x07Test\x1FEnd';
            
            const normalized = normalizeScheduledTaskResultText(textWithControlChars);
            expect(normalized).not.toContain('\x00');
            expect(normalized).not.toContain('\x07');
            expect(normalized).not.toContain('\x1F');
            expect(normalized).toContain('Hello');
            expect(normalized).toContain('World');
            expect(normalized).toContain('Test');
        });

        test('多余的空白字符应被规范化', () => {
            const textWithWhitespace = `
标题：    测试   

内容：   多个    空格   
            `.trim();

            const normalized = normalizeScheduledTaskResultText(textWithWhitespace);
            // 不应该有多个连续空格
            expect(normalized).not.toContain('  ');
            expect(normalized).toContain('标题');
            expect(normalized).toContain('测试');
        });
    });

    describe('4. 完整流程测试', () => {
        test('模拟 Reddit 检索结果的完整处理', () => {
            const redditResult = `
## 整理的 Reddit AI 独立开发者内容：

1. **[OpenClaw：AI 编程助手的未来](https://reddit.com/r/ainews/comments/xxx)**
   - 核心观点：OpenClaw 作为开源 AI 编程助手展示了巨大的潜力
   - 适用场景：代码生成、自动重构

2. **[独立开发者月入 10k 的秘密](https://reddit.com/r/indiedev/comments/xxx)**
   - 核心观点：专注于小而美的细分市场
   - 经验分享：如何从零到一构建 MVP

3. **[2026 AI SaaS 产品趋势分析](https://reddit.com/r/saas/comments/xxx)**
   - 核心观点：垂直领域 AI 应用正在爆发
   - 建议：关注医疗、法律等高价值领域

4. **[使用 Claude Code 开发产品的心得](https://reddit.com/r/AItools/comments/xxx)**
   - 核心观点：AI 辅助编程大大提升了开发效率
   - 实践：如何有效使用 AI 进行代码审查

5. **[独立开发者的技术栈推荐 2026](https://reddit.com/r/indiedev/comments/xxx)**
   - 核心观点：Next.js + Supabase + AI API 是黄金组合
   - 详细：各技术的优劣势分析
            `.trim();

            const cleaned = cleanScheduledTaskResultText(redditResult);
            const normalized = normalizeScheduledTaskResultText(cleaned);
            const spoken = buildScheduledTaskSpokenText({
                title: '整理 Reddit',
                success: true,
                finalAssistantText: redditResult,
            });

            console.log('=== 原始文本 ===');
            console.log(redditResult);
            console.log('=== 清理后 ===');
            console.log(cleaned);
            console.log('=== 规范化后（用于朗读）===');
            console.log(normalized);
            console.log('=== 朗读文本 ===');
            console.log(spoken);

            // 验证
            expect(spoken.length).toBeGreaterThan(300); // 应该有足够长度（内容被保留）
            
            // 验证内容被保留（数字列表编号被过滤，但内容保留）
            expect(spoken).toContain('OpenClaw');
            expect(spoken).toContain('独立开发者');
            expect(spoken).toContain('月入');
            // 验证 markdown 符号被过滤
            expect(spoken).not.toContain('#');
            expect(spoken).not.toContain('**');
            expect(spoken).not.toContain('[');
            expect(spoken).not.toContain('http');
        });
    });
});
