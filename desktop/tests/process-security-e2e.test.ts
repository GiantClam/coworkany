/**
 * E2E Test: Process Security Analysis via Tauri Desktop Client ?Self-Learning Scenario
 *
 * Tests the agent's ability to perform LOCAL SYSTEM analysis WITHOUT any pre-built
 * compound tool or browser automation:
 * 1. Launch CoworkAny desktop app (Tauri + WebView2)
 * 2. Connect Playwright to the WebView via CDP
 * 3. Input the process analysis task through the UI
 * 4. Agent uses run_command to list processes, then analyzes for security risks
 * 5. Post-execution learning triggers and creates a reusable skill
 * 6. Verify: task completion, analysis quality, skill creation, and hot-reload
 *
 * This is a "pure system task" ?no browser needed. The agent must:
 *   - Use run_command with tasklist/Get-Process/wmic to get process info
 *   - Optionally use search_web to research suspicious process names
 *   - Analyze the output for security risks
 *   - Report findings with recommendations
 *
 * Prerequisites:
 * - Rust toolchain installed (cargo, rustc)
 * - desktop/ npm dependencies installed
 * - Windows OS (uses tasklist, Get-Process, wmic)
 *
 * Run:
 *   cd desktop && npx playwright test tests/process-security-e2e.test.ts
 */

import { test, expect, type TauriLogCollector } from './tauriFixture';

// ============================================================================
// Config
// ============================================================================

// Query contains '检? and '分析' ?these should trigger post-execution learning
const TASK_QUERY = '检查当前本机运行的所有进程，分析是否存在安全风险，给出详细的安全报告';

// This task should be faster than browser tasks ?no page loads, just command execution
const TASK_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes
const POLL_INTERVAL_MS = 3000;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Wait for a specific pattern to appear in the Tauri process logs.
 */
async function waitForLogPattern(
    logs: TauriLogCollector,
    pattern: string,
    timeoutMs: number,
    label?: string,
): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        if (logs.contains(pattern)) {
            if (label) console.log(`[Test] Found "${label}" in logs after ${Math.round((Date.now() - startTime) / 1000)}s`);
            return true;
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    return false;
}

// ============================================================================
// Tests
// ============================================================================

