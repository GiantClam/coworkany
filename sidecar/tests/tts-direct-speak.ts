/**
 * 直接测试 TTS 朗读功能
 * 运行: cd sidecar && bun run tests/tts-direct-speak.ts
 */

import { speakText } from '../src/tools/core/voice';
import { buildScheduledTaskSpokenText } from '../src/scheduling/scheduledTaskPresentation';

const longContent = `
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

async function main() {
    console.log('=== TTS 直接朗读测试 ===\n');
    
    // 构建朗读文本
    const spokenText = buildScheduledTaskSpokenText({
        title: '整理 Reddit',
        success: true,
        finalAssistantText: longContent,
    });
    
    console.log(`原始内容长度: ${longContent.length} 字符`);
    console.log(`朗读文本长度: ${spokenText.length} 字符`);
    console.log(`\n朗读文本预览 (前 500 字):`);
    console.log(spokenText.slice(0, 500));
    console.log('...\n');
    
    // 实际朗读
    console.log('正在尝试朗读...（请听是否能完整朗读）');
    
    const result = await speakText(spokenText, { 
        taskId: 'test-tts', 
        workspacePath: '.' 
    }, 'test');
    
    console.log('\n=== 朗读结果 ===');
    console.log(result);
    
    // 等待一段时间让 TTS 播放完成
    console.log('\n等待 TTS 播放完成 (3秒)...');
    await new Promise(r => setTimeout(r, 3000));
    
    if (result.success) {
        console.log('\n✅ 朗读已触发！请听是否完整朗读了所有 10 篇文章内容。');
    } else {
        console.log(`\n❌ 朗读失败: ${result.error}`);
    }
    
    console.log('\n测试完成。');
}

main().catch(console.error);
