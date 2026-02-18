/**
 * E2E Test: TTS (Text-to-Speech) Self-Learning - No Chrome Version
 *
 * This test is designed for TTS functionality testing WITHOUT Chrome browser.
 * It uses tauriFixtureNoChrome which doesn't pre-launch Chrome, making tests faster.
 *
 * Tests:
 * 1. Launch CoworkAny desktop app (Tauri + WebView2)
 * 2. Send message: "为coworkany增加说话的能力，将文字回复读出来。"
 * 3. Verify TTS implementation and voice output
 *
 * Run:
 *   cd desktop && npx playwright test tests/tts-self-learning-nochrome.test.ts
 */

import { test, expect, type TauriLogCollector } from './tauriFixtureNoChrome';

const TASK_QUERY = '将后续的文字回复读出来。';
const TASK_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;

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
                console.log(`[Test] Found "${label}" in logs after ${Math.round((Date.now() - startTime) / 1000)}s`);
            }
            return true;
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    return false;
}

test.describe('TTS Self-Learning E2E (No Chrome)', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 180_000);

    test('Agent should discover and use TTS capability', async ({ page, tauriLogs }) => {
        test.setTimeout(TASK_TIMEOUT_MS + 180_000);

        console.log('[Test] Looking for input field...');

        // The page should already be selected by the fixture
        // Just find the input using the known selectors
        const launcherInput = page.locator('input[placeholder="Ask CoworkAny..."]');
        const chatInput = page.locator('.chat-input');

        let input;
        let placeholder;
        
        try {
            await launcherInput.waitFor({ state: 'visible', timeout: 15000 });
            input = launcherInput;
            placeholder = 'Ask CoworkAny...';
        } catch {
            try {
                await chatInput.waitFor({ state: 'visible', timeout: 15000 });
                input = chatInput;
                placeholder = 'chat-input';
            } catch {
                throw new Error('Could not find input field. Check fixture.');
            }
        }

        console.log(`[Test] Input found: placeholder="${placeholder}"`);

        console.log(`[Test] Typing query: "${TASK_QUERY}"`);
        await input.fill(TASK_QUERY);
        await expect(input).toHaveValue(TASK_QUERY);
        await page.screenshot({ path: 'test-results/tts-nochrome-01-query.png' });

        console.log('[Test] Pressing Enter to submit task...');
        tauriLogs.setBaseline();

        await input.press('Enter');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'test-results/tts-nochrome-02-submitted.png' });

        console.log('[Test] Monitoring task execution...');

        const startTime = Date.now();
        let taskFinished = false;
        let taskFailed = false;
        let voiceSpeakToolUsed = false;
        let ttsResearchDone = false;
        let ttsApproachIdentified = false;
        let ttsOutputConfirmed = false;

        while (Date.now() - startTime < TASK_TIMEOUT_MS) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            const elapsed = Math.round((Date.now() - startTime) / 1000);

            // Check for voice_speak tool ACTUAL call via TOOL_CALL event.
            // IMPORTANT: We must check that "voice_speak" appears in a TOOL_CALL event,
            // NOT merely in a TOOL_RESULT (which happens when the agent views voice.ts code).
            // Previous bug: containsSinceBaseline('"name":"voice_speak"') also matches when
            // the agent reads voice.ts source code (TOOL_RESULT content contains the string).
            if (!voiceSpeakToolUsed) {
                const toolCallLines = tauriLogs.grepSinceBaseline('TOOL_CALL');
                const hasVoiceSpeakCall = toolCallLines.some(l =>
                    l.includes('"name":"voice_speak"') || l.includes('"name": "voice_speak"')
                );
                if (hasVoiceSpeakCall) {
                    voiceSpeakToolUsed = true;
                    console.log(`[Test] [${elapsed}s] voice_speak tool was actually CALLED (TOOL_CALL event)`);
                }
            }

            // Check for TTS research
            if (!ttsResearchDone) {
                const ttsKeywords = [
                    'text-to-speech', 'Text-to-Speech',
                    'SpeechSynthesis', 'speechSynthesis',
                    'voice_speak', '语音', '朗读', '说话',
                ];
                const agentLogs = tauriLogs.getRawSinceBaseline();
                if (ttsKeywords.some(kw => agentLogs.includes(kw))) {
                    ttsResearchDone = true;
                    console.log(`[Test] [${elapsed}s] TTS research detected`);
                }
            }

            // Check for TTS approach identification (discovered in code or discussed)
            // NOTE: "identified" != "called" — the agent may discover voice_speak without using it.
            if (!ttsApproachIdentified) {
                const postBaseline = tauriLogs.getRawSinceBaseline();
                if (postBaseline.includes('voice_speak')) {
                    ttsApproachIdentified = true;
                    if (voiceSpeakToolUsed) {
                        console.log(`[Test] [${elapsed}s] TTS approach: voice_speak (CALLED)`);
                    } else {
                        console.log(`[Test] [${elapsed}s] TTS approach: voice_speak (discovered, NOT yet called)`);
                    }
                }
            }

            // Check for actual TTS output
            if (!ttsOutputConfirmed) {
                const outputIndicators = [
                    'Speech synthesized',
                    'text_spoken',
                    '[Voice] Speaking',
                    'voice output',
                    'speech completed',
                ];
                if (outputIndicators.some(ind => tauriLogs.containsSinceBaseline(ind))) {
                    ttsOutputConfirmed = true;
                    console.log(`[Test] [${elapsed}s] TTS output confirmed!`);
                }
            }

            // Check for task completion
            if (!taskFinished && tauriLogs.containsSinceBaseline('"type":"TASK_FINISHED"')) {
                taskFinished = true;
                console.log(`[Test] [${elapsed}s] TASK_FINISHED detected`);
            }
            if (!taskFailed && tauriLogs.containsSinceBaseline('"type":"TASK_FAILED"')) {
                taskFailed = true;
                console.log(`[Test] [${elapsed}s] TASK_FAILED detected`);
            }

            // UI state check
            try {
                const bodyText = await page.textContent('body', { timeout: 5000 });
                if (bodyText && bodyText.includes('Ready for follow-up') && !taskFinished) {
                    taskFinished = true;
                    console.log(`[Test] [${elapsed}s] Agent loop ended (UI)`);
                }
            } catch {}

            if (taskFinished || taskFailed) {
                await new Promise(r => setTimeout(r, 5000));
                break;
            }
        }

        await page.screenshot({ path: 'test-results/tts-nochrome-99-final.png' });

        const totalElapsed = Math.round((Date.now() - startTime) / 1000);

        console.log('');
        console.log('='.repeat(60));
        console.log('  TTS Self-Learning Test Report (No Chrome)');
        console.log('='.repeat(60));
        console.log(`  Task: ${TASK_QUERY}`);
        console.log(`  Duration: ${totalElapsed}s`);
        console.log('');
        console.log(`  TTS research:        ${ttsResearchDone ? 'YES' : 'NO'}`);
        console.log(`  TTS approach:       ${ttsApproachIdentified ? 'YES' : 'NO'}`);
        console.log(`  voice_speak called:  ${voiceSpeakToolUsed ? 'YES' : 'NO'}`);
        console.log(`  TTS output confirmed: ${ttsOutputConfirmed ? 'YES' : 'NO'}`);
        console.log(`  Task finished:      ${taskFinished ? 'YES' : 'NO'}`);
        console.log(`  Task failed:        ${taskFailed ? 'YES' : 'NO'}`);
        console.log('='.repeat(60));
        console.log('');

        // Assertions
        if (taskFailed) {
            const isApiError = tauriLogs.containsSinceBaseline('insufficient_quota') || 
                             tauriLogs.containsSinceBaseline('rate_limit');
            if (isApiError) {
                console.log('[Test] Task failed due to API issue - skipping');
                test.skip(true, 'API error');
                return;
            }
        }

        expect(taskFinished, 'Agent should complete within timeout').toBe(true);
        expect(ttsResearchDone, 'Agent should engage with TTS topics').toBe(true);

        // CORE ASSERTION: voice_speak must be ACTUALLY CALLED, not just discovered.
        // BUG FIX: Previous version accepted (ttsApproachIdentified && taskFinished && !taskFailed)
        // which passes when the agent merely views voice.ts and discusses TTS without calling it.
        if (voiceSpeakToolUsed) {
            console.log('[Test] ✅ voice_speak tool was ACTUALLY CALLED (TOOL_CALL event)');
        } else {
            console.log('[Test] ❌ voice_speak tool was NOT called');
            if (ttsApproachIdentified) {
                console.log('[Test]    Agent discovered/discussed voice_speak but didn\'t invoke it.');
                console.log('[Test]    This is the known bug — agent explains TTS instead of using it.');
            }
        }

        // Primary: voice_speak must be called (hard requirement)
        if (!taskFailed) {
            expect(voiceSpeakToolUsed, 'voice_speak must be CALLED via TOOL_CALL, not just discovered in code').toBe(true);
        }
        // Secondary: overall task should succeed
        const taskSucceeded = voiceSpeakToolUsed || (ttsOutputConfirmed && taskFinished);
        expect(taskSucceeded, 'Task should succeed with actual TTS output').toBe(true);
    });
});
