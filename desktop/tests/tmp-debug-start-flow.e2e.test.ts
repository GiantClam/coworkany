import { test } from './tauriFixtureNoChrome';

const INPUT_SELECTORS = [
  '.chat-input',
  'input[placeholder="New instructions..."]',
  'input[placeholder*="instructions"]',
  'input[placeholder*="指令"]',
  '.chat-input input',
  '.chat-input textarea',
  'textarea',
  'input[type="text"]',
];

async function findChatInput(page: any) {
  for (const selector of INPUT_SELECTORS) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible({ timeout: 1200 }).catch(() => false);
    if (visible) return locator;
  }
  throw new Error('no input');
}

test('debug start flow', async ({ page, tauriLogs }) => {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(5000);
  const input = await findChatInput(page);
  tauriLogs.setBaseline();
  await input.fill('请帮我连接数据库 192.168.1.100:3306 并查询用户表');
  await input.press('Enter');
  await page.waitForTimeout(60000);

  const snapshot = await page.evaluate(async () => {
    const storeModule = await import('/src/stores/taskEvents/index.ts');
    const state = storeModule.useTaskEventStore.getState();
    const activeTaskId = state.activeTaskId;
    const session = activeTaskId ? state.getSession(activeTaskId) : null;
    return {
      activeTaskId,
      session: session ? {
        taskId: session.taskId,
        isDraft: session.isDraft,
        status: session.status,
        taskMode: session.taskMode,
        updatedAt: session.updatedAt,
        events: session.events.slice(-8).map((e: any) => ({ type: e.type, payload: e.payload })),
        messages: session.messages.slice(-8),
      } : null,
      allSessions: Array.from(state.sessions.values()).slice(-5).map((s: any) => ({
        taskId: s.taskId,
        isDraft: s.isDraft,
        status: s.status,
        title: s.title,
        updatedAt: s.updatedAt,
      })),
    };
  });

  const logs = tauriLogs.getRawSinceBaseline();
  console.log('=== SNAPSHOT ===');
  console.log(JSON.stringify(snapshot, null, 2));
  console.log('=== LOG EXCERPT ===');
  const interesting = logs
    .split('\n')
    .filter((line) => /start_task|send_task_message|TASK_STARTED|TASK_FINISHED|TASK_FAILED|request_effect|approval_required|suspended|error|ready|Received from sidecar|Sending to sidecar/.test(line));
  console.log(interesting.join('\n'));
});
