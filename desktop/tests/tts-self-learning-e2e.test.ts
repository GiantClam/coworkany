/**
 * E2E Test: TTS (Text-to-Speech) Self-Learning via CoworkAny Desktop Client
 *
 * Tests the agent's self-learning capability to discover and implement TTS functionality:
 * 1. Launch CoworkAny desktop app (Tauri + WebView2)
 * 2. Connect Playwright to the WebView via CDP
 * 3. Send the message: "为coworkany增加说话的能力，将文字回复读出来。"
 * 4. Agent uses self-learning system to research and implement TTS solutions
 * 5. Agent implements TTS capability (voice_speak tool / Web Speech API / system TTS / etc.)
 * 6. Verify: TTS implementation, text read aloud, skill precipitation
 *
 * Test Purpose:
 *   Validate that the self-learning system can autonomously:
 *   - Research TTS solutions (search_web, think tool, view existing code)
 *   - Plan the implementation approach (plan_step)
 *   - Implement TTS via the best available method
 *   - Demonstrate text-to-speech output
 *   - Precipitate learned TTS skill for future reuse
 *
 * Possible TTS Approaches the Agent May Discover:
 *   0. voice_speak tool - already exists in CoworkAny toolset
 *   1. Web Speech API (SpeechSynthesis) - built into WebView2/browsers
 *   2. Windows SAPI (System.Speech) via PowerShell - native Windows TTS
 *   3. Tauri plugin (tauri-plugin-tts) - native cross-platform TTS
 *   4. Third-party API (OpenAI TTS, Google TTS, Azure TTS)
 *   5. espeak / pyttsx3 via run_command - CLI-based TTS
 *
 * Prerequisites:
 *   - Rust toolchain installed (cargo, rustc)
 *   - desktop/ npm dependencies installed
 *   - Windows OS with audio output available
 *   - Internet access for web search / API calls
 *
 * Run:
 *   cd desktop && npx playwright test tests/tts-self-learning-e2e.test.ts
 */

import { test, expect, type TauriLogCollector } from './tauriFixture';

// ============================================================================
// Config
// ============================================================================

const TASK_QUERY = '为coworkany增加说话的能力，将文字回复读出来。';

// TTS task may take longer due to research + implementation + testing
const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
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
            if (label) {
                console.log(
                    `[Test] Found "${label}" in logs after ${Math.round((Date.now() - startTime) / 1000)}s`
                );
            }
            return true;
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    return false;
}

// ============================================================================
// Tests
// ============================================================================

