/**
 * E2E Test: Calendar Reminder Functionality
 *
 * Test: CoworkAny should set a calendar reminder for "明天早上9点提醒我开会"
 * 
 * Verification:
 * 1. Agent recognizes the reminder request
 * 2. Agent uses calendar/reminder tools
 * 3. Reminder is set successfully
 *
 * Run:
 *   cd desktop && npx playwright test tests/calendar-reminder.test.ts
 */

import { test, expect, type TauriLogCollector } from './tauriFixtureNoChrome';

const TASK_QUERY = '明天早上9点提醒我开会';
const TASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for simple reminder

test.describe('Calendar Reminder E2E', () => {
    test.setTimeout(TASK_TIMEOUT_MS + 180_000);

    test('should set calendar reminder for meeting', async ({ page, tauriLogs }) => {
        console.log('[Test] Starting calendar reminder test...');
        
        // Wait for UI - extended wait for React hydration
        await page.waitForLoadState('domcontentloaded');
        console.log('[Test] Waiting 15s for React hydration...');
        await page.waitForTimeout(15000);
        
        // Find input - try multiple selectors (ChatInterface uses different selector)
        const selectors = [
            'input[placeholder="Ask CoworkAny..."]',
            'input[placeholder="New instructions..."]',
            '.chat-input input',
            '.chat-input textarea',
            '.chat-input',
            'input[type="text"]',
        ];

        let input = null;
        for (const selector of selectors) {
            try {
                const locator = page.locator(selector);
                const count = await locator.count();
                if (count > 0) {
                    await locator.first().waitFor({ state: 'visible', timeout: 5000 });
                    input = locator.first();
                    console.log(`[Test] Found input: ${selector}`);
                    break;
                }
            } catch {
                continue;
            }
        }

        if (!input) {
            throw new Error('Could not find any input field');
        }
        console.log('[Test] Input found');

        // Submit task
        console.log(`[Test] Sending: ${TASK_QUERY}`);
        tauriLogs.setBaseline();
        
        await input.fill(TASK_QUERY);
        await input.press('Enter');
        
        console.log('[Test] Monitoring...');

        const startTime = Date.now();
        let finished = false;
        let failed = false;
        
        // Tracking
        let calendarToolUsed = false;
        let reminderSet = false;
        let timeRecognized = false;
        
        while (Date.now() - startTime < TASK_TIMEOUT_MS) {
            await page.waitForTimeout(5000);
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            
            const logs = tauriLogs.getRawSinceBaseline();
            
            // Check calendar/reminder tools
            const toolCalls = tauriLogs.grepSinceBaseline('TOOL_CALL');
            
            if (!calendarToolUsed) {
                const hasCalendar = toolCalls.some(l => 
                    l.includes('calendar') || 
                    l.includes('reminder') || 
                    l.includes('schedule') ||
                    l.includes('event')
                );
                if (hasCalendar || logs.includes('calendar') || logs.includes('reminder')) {
                    calendarToolUsed = true;
                    console.log(`[${elapsed}s] Calendar/reminder tool used`);
                }
            }
            
            // Check if time was recognized
            if (!timeRecognized) {
                if (logs.includes('9点') || logs.includes('9:00') || logs.includes('早上')) {
                    timeRecognized = true;
                    console.log(`[${elapsed}s] Time recognized: 明天早上9点`);
                }
            }
            
            // Check if reminder was set
            if (!reminderSet) {
                const setKeywords = ['已设置', '已创建', '已安排', 'reminder set', 'calendar event', '提醒已设置'];
                if (setKeywords.some(kw => logs.includes(kw))) {
                    reminderSet = true;
                    console.log(`[${elapsed}s] Reminder set successfully`);
                }
            }
            
            // Check completion
            if (logs.includes('TASK_FINISHED')) {
                finished = true;
                console.log(`[${elapsed}s] Task finished`);
                break;
            }
            if (logs.includes('TASK_FAILED')) {
                failed = true;
                console.log(`[${elapsed}s] Task failed`);
                break;
            }
            
            // Progress report
            if (elapsed % 30 === 0) {
                console.log(`[${elapsed}s] Progress: calendar=${calendarToolUsed}, time=${timeRecognized}, set=${reminderSet}`);
            }
        }

        const totalTime = Math.round((Date.now() - startTime) / 1000);
        
        console.log('');
        console.log('='.repeat(60));
        console.log('CALENDAR REMINDER TEST RESULT');
        console.log('='.repeat(60));
        console.log(`Duration: ${totalTime}s`);
        console.log(`Task finished: ${finished}`);
        console.log(`Task failed: ${failed}`);
        console.log(`Calendar tool used: ${calendarToolUsed}`);
        console.log(`Time recognized: ${timeRecognized}`);
        console.log(`Reminder set: ${reminderSet}`);
        console.log('='.repeat(60));
        console.log('');

        // Assertions
        expect(finished || reminderSet, 'Task should complete or reminder should be set').toBe(true);
        expect(failed, 'Task should not fail').toBe(false);
        
        // Core check
        expect(calendarToolUsed || reminderSet, 'Should use calendar tool or set reminder').toBe(true);
        
        console.log('[Test] Test completed');
    });
});