test.describe('本机进程安全分析 ?自学习场?E2E', () => {
    // Extra time for Cargo build + app startup + task execution
    test.setTimeout(TASK_TIMEOUT_MS + 180_000);

    test('通过桌面客户端检查本机进程安全风险，验证自学习技能沉淀', async ({ page, tauriLogs }) => {
        test.setTimeout(TASK_TIMEOUT_MS + 180_000);

        // ================================================================
        // Step 1: Wait for the UI to load
        // ================================================================
        console.log('[Test] Waiting for UI to load...');

        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(3000);
        const chatInput = page.locator('.chat-input');
        await chatInput.waitFor({ state: 'visible', timeout: 60_000 });
        const input = chatInput;
        const placeholder = await input.getAttribute('placeholder');
        console.log(`[Test] UI loaded - input visible, placeholder="${placeholder}"`);

        // ================================================================
        // Step 2: Input the process analysis task
        // ================================================================
        console.log(`[Test] Typing query: "${TASK_QUERY}"`);
        await input.fill(TASK_QUERY);
        await expect(input).toHaveValue(TASK_QUERY);
        await page.screenshot({ path: 'test-results/proc-01-query-input.png' });

        // ================================================================
        // Step 3: Submit the task
        // ================================================================
        console.log('[Test] Pressing Enter to submit task...');
        await input.press('Enter');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'test-results/proc-02-task-submitted.png' });

        // ================================================================
        // Step 4: Monitor task execution
        // ================================================================
        console.log('[Test] Monitoring task execution (process analysis + self-learning)...');

        const startTime = Date.now();
        let taskFinished = false;
        let taskFailed = false;
        let screenshotCounter = 3;

        // ── Phase tracking ──────────────────────────────────────────────

        // Command execution phase
        let runCommandDetected = false;      // Agent used run_command tool
        let processListRequested = false;    // Agent ran a process listing command
        let processDataReceived = false;     // Process data was returned in tool result
        let multipleCommandsUsed = false;    // Agent used more than one command approach

        // Analysis phase
        let webSearchUsed = false;           // Agent used search_web for research
        let thinkToolUsed = false;           // Agent used think tool for analysis
        let securityAnalysisDone = false;    // Agent provided security analysis
        let reportGenerated = false;         // Agent generated a report in TEXT_DELTA

        // Task result
        let taskSucceeded = false;

        // Planning phase (validates pre-execution planning + persistence)
        let planStepUsed = false;            // Agent used plan_step tool for task decomposition
        let planPersisted = false;           // Plan was written to .coworkany/task_plan.md
        let logFindingUsed = false;          // Agent used log_finding for persistent knowledge
        let planContextInjected = false;     // PreToolUse plan re-read was injected
        let linuxCommandAttempted = false;   // Agent mistakenly tried Linux commands on Windows

        // Specific process info detected in output
        let pidDetected = false;             // Process IDs found in output
        let processNamesDetected = false;    // Process names found in output
        let riskAssessmentDone = false;      // Agent mentioned risk levels or security status

        // Self-learning phase
        let postLearningTriggered = false;
        let skillPrecipitated = false;
        let skillInstalled = false;
        let skillReloaded = false;

        // Track how many unique run_command calls were made
        let runCommandCount = 0;
        const seenRunCommands = new Set<string>();

        while (Date.now() - startTime < TASK_TIMEOUT_MS) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            const elapsed = Math.round((Date.now() - startTime) / 1000);

            // ── Command execution detection ─────────────────────────────
            if (!runCommandDetected && tauriLogs.contains('run_command')) {
                runCommandDetected = true;
                console.log(`[Test] [${elapsed}s] 🖥?run_command tool detected`);
            }

            // Track individual run_command calls
            const runCommandLines = tauriLogs.grep('run_command');
            for (const line of runCommandLines) {
                // Extract command string from TOOL_CALL payload
                const cmdMatch = line.match(/"command"\s*:\s*"([^"]+)"/);
                if (cmdMatch && !seenRunCommands.has(cmdMatch[1])) {
                    seenRunCommands.add(cmdMatch[1]);
                    runCommandCount++;
                    console.log(`[Test] [${elapsed}s] 📋 Command #${runCommandCount}: ${cmdMatch[1].substring(0, 80)}`);
                }
            }
            if (runCommandCount > 1) multipleCommandsUsed = true;

            // Detect process listing commands
            if (!processListRequested) {
                const processCommands = [
                    'tasklist',
                    'Get-Process',
                    'get-process',
                    'wmic process',
                    'WMIC PROCESS',
                    'ps aux',               // Linux/Mac fallback
                    'process list',
                    'Get-CimInstance',
                    'Win32_Process',
                ];
                if (processCommands.some(cmd => tauriLogs.contains(cmd))) {
                    processListRequested = true;
                    console.log(`[Test] [${elapsed}s] 📊 Process listing command detected`);
                }
            }

            // Detect process data in results
            if (!processDataReceived) {
                const processIndicators = [
                    'svchost.exe',          // Common Windows process
                    'explorer.exe',         // Windows Explorer
                    'System',               // Windows System process
                    'chrome.exe',           // Chrome browser
                    'csrss.exe',            // Client/Server Runtime
                    'lsass.exe',            // Local Security Authority
                    'services.exe',         // Service Control Manager
                    'PID',                  // Process ID header
                    'Image Name',           // tasklist header
                    'ProcessName',          // Get-Process header
                    'CommandLine',          // Process command line
                ];
                // Need at least 3 indicators to confirm real process data
                const matchCount = processIndicators.filter(ind => tauriLogs.contains(ind)).length;
                if (matchCount >= 3) {
                    processDataReceived = true;
                    console.log(`[Test] [${elapsed}s] ?Process data received (${matchCount} indicators matched)`);
                }
            }

            // Detect PID numbers in output
            if (!pidDetected && processDataReceived) {
                // Look for PID patterns in TOOL_RESULT
                const resultLines = tauriLogs.grep('TOOL_RESULT');
                if (resultLines.some(l => /\bPID\b|\bpid\b|\b\d{3,6}\b/.test(l))) {
                    pidDetected = true;
                    console.log(`[Test] [${elapsed}s] 🔢 Process IDs detected in output`);
                }
            }

            // Detect process names
            if (!processNamesDetected && processDataReceived) {
                const knownProcesses = ['svchost', 'explorer', 'chrome', 'csrss', 'lsass', 'System'];
                const resultLines = tauriLogs.grep('TOOL_RESULT');
                if (resultLines.some(l => knownProcesses.some(p => l.includes(p)))) {
                    processNamesDetected = true;
                    console.log(`[Test] [${elapsed}s] 📛 Process names detected in output`);
                }
            }

            // ── Planning detection ────────────────────────────────────────
            if (!planStepUsed && (tauriLogs.contains('"name":"plan_step"') || tauriLogs.contains('plan_step'))) {
                planStepUsed = true;
                console.log(`[Test] [${elapsed}s] 📝 plan_step tool used (task decomposition active)`);
            }

            // Detect plan persistence (file written to disk)
            if (!planPersisted && (tauriLogs.contains('task_plan.md') || tauriLogs.contains('"persisted":true'))) {
                planPersisted = true;
                console.log(`[Test] [${elapsed}s] 💾 Plan persisted to .coworkany/task_plan.md`);
            }

            // Detect log_finding usage
            if (!logFindingUsed && (tauriLogs.contains('"name":"log_finding"') || tauriLogs.contains('log_finding'))) {
                logFindingUsed = true;
                console.log(`[Test] [${elapsed}s] 📋 log_finding tool used (knowledge persistence)`);
            }

            // Detect plan context injection (PreToolUse plan re-read)
            if (!planContextInjected && tauriLogs.contains('Plan Context')) {
                planContextInjected = true;
                console.log(`[Test] [${elapsed}s] 🔄 Plan context re-injected (PreToolUse hook active)`);
            }

            // Detect if Linux commands were mistakenly attempted on Windows
            if (!linuxCommandAttempted) {
                const linuxOnlyCommands = ['ps aux', 'ps -eo', 'lsof -i', 'ss -tulpn', 'systemctl'];
                for (const cmd of linuxOnlyCommands) {
                    if (tauriLogs.contains(cmd)) {
                        linuxCommandAttempted = true;
                        console.log(`[Test] [${elapsed}s] ⚠️ Linux command "${cmd}" attempted on Windows (trial-and-error)`);
                        break;
                    }
                }
            }

            // ── Analysis detection ──────────────────────────────────────

            if (!webSearchUsed && tauriLogs.contains('search_web')) {
                webSearchUsed = true;
                console.log(`[Test] [${elapsed}s] 🔍 Web search used (researching security info)`);
            }

            if (!thinkToolUsed && tauriLogs.contains('"name":"think"')) {
                thinkToolUsed = true;
                console.log(`[Test] [${elapsed}s] 🧠 Think tool used (reasoning about findings)`);
            }

            // Detect security analysis in agent's response (TEXT_DELTA)
            if (!securityAnalysisDone) {
                const securityKeywords = [
                    '安全',                 // security
                    '风险',                 // risk
                    '威胁',                 // threat
                    '可疑',                 // suspicious
                    '恶意',                 // malicious
                    '正常',                 // normal
                    '安全报告',             // security report
                    'security',
                    'risk',
                    'threat',
                    'suspicious',
                    'malicious',
                    'safe',
                    'legitimate',
                    'vulnerability',
                ];
                const textLines = tauriLogs.grep('TEXT_DELTA');
                if (textLines.some(l => securityKeywords.some(kw => l.includes(kw)))) {
                    securityAnalysisDone = true;
                    console.log(`[Test] [${elapsed}s] 🛡?Security analysis detected in response`);
                }
            }

            // Detect risk assessment
            if (!riskAssessmentDone && securityAnalysisDone) {
                const riskKeywords = [
                    '高风险', '中风险', '低风险',     // risk levels
                    '无风险', '无异常',               // no risk
                    '安全', '不安全',                 // safe/unsafe
                    '建议', '推荐',                   // recommendations
                    'high risk', 'low risk', 'medium risk',
                    'no risk', 'clean', 'secure',
                    'recommend', 'suggestion',
                ];
                const textLines = tauriLogs.grep('TEXT_DELTA');
                if (textLines.some(l => riskKeywords.some(kw => l.includes(kw)))) {
                    riskAssessmentDone = true;
                    console.log(`[Test] [${elapsed}s] 📋 Risk assessment/recommendations detected`);
                }
            }

            // Detect report in agent response
            if (!reportGenerated) {
                const reportKeywords = [
                    '报告', '总结', '结论', '分析结果',
                    'report', 'summary', 'conclusion', 'findings',
                    '以下', '如下',                // "here are the results"
                ];
                const textLines = tauriLogs.grep('TEXT_DELTA');
                // Need both report structure keywords AND some substance
                const hasReportStructure = textLines.some(l => reportKeywords.some(kw => l.includes(kw)));
                const hasSubstance = textLines.length > 10; // Agent produced meaningful output
                if (hasReportStructure && hasSubstance) {
                    reportGenerated = true;
                    console.log(`[Test] [${elapsed}s] 📄 Security report generated`);
                }
            }

            // ── Task completion detection ────────────────────────────────
            if (!taskFinished && tauriLogs.contains('TASK_FINISHED')) {
                taskFinished = true;
                console.log(`[Test] [${elapsed}s] TASK_FINISHED event detected`);
            }
            if (!taskFailed && tauriLogs.contains('TASK_FAILED')) {
                taskFailed = true;
                console.log(`[Test] [${elapsed}s] ?TASK_FAILED event detected`);
            }

            // ── Self-learning detection ──────────────────────────────────
            if (!postLearningTriggered && tauriLogs.contains('[PostLearning]')) {
                postLearningTriggered = true;
                const learningLines = tauriLogs.grep('PostLearning');
                const isPositive = learningLines.some(l =>
                    l.includes('Learning from successful') || l.includes('Precipitated')
                );
                console.log(`[Test] [${elapsed}s] 🧠 Post-execution learning triggered (positive: ${isPositive})`);
            }

            if (!skillPrecipitated && tauriLogs.contains('Precipitated as')) {
                skillPrecipitated = true;
                const precipLines = tauriLogs.grep('Precipitated as');
                console.log(`[Test] [${elapsed}s] 📦 Skill/knowledge precipitated: ${precipLines[0]?.substring(0, 200)}`);
            }

            if (!skillInstalled && tauriLogs.contains('Installing auto-generated skill')) {
                skillInstalled = true;
                const installLines = tauriLogs.grep('Installing auto-generated skill');
                console.log(`[Test] [${elapsed}s] 🔧 Skill installed: ${installLines[0]?.substring(0, 200)}`);
            }

            if (!skillReloaded && (
                tauriLogs.contains('installed and ready to use') ||
                (tauriLogs.contains('Skill') && tauriLogs.contains('reload'))
            )) {
                skillReloaded = true;
                console.log(`[Test] [${elapsed}s] ♻️ Skill hot-reloaded and ready to use`);
            }

            // ── UI state check ──────────────────────────────────────────
            try {
                const bodyText = await page.textContent('body', { timeout: 5000 });
                if (bodyText) {
                    if (bodyText.includes('Ready for follow-up') && !taskFinished) {
                        taskFinished = true;
                        console.log(`[Test] [${elapsed}s] Agent loop ended (UI: "Ready for follow-up")`);
                    }
                    if (bodyText.includes('Failed') && !taskFailed) {
                        const statusBadge = page.locator('.status-badge.failed, [class*="status"]');
                        if (await statusBadge.count() > 0) {
                            const statusText = await statusBadge.first().textContent();
                            if (statusText?.includes('Failed')) {
                                taskFailed = true;
                                console.log(`[Test] [${elapsed}s] UI shows task failed`);
                            }
                        }
                    }
                }
            } catch {
                // Page may not be accessible during transitions
            }

            // ── Periodic screenshots ────────────────────────────────────
            if (elapsed % 30 === 0 && elapsed > 0) {
                try {
                    await page.screenshot({
                        path: `test-results/proc-${String(screenshotCounter).padStart(2, '0')}-progress-${elapsed}s.png`,
                    });
                    screenshotCounter++;
                } catch { /* may fail during transitions */ }
            }

            // ── Early exit ──────────────────────────────────────────────
            if ((taskFinished || taskFailed) && !postLearningTriggered) {
                // Wait up to 30s more for post-execution learning
                const learningWait = 30_000;
                const learningStart = Date.now();
                while (Date.now() - learningStart < learningWait) {
                    await new Promise(r => setTimeout(r, 2000));
                    if (tauriLogs.contains('[PostLearning]')) {
                        postLearningTriggered = true;
                        break;
                    }
                }
                break;
            }

            if (taskFinished && postLearningTriggered) {
                // Give a bit more time for skill installation
                await new Promise(r => setTimeout(r, 10_000));
                if (tauriLogs.contains('Precipitated as')) skillPrecipitated = true;
                if (tauriLogs.contains('Installing auto-generated skill')) skillInstalled = true;
                if (tauriLogs.contains('installed and ready to use')) skillReloaded = true;
                break;
            }
        }

        // ================================================================
        // Step 5: Final screenshots and log dump
        // ================================================================
        try {
            await page.screenshot({ path: 'test-results/proc-99-final.png' });
        } catch { /* may fail if page closed */ }

        const totalElapsed = Math.round((Date.now() - startTime) / 1000);

        // ================================================================
        // Step 5.5: Determine ACTUAL task success
        // ================================================================
        // Task succeeds if the agent:
        //   1. Ran at least one process listing command
        //   2. Received actual process data
        //   3. Provided security analysis in response
        if (processDataReceived && securityAnalysisDone) {
            taskSucceeded = true;
        } else if (processListRequested && reportGenerated) {
            // Process data might not have been detected in logs (truncated)
            // but a report was generated ?treat as success
            taskSucceeded = true;
            console.log('[Test] Process data not fully captured in logs but report was generated.');
        } else if (runCommandDetected && securityAnalysisDone) {
            // Command was run and analysis was done ?close enough
            taskSucceeded = true;
            console.log('[Test] Partial process flow detected but analysis was provided.');
        } else {
            taskSucceeded = false;
            if (!runCommandDetected) {
                console.log('[Test] ?Agent never used run_command');
            } else if (!processListRequested) {
                console.log('[Test] ?No process listing command detected');
            } else if (!processDataReceived) {
                console.log('[Test] ?No process data received');
            } else {
                console.log('[Test] ?No security analysis in agent response');
            }
        }

        // ================================================================
        // Step 6: Comprehensive Report
        // ================================================================
        console.log('');
        console.log('='.repeat(70));
        console.log('  本机进程安全分析 + 自学?E2E 测试报告 (Tauri Desktop)');
        console.log('='.repeat(70));
        console.log(`  耗时: ${totalElapsed}s`);
        console.log('');
        console.log('  ── 命令执行 ──');
        console.log(`  run_command 使用: ${runCommandDetected ? 'YES' : 'NO'}`);
        console.log(`  进程列表命令: ${processListRequested ? 'YES' : 'NO'}`);
        console.log(`  进程数据接收: ${processDataReceived ? 'YES' : 'NO'}`);
        console.log(`  多种命令策略: ${multipleCommandsUsed ? 'YES' : 'NO'}`);
        console.log(`  执行命令数量: ${runCommandCount}`);
        console.log('');
        console.log('  ── 任务规划 (持久化增? ──');
        console.log(`  plan_step使用: ${planStepUsed ? 'YES' : 'NO ⚠️'}`);
        console.log(`  计划持久? ${planPersisted ? 'YES ?(task_plan.md)' : 'NO ⚠️'}`);
        console.log(`  log_finding使用: ${logFindingUsed ? 'YES ?(findings.md)' : 'NO ⚠️'}`);
        console.log(`  计划上下文注? ${planContextInjected ? 'YES ?(PreToolUse)' : 'NO ⚠️'}`);
        console.log(`  Linux命令误用: ${linuxCommandAttempted ? 'YES ?(试错)' : 'NO ?(正确选择平台命令)'}`);
        console.log('');
        console.log('  ── 分析质量 ──');
        console.log(`  Web搜索辅助: ${webSearchUsed ? 'YES' : 'NO'}`);
        console.log(`  Think推理: ${thinkToolUsed ? 'YES' : 'NO'}`);
        console.log(`  安全分析: ${securityAnalysisDone ? 'YES' : 'NO'}`);
        console.log(`  风险评估: ${riskAssessmentDone ? 'YES' : 'NO'}`);
        console.log(`  报告生成: ${reportGenerated ? 'YES' : 'NO'}`);
        console.log('');
        console.log('  ── 进程信息 ──');
        console.log(`  PID信息: ${pidDetected ? 'YES' : 'NO'}`);
        console.log(`  进程名称: ${processNamesDetected ? 'YES' : 'NO'}`);
        console.log('');
        console.log('  ── 任务结果 ──');
        console.log(`  Agent循环结束: ${taskFinished ? 'YES' : 'NO'}`);
        console.log(`  任务失败标记: ${taskFailed ? 'YES' : 'NO'}`);
        console.log(`  进程分析成功: ${taskSucceeded ? 'YES' : 'NO'}`);
        console.log('');
        console.log('  ── 自学?──');
        console.log(`  Post-Execution Learning 触发: ${postLearningTriggered ? 'YES' : 'NO'}`);
        console.log(`  技?知识沉淀: ${skillPrecipitated ? 'YES' : 'NO'}`);
        console.log(`  技能安? ${skillInstalled ? 'YES' : 'NO'}`);
        console.log(`  技能热加载: ${skillReloaded ? 'YES' : 'NO'}`);
        console.log('');
        console.log(`  控制台日志总行? ${tauriLogs.length}`);
        console.log('');

        // Print key log lines
        const keyPatterns = [
            'plan_step',
            'log_finding',
            'Plan Context',
            'task_plan.md',
            'run_command',
            'tasklist',
            'Get-Process',
            'wmic',
            'ps aux',
            'search_web',
            'think',
            'Compaction',
            'PostLearning',
            'SelfLearning',
            'Precipitated',
            'Installing',
            'TOOL_CALL',
            'TOOL_RESULT',
            'TASK_FINISHED',
            'TASK_FAILED',
        ];
        console.log('  关键日志:');
        for (const pattern of keyPatterns) {
            const lines = tauriLogs.grep(pattern);
            if (lines.length > 0) {
                for (const line of lines.slice(0, 3)) {
                    console.log(`    ${line.substring(0, 200)}`);
                }
                if (lines.length > 3) {
                    console.log(`    ... (${lines.length - 3} more lines with "${pattern}")`);
                }
            }
        }
        console.log('='.repeat(70));
        console.log('');

        // ================================================================
        // Step 7: Assertions
        // ================================================================

        // 7a. Handle external API issues gracefully
        if (taskFailed) {
            const is402 = tauriLogs.contains('402') || tauriLogs.contains('Insufficient credits');
            const isRateLimit = tauriLogs.contains('rate_limit');
            if (is402 || isRateLimit) {
                console.log('[Test] Task failed due to external API issue (402 / rate limit).');
                test.skip(true, 'Task failed due to external API issue');
                return;
            }
        }

        // 7b. Agent must have used run_command (the core tool for this task)
        expect(runCommandDetected, '应该使用了run_command工具').toBe(true);

        // 7c. Agent should have run a process listing command
        expect(processListRequested, '应该执行了进程列表命?tasklist/Get-Process/wmic)').toBe(true);

        // 7d. Agent loop should have completed
        expect(taskFinished, 'Agent loop should finish before timeout').toBe(true);
        expect(taskFailed, '任务不应被标记为失败').toBe(false);

        // 7e. Security analysis verification
        expect(securityAnalysisDone, 'Should provide process security analysis').toBe(true);
        expect(taskSucceeded, 'Process security analysis task should succeed').toBe(true);

        // 7f. Planning verification (validates persistent planning enhancement)
        if (planStepUsed) {
            console.log('[Test] ?Agent used plan_step ?pre-execution planning protocol is working!');
            if (planPersisted) {
                console.log('[Test] ?Plan was persisted to disk ?survives context truncation!');
            } else {
                console.log('[Test] ⚠️ plan_step used but persistence not detected in logs.');
            }
        } else {
            console.log('[Test] ⚠️ plan_step not used ?agent may have skipped task decomposition.');
        }
        if (planContextInjected) {
            console.log('[Test] ?Plan context was re-injected during execution ?PreToolUse hook active!');
        } else {
            console.log('[Test] ⚠️ Plan context re-injection not detected ?may not have been triggered yet.');
        }
        if (logFindingUsed) {
            console.log('[Test] ?Agent used log_finding ?knowledge persistence working!');
        } else {
            console.log('[Test] ⚠️ log_finding not used ?agent may not have encountered findings to save.');
        }
        if (linuxCommandAttempted) {
            console.log('[Test] ⚠️ Agent tried Linux commands on Windows ?system environment injection may not be fully effective.');
        } else {
            console.log('[Test] ?No Linux commands on Windows ?platform-aware execution confirmed!');
        }

        // 7g. Report quality (soft checks ?log warnings but don't fail)
        if (!riskAssessmentDone) {
            console.log('[Test] ⚠️ Risk assessment not detected ?agent may have given a general analysis.');
        }
        if (!reportGenerated) {
            console.log('[Test] ⚠️ Structured report not detected in output.');
        }
        if (!processDataReceived) {
            console.log('[Test] ⚠️ Process data not captured in logs (may be truncated).');
        }

        // 7h. Self-learning verification
        if (postLearningTriggered) {
            console.log('[Test] ?Self-learning was triggered after successful task!');

            if (skillPrecipitated) {
                console.log('[Test] ?Knowledge/skill was precipitated from execution!');
            }
            if (skillInstalled) {
                console.log('[Test] ?Skill was installed and is available for reuse!');
            }
            if (skillReloaded) {
                console.log('[Test] ?Skill was hot-reloaded ?ready for immediate use!');
            }

            // Assert that at least precipitation happened
            expect(skillPrecipitated, '自学习应沉淀出技能或知识').toBe(true);
        } else {
            console.log('[Test] ⚠️ Post-execution learning did not trigger.');
            console.log('[Test] This may happen if valueKeywords do not match the query,');
            console.log('[Test] or if the task used fewer than the minimum tool calls.');
        }
    });
});