test.describe('TTS (Text-to-Speech) Self-Learning E2E', () => {
    // Extra time for Cargo build + app startup + task execution
    test.setTimeout(TASK_TIMEOUT_MS + 180_000);

    test('Agent should self-learn TTS capability and read text aloud', async ({ page, tauriLogs }) => {
        test.setTimeout(TASK_TIMEOUT_MS + 180_000);

        // ================================================================
        // Step 1: Wait for the UI to load
        // ================================================================
        console.log('[Test] Waiting for UI to load...');

        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(3000);

        const launcherInput = page.locator('input[placeholder="Ask CoworkAny..."]');
        const chatInput = page.locator('.chat-input');

        const input = await Promise.race([
            launcherInput.waitFor({ state: 'visible', timeout: 60_000 }).then(() => launcherInput),
            chatInput.waitFor({ state: 'visible', timeout: 60_000 }).then(() => chatInput),
        ]);
        const placeholder = await input.getAttribute('placeholder');
        console.log(`[Test] UI loaded - input visible, placeholder="${placeholder}"`);

        // ================================================================
        // Step 2: Input the TTS task
        // ================================================================
        console.log(`[Test] Typing query: "${TASK_QUERY}"`);
        await input.fill(TASK_QUERY);
        await expect(input).toHaveValue(TASK_QUERY);
        await page.screenshot({ path: 'test-results/tts-01-query-input.png' });

        // ================================================================
        // Step 3: Submit the task
        // ================================================================
        console.log('[Test] Pressing Enter to submit task...');

        // Set baseline BEFORE submitting so monitoring only sees post-task logs
        tauriLogs.setBaseline();

        await input.press('Enter');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'test-results/tts-02-task-submitted.png' });

        // ================================================================
        // Step 4: Monitor task execution
        // ================================================================
        console.log('[Test] Monitoring TTS self-learning task execution...');

        const startTime = Date.now();
        let taskFinished = false;
        let taskFailed = false;
        let screenshotCounter = 3;

        // ── Phase tracking: Planning ──────────────────────────────────
        let planStepUsed = false;
        let planPersisted = false;
        let logFindingUsed = false;
        let planContextInjected = false;

        // ── Phase tracking: Research ──────────────────────────────────
        let webSearchUsed = false;
        let thinkToolUsed = false;
        let ttsResearchDone = false;
        let ttsApproachIdentified = false;

        // ── Phase tracking: Implementation ────────────────────────────
        let runCommandUsed = false;
        let codeWritten = false;
        let ttsMethodDetected = '';
        // Specific TTS methods
        let voiceSpeakToolUsed = false;  // Built-in voice_speak tool
        let webSpeechApiUsed = false;
        let windowsSapiUsed = false;
        let tauriPluginUsed = false;
        let thirdPartyApiUsed = false;
        let cliTtsUsed = false;

        // ── Phase tracking: Verification ──────────────────────────────
        let ttsTestAttempted = false;
        let ttsOutputConfirmed = false;
        let textReadAloud = false;

        // ── Phase tracking: Self-Learning ─────────────────────────────
        let postLearningTriggered = false;
        let skillPrecipitated = false;
        let skillInstalled = false;
        let skillReloaded = false;

        // ── General tracking ──────────────────────────────────────────
        let taskSucceeded = false;
        let runCommandCount = 0;
        const seenRunCommands = new Set<string>();

        while (Date.now() - startTime < TASK_TIMEOUT_MS) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            const elapsed = Math.round((Date.now() - startTime) / 1000);

            // NOTE: Use containsSinceBaseline/grepSinceBaseline to avoid
            // false positives from initialization logs (tool lists, skill descriptions, etc.)

            // ── Planning detection ────────────────────────────────────
            if (!planStepUsed && tauriLogs.containsSinceBaseline('"name":"plan_step"')) {
                planStepUsed = true;
                console.log(`[Test] [${elapsed}s] plan_step tool used`);
            }
            if (!planPersisted && tauriLogs.containsSinceBaseline('task_plan.md')) {
                planPersisted = true;
                console.log(`[Test] [${elapsed}s] Plan persisted to task_plan.md`);
            }
            if (!logFindingUsed && tauriLogs.containsSinceBaseline('"name":"log_finding"')) {
                logFindingUsed = true;
                console.log(`[Test] [${elapsed}s] log_finding tool used`);
            }
            if (!planContextInjected && tauriLogs.containsSinceBaseline('Plan Context')) {
                planContextInjected = true;
                console.log(`[Test] [${elapsed}s] Plan context re-injected`);
            }

            // ── Research detection ────────────────────────────────────
            if (!webSearchUsed && tauriLogs.containsSinceBaseline('"name":"search_web"')) {
                webSearchUsed = true;
                console.log(`[Test] [${elapsed}s] Web search used (researching TTS)`);
            }
            if (!thinkToolUsed && tauriLogs.containsSinceBaseline('"name":"think"')) {
                thinkToolUsed = true;
                console.log(`[Test] [${elapsed}s] Think tool used`);
            }

            // Detect TTS research keywords (only in TOOL_CALL/TOOL_RESULT/TEXT_DELTA events)
            if (!ttsResearchDone) {
                const ttsKeywords = [
                    'text-to-speech', 'Text-to-Speech',
                    'SpeechSynthesis', 'speechSynthesis',
                    'speech synthesis', 'Speech Synthesis',
                    'System.Speech',
                    'voice_speak',
                    'espeak', 'pyttsx',
                ];
                // Check only in actual agent events, not boot logs
                const agentLogs = tauriLogs.getRawSinceBaseline();
                if (ttsKeywords.some(kw => agentLogs.includes(kw))) {
                    ttsResearchDone = true;
                    console.log(`[Test] [${elapsed}s] TTS research detected in logs`);
                }
                // Also check TEXT_DELTA for Chinese keywords about TTS
                const textDeltas = tauriLogs.grepSinceBaseline('TEXT_DELTA');
                const chineseTtsKw = ['语音', '朗读', '说话', 'TTS', 'tts', '语音合成'];
                if (textDeltas.some(l => chineseTtsKw.some(kw => l.includes(kw)))) {
                    ttsResearchDone = true;
                    console.log(`[Test] [${elapsed}s] TTS research detected in agent response`);
                }
            }

            // ── TTS approach identification ───────────────────────────
            if (!ttsApproachIdentified) {
                const postBaseline = tauriLogs.getRawSinceBaseline();
                // voice_speak ACTUAL tool call — MUST be a TOOL_CALL event, NOT merely
                // appearing in a TOOL_RESULT (e.g., when agent views voice.ts source code).
                //
                // TOOL_CALL events look like: {"type":"TOOL_CALL","payload":{"name":"voice_speak",...}}
                // TOOL_RESULT events when viewing voice.ts contain "voice_speak" as file content.
                //
                // We grep for TOOL_CALL lines that contain "voice_speak" as the tool name.
                const toolCallLines = tauriLogs.grepSinceBaseline('TOOL_CALL');
                const voiceSpeakToolCallLines = toolCallLines.filter(l =>
                    l.includes('"name":"voice_speak"') || l.includes('"name": "voice_speak"')
                );
                if (voiceSpeakToolCallLines.length > 0) {
                    ttsApproachIdentified = true;
                    ttsMethodDetected = 'voice_speak (built-in)';
                    voiceSpeakToolUsed = true;
                    console.log(`[Test] [${elapsed}s] TTS approach: voice_speak ACTUALLY CALLED as a tool`);
                }
                // Agent discovered voice_speak by viewing code (NOT the same as calling it!)
                else if (tauriLogs.grepSinceBaseline('TOOL_RESULT').some(l => l.includes('voice_speak') || l.includes('voiceSpeakTool'))) {
                    ttsApproachIdentified = true;
                    ttsMethodDetected = 'voice_speak (discovered in code, NOT called)';
                    // NOTE: voiceSpeakToolUsed stays FALSE — discovering is not using!
                    console.log(`[Test] [${elapsed}s] TTS approach: voice_speak DISCOVERED in code (but NOT called)`);
                }
                // Web Speech API
                else if (postBaseline.includes('speechSynthesis') ||
                    postBaseline.includes('SpeechSynthesisUtterance') ||
                    postBaseline.includes('window.speechSynthesis')) {
                    ttsApproachIdentified = true;
                    ttsMethodDetected = 'Web Speech API';
                    webSpeechApiUsed = true;
                    console.log(`[Test] [${elapsed}s] TTS approach: Web Speech API (SpeechSynthesis)`);
                }
                // Windows SAPI via PowerShell
                else if (postBaseline.includes('System.Speech') ||
                         postBaseline.includes('SpeechSynthesizer') ||
                         postBaseline.includes('SAPI.SpVoice')) {
                    ttsApproachIdentified = true;
                    ttsMethodDetected = 'Windows SAPI';
                    windowsSapiUsed = true;
                    console.log(`[Test] [${elapsed}s] TTS approach: Windows SAPI (PowerShell)`);
                }
                // Tauri plugin
                else if (postBaseline.includes('tauri-plugin-tts') ||
                         postBaseline.includes('plugin:tts')) {
                    ttsApproachIdentified = true;
                    ttsMethodDetected = 'Tauri Plugin';
                    tauriPluginUsed = true;
                    console.log(`[Test] [${elapsed}s] TTS approach: Tauri TTS Plugin`);
                }
                // Third-party API (OpenAI, Google, Azure)
                else if (postBaseline.includes('openai.com/v1/audio') ||
                         postBaseline.includes('texttospeech.googleapis') ||
                         postBaseline.includes('tts.speech.microsoft') ||
                         postBaseline.includes('api/tts')) {
                    ttsApproachIdentified = true;
                    ttsMethodDetected = 'Third-party API';
                    thirdPartyApiUsed = true;
                    console.log(`[Test] [${elapsed}s] TTS approach: Third-party API`);
                }
                // CLI tools (espeak, say, PowerShell Speak)
                else if (postBaseline.includes('espeak') ||
                         postBaseline.includes('pyttsx') ||
                         postBaseline.includes('mshta vbscript:Execute')) {
                    ttsApproachIdentified = true;
                    ttsMethodDetected = 'CLI TTS';
                    cliTtsUsed = true;
                    console.log(`[Test] [${elapsed}s] TTS approach: CLI-based TTS`);
                }
            }

            // ── TTS approach from TEXT_DELTA (agent discussing approach) ──
            if (!ttsApproachIdentified) {
                const textLines = tauriLogs.grepSinceBaseline('TEXT_DELTA');
                const allTextDeltas = textLines.join(' ');
                const ttsApproachKeywords = [
                    'voice_speak', 'voiceSpeakTool',
                    'Web Speech API', 'SpeechSynthesis',
                    'System.Speech', 'PowerShell.*Speak',
                    'tauri-plugin-tts', 'edge-tts', 'pyttsx3',
                    'OpenAI TTS', 'Google TTS', 'Azure TTS',
                    'espeak', 'say command',
                ];
                for (const kw of ttsApproachKeywords) {
                    if (allTextDeltas.includes(kw)) {
                        ttsApproachIdentified = true;
                        ttsMethodDetected = `Discussed: ${kw}`;
                        console.log(`[Test] [${elapsed}s] TTS approach discussed in response: ${kw}`);
                        break;
                    }
                }
            }

            // ── Implementation detection ──────────────────────────────
            if (!runCommandUsed && tauriLogs.containsSinceBaseline('"name":"run_command"')) {
                runCommandUsed = true;
                console.log(`[Test] [${elapsed}s] run_command tool detected`);
            }

            // Track run_command calls
            const runCommandLines = tauriLogs.grepSinceBaseline('"name":"run_command"');
            for (const line of runCommandLines) {
                const cmdMatch = line.match(/"command"\s*:\s*"([^"]+)"/);
                if (cmdMatch && !seenRunCommands.has(cmdMatch[1])) {
                    seenRunCommands.add(cmdMatch[1]);
                    runCommandCount++;
                    console.log(
                        `[Test] [${elapsed}s] Command #${runCommandCount}: ${cmdMatch[1].substring(0, 100)}`
                    );
                }
            }

            // Detect code writing (agent may modify source files)
            if (!codeWritten) {
                const codeIndicators = [
                    '"name":"write_to_file"', '"name":"replace_file_content"',
                    'write_file', 'edit_file', 'create_file',
                ];
                if (codeIndicators.some(ind => tauriLogs.containsSinceBaseline(ind))) {
                    codeWritten = true;
                    console.log(`[Test] [${elapsed}s] Code/file modification detected`);
                }
            }

            // ── TTS verification detection ────────────────────────────
            if (!ttsTestAttempted) {
                const testIndicators = [
                    'speak', 'Speak', 'play', 'Play',
                    'utterance', 'Utterance',
                    'test TTS', 'TTS test',
                    'read aloud', 'read text',
                ];
                const textLines = tauriLogs.grepSinceBaseline('TEXT_DELTA');
                if (textLines.some(l => testIndicators.some(kw => l.includes(kw)))) {
                    ttsTestAttempted = true;
                    console.log(`[Test] [${elapsed}s] TTS test/demonstration attempted`);
                }
            }

            // Detect TTS output confirmation
            if (!ttsOutputConfirmed) {
                const outputIndicators = [
                    'Speech synthesized successfully',
                    'text_spoken',
                    '[Voice] Speaking:',
                    '[Voice] Using native TTS',
                    'speech output', 'voice output',
                    'audio output', 'audio playback',
                ];
                if (outputIndicators.some(ind => tauriLogs.containsSinceBaseline(ind))) {
                    ttsOutputConfirmed = true;
                    console.log(`[Test] [${elapsed}s] TTS output confirmed in logs`);
                }
            }

            // Detect text being read aloud confirmation
            if (!textReadAloud) {
                const readAloudIndicators = [
                    'Speech synthesized successfully',
                    'text_spoken',
                    '[Voice] Speaking:',
                    'speech completed', 'utterance ended',
                ];
                const allText = tauriLogs.getRawSinceBaseline();
                if (readAloudIndicators.some(ind => allText.includes(ind))) {
                    textReadAloud = true;
                    console.log(`[Test] [${elapsed}s] Text read aloud confirmed!`);
                }
            }

            // ── Task completion detection ─────────────────────────────
            if (!taskFinished && tauriLogs.containsSinceBaseline('"type":"TASK_FINISHED"')) {
                taskFinished = true;
                console.log(`[Test] [${elapsed}s] TASK_FINISHED event detected`);
            }
            if (!taskFailed && tauriLogs.containsSinceBaseline('"type":"TASK_FAILED"')) {
                taskFailed = true;
                console.log(`[Test] [${elapsed}s] TASK_FAILED event detected`);
            }

            // ── Self-learning detection ───────────────────────────────
            if (!postLearningTriggered && tauriLogs.containsSinceBaseline('[PostLearning]')) {
                postLearningTriggered = true;
                console.log(`[Test] [${elapsed}s] Post-execution learning triggered`);
            }
            if (!skillPrecipitated && tauriLogs.containsSinceBaseline('Precipitated as')) {
                skillPrecipitated = true;
                const precipLines = tauriLogs.grepSinceBaseline('Precipitated as');
                console.log(
                    `[Test] [${elapsed}s] Skill/knowledge precipitated: ${precipLines[0]?.substring(0, 200)}`
                );
            }
            if (!skillInstalled && tauriLogs.containsSinceBaseline('Installing auto-generated skill')) {
                skillInstalled = true;
                console.log(`[Test] [${elapsed}s] TTS skill installed`);
            }
            if (!skillReloaded && (
                tauriLogs.containsSinceBaseline('installed and ready to use') ||
                (tauriLogs.containsSinceBaseline('Skill') && tauriLogs.containsSinceBaseline('reload'))
            )) {
                skillReloaded = true;
                console.log(`[Test] [${elapsed}s] Skill hot-reloaded`);
            }

            // ── UI state check ────────────────────────────────────────
            try {
                const bodyText = await page.textContent('body', { timeout: 5000 });
                if (bodyText) {
                    if (bodyText.includes('Ready for follow-up') && !taskFinished) {
                        taskFinished = true;
                        console.log(`[Test] [${elapsed}s] Agent loop ended (UI)`);
                    }
                }
            } catch {
                // Page may not be accessible during transitions
            }

            // ── Periodic screenshots ──────────────────────────────────
            if (elapsed % 30 === 0 && elapsed > 0) {
                try {
                    await page.screenshot({
                        path: `test-results/tts-${String(screenshotCounter).padStart(2, '0')}-progress-${elapsed}s.png`,
                    });
                    screenshotCounter++;
                } catch { /* may fail during transitions */ }
            }

            // ── Early exit ────────────────────────────────────────────
            if ((taskFinished || taskFailed) && !postLearningTriggered) {
                const learningWait = 30_000;
                const learningStart = Date.now();
                while (Date.now() - learningStart < learningWait) {
                    await new Promise(r => setTimeout(r, 2000));
                    if (tauriLogs.containsSinceBaseline('[PostLearning]')) {
                        postLearningTriggered = true;
                        break;
                    }
                }
                break;
            }

            if (taskFinished && postLearningTriggered) {
                await new Promise(r => setTimeout(r, 10_000));
                if (tauriLogs.containsSinceBaseline('Precipitated as')) skillPrecipitated = true;
                if (tauriLogs.containsSinceBaseline('Installing auto-generated skill')) skillInstalled = true;
                if (tauriLogs.containsSinceBaseline('installed and ready to use')) skillReloaded = true;
                break;
            }
        }

        // ================================================================
        // Step 5: Final screenshots and analysis
        // ================================================================
        try {
            await page.screenshot({ path: 'test-results/tts-99-final.png', fullPage: true });
        } catch { /* may fail if page closed */ }

        const totalElapsed = Math.round((Date.now() - startTime) / 1000);

        // ================================================================
        // Step 5.5: Determine actual task success
        // ================================================================
        // PRIMARY criterion: voice_speak tool MUST be actually called.
        // The user asked to "将文字回复读出来" — the text must be read aloud.
        //
        // SECONDARY (soft) criteria for diagnostics only:
        //   - Research conducted (web search, think tool)
        //   - Approach identified (voice_speak, Web Speech API, etc.)
        //   - Self-learning triggered (PostLearning, skill precipitation)
        //
        // IMPORTANT: Previous version had a bug where `taskSucceeded` could be
        // true even if voice_speak was never called (just "researched" or "discussed").
        // This led to false passes. Now we strictly require actual tool invocation.
        if (voiceSpeakToolUsed) {
            taskSucceeded = true;
            console.log('[Test] ✅ Agent actually CALLED voice_speak tool — TTS delivered.');
        } else if (ttsApproachIdentified && (codeWritten || runCommandUsed || ttsTestAttempted)) {
            // Agent implemented an alternative TTS method (not voice_speak)
            taskSucceeded = true;
            console.log('[Test] ⚠️ Agent implemented TTS via alternative method (not voice_speak).');
            console.log(`[Test]    Method: ${ttsMethodDetected}`);
        } else {
            // Agent only researched/discussed TTS but didn't actually produce audio
            taskSucceeded = false;
            if (ttsResearchDone) {
                console.log('[Test] ❌ Agent researched TTS but did NOT actually call voice_speak.');
                console.log('[Test]    This is the known bug: agent explains TTS exists but doesn\'t use it.');
            }
            if (ttsApproachIdentified) {
                console.log(`[Test] ❌ Approach identified (${ttsMethodDetected}) but not executed.`);
            }
        }

        // ================================================================
        // Step 6: Comprehensive Report
        // ================================================================
        console.log('');
        console.log('='.repeat(70));
        console.log('  TTS (Text-to-Speech) Self-Learning E2E Test Report');
        console.log('='.repeat(70));
        console.log(`  Task: ${TASK_QUERY}`);
        console.log(`  Duration: ${totalElapsed}s`);
        console.log('');
        console.log('  -- Planning Phase --');
        console.log(`  plan_step used:       ${planStepUsed ? 'YES' : 'NO'}`);
        console.log(`  Plan persisted:       ${planPersisted ? 'YES (task_plan.md)' : 'NO'}`);
        console.log(`  log_finding used:     ${logFindingUsed ? 'YES (findings.md)' : 'NO'}`);
        console.log(`  Plan context inject:  ${planContextInjected ? 'YES (PreToolUse)' : 'NO'}`);
        console.log('');
        console.log('  -- Research Phase --');
        console.log(`  Web search:           ${webSearchUsed ? 'YES' : 'NO'}`);
        console.log(`  Think tool:           ${thinkToolUsed ? 'YES' : 'NO'}`);
        console.log(`  TTS research:         ${ttsResearchDone ? 'YES' : 'NO'}`);
        console.log(`  Approach identified:  ${ttsApproachIdentified ? 'YES' : 'NO'}`);
        console.log(`  TTS method:           ${ttsMethodDetected || 'NOT DETECTED'}`);
        console.log('');
        console.log('  -- TTS Methods Detected --');
        console.log(`  voice_speak (builtin):${voiceSpeakToolUsed ? 'YES' : 'NO'}`);
        console.log(`  Web Speech API:       ${webSpeechApiUsed ? 'YES' : 'NO'}`);
        console.log(`  Windows SAPI:         ${windowsSapiUsed ? 'YES' : 'NO'}`);
        console.log(`  Tauri Plugin:         ${tauriPluginUsed ? 'YES' : 'NO'}`);
        console.log(`  Third-party API:      ${thirdPartyApiUsed ? 'YES' : 'NO'}`);
        console.log(`  CLI TTS:              ${cliTtsUsed ? 'YES' : 'NO'}`);
        console.log('');
        console.log('  -- Implementation Phase --');
        console.log(`  run_command used:     ${runCommandUsed ? 'YES' : 'NO'}`);
        console.log(`  Commands executed:    ${runCommandCount}`);
        console.log(`  Code written:         ${codeWritten ? 'YES' : 'NO'}`);
        console.log('');
        console.log('  -- Verification Phase --');
        console.log(`  TTS test attempted:   ${ttsTestAttempted ? 'YES' : 'NO'}`);
        console.log(`  TTS output confirmed: ${ttsOutputConfirmed ? 'YES' : 'NO'}`);
        console.log(`  Text read aloud:      ${textReadAloud ? 'YES' : 'NO'}`);
        console.log('');
        console.log('  -- Task Result --');
        console.log(`  Agent loop ended:     ${taskFinished ? 'YES' : 'NO'}`);
        console.log(`  Task failed flag:     ${taskFailed ? 'YES' : 'NO'}`);
        console.log(`  Task succeeded:       ${taskSucceeded ? 'YES' : 'NO'}`);
        console.log('');
        console.log('  -- Self-Learning --');
        console.log(`  PostLearning trigger: ${postLearningTriggered ? 'YES' : 'NO'}`);
        console.log(`  Skill precipitated:   ${skillPrecipitated ? 'YES' : 'NO'}`);
        console.log(`  Skill installed:      ${skillInstalled ? 'YES' : 'NO'}`);
        console.log(`  Skill hot-reloaded:   ${skillReloaded ? 'YES' : 'NO'}`);
        console.log('');
        console.log(`  Log lines total:      ${tauriLogs.length}`);
        console.log('');

        // Print key log lines
        const keyPatterns = [
            'plan_step',
            'log_finding',
            'search_web',
            'TTS', 'tts',
            'speech', 'Speech',
            'SpeechSynthesis',
            'SAPI',
            'speak', 'Speak',
            'voice', 'Voice',
            'audio', 'Audio',
            'run_command',
            'TOOL_CALL',
            'PostLearning',
            'Precipitated',
            'TASK_FINISHED',
            'TASK_FAILED',
        ];
        console.log('  Key logs (since task submission):');
        for (const pattern of keyPatterns) {
            const lines = tauriLogs.grepSinceBaseline(pattern);
            if (lines.length > 0) {
                for (const line of lines.slice(0, 2)) {
                    console.log(`    ${line.substring(0, 200)}`);
                }
                if (lines.length > 2) {
                    console.log(`    ... (${lines.length - 2} more lines with "${pattern}")`);
                }
            }
        }
        console.log('='.repeat(70));
        console.log('');

        // ================================================================
        // Step 7: Assertions
        // ================================================================

        // 7a. Handle external API issues gracefully
        // Note: check for specific error patterns, not just "402" (too broad - matches sequence numbers etc.)
        if (taskFailed) {
            const apiErrorPatterns = [
                'Insufficient credits',
                'insufficient_quota',
                'status 402',
                'HTTP 402',
                '"code":402',
                '"status":402',
                'Payment Required',
                'billing',
            ];
            const isApiError = apiErrorPatterns.some(p => tauriLogs.containsSinceBaseline(p));
            const isRateLimit = tauriLogs.containsSinceBaseline('rate_limit') || tauriLogs.containsSinceBaseline('Too Many Requests');
            if (isApiError || isRateLimit) {
                console.log('[Test] Task failed due to external API issue (billing / rate limit).');
                test.skip(true, 'Task failed due to external API issue');
                return;
            }
        }

        // 7b. Agent loop should have completed
        expect(taskFinished, 'Agent loop should complete within timeout').toBe(true);

        // 7c. TTS research should have been performed
        // The agent should at minimum have recognized this is a TTS task
        expect(
            ttsResearchDone,
            'Agent should have engaged with TTS-related topics (keywords in logs/response)'
        ).toBe(true);

        // 7d. CORE ASSERTION: voice_speak tool must be actually called
        // This is the primary test objective — the user asked to "read text aloud".
        // The agent MUST call voice_speak, not just explain that TTS exists.
        //
        // BUG FIX: Previously, the test accepted "research + discussion" as success,
        // which allowed the agent to pass by merely viewing voice.ts code and
        // explaining TTS capabilities without ever calling voice_speak.
        if (!voiceSpeakToolUsed && !taskFailed) {
            console.log('[Test] ❌ CRITICAL: voice_speak tool was NOT called via TOOL_CALL event.');
            console.log('[Test]    The agent may have discovered/discussed TTS but didn\'t invoke it.');
            if (ttsApproachIdentified) {
                console.log(`[Test]    Approach detected: ${ttsMethodDetected}`);
            }
        }
        expect(
            taskSucceeded,
            'Agent must actually USE TTS (call voice_speak or implement alternative), not just discuss it'
        ).toBe(true);

        // 7e. Task failure analysis (soft check)
        if (taskFailed) {
            if (ttsApproachIdentified) {
                console.log('[Test] INFO - TASK_FAILED but TTS approach was identified.');
                console.log('[Test] The agent discovered the TTS solution but encountered');
                console.log('[Test] implementation issues (e.g., missing config, runtime error).');
            } else {
                console.log('[Test] WARN - Task failed without identifying TTS approach.');
            }
        }

        // 7f. voice_speak actual invocation (hard check when task doesn't fail)
        if (!taskFailed) {
            expect(
                voiceSpeakToolUsed,
                'voice_speak tool must be CALLED (TOOL_CALL event), not just discovered in code'
            ).toBe(true);
        }

        // 7g. TTS output verification
        if (voiceSpeakToolUsed) {
            console.log('[Test] OK - voice_speak tool was actually called');
            if (ttsOutputConfirmed) {
                console.log('[Test] OK - TTS audio output confirmed in logs');
            } else {
                console.log('[Test] INFO - voice_speak was called but audio output not confirmed in logs');
                console.log('[Test]        (may still have played audio on the system)');
            }
        }

        // 7h. Research tools usage (soft check)
        if (webSearchUsed || thinkToolUsed) {
            console.log('[Test] OK - Agent used research tools (search_web / think)');
        } else {
            console.log('[Test] INFO - Agent may have used existing knowledge without explicit research');
        }

        // 7i. Planning verification (soft check)
        if (planStepUsed) {
            console.log('[Test] OK - Agent used plan_step for TTS task decomposition');
        } else {
            console.log('[Test] INFO - Agent did not use plan_step (may not be needed for simple TTS)');
        }

        // 7j. Self-learning verification (soft check)
        if (postLearningTriggered) {
            console.log('[Test] OK - Self-learning triggered after TTS task');
            if (skillPrecipitated) {
                console.log('[Test] OK - TTS skill/knowledge precipitated for future reuse');
            }
        } else {
            console.log('[Test] INFO - Post-execution learning did not trigger');
        }
    });
});
