// Mounted regression helpers for the selected Codex Browser runtime.
// Fixture changes use visible controls; evaluate only reads rendered DOM.
const check = (condition, message) => { if (!condition) throw new Error(message); };
const group = (tab) => tab.playwright.locator('[data-message-id="assistant-tool-activity"] [data-slot="tool-activity-trigger"]');
const control = (tab, id) => tab.playwright.getByTestId(id);

export async function verifyReasoningPhase(tab) {
  await control(tab, 'reasoning-only').click();
  await control(tab, 'reasoning-streaming').click();
  await control(tab, 'remount').click();
  check(await group(tab).count() === 1, 'Reasoning must have one summary');
  check(await group(tab).getAttribute('aria-expanded') === 'false', 'Streaming reasoning auto-opened');
  check((await group(tab).innerText()).includes('Thinking'), 'Reasoning phase missing');
  const before = await tab.playwright.evaluate(() => {
    const root = document.querySelector('[data-message-id="assistant-tool-activity"]');
    const surface = root.closest('[data-uimessage-surface]').parentElement;
    const announcer = surface.querySelector('[data-slot="phase-announcement"]');
    return { statuses: surface.querySelectorAll('[role="status"]').length, duplicate: root.querySelectorAll('.wb-ai-message-activity').length, insideBusy: Boolean(announcer?.closest('[aria-busy="true"]')) };
  });
  check(before.statuses === 1 && before.duplicate === 0, 'Duplicate phase announcement');
  check(before.insideBusy === false, 'Phase announcement is delayed by a busy ancestor');
  await control(tab, 'append-activity').click();
  await control(tab, 'complete-calls').click();
  check(await group(tab).getAttribute('aria-expanded') === 'false', 'Completion auto-opened reasoning');
  check(await group(tab).innerText() === 'Thinking process', 'Unknown duration was invented');
  await control(tab, 'empty-reasoning').click();
  check(await group(tab).count() === 0, 'Settled empty reasoning created phantom activity');
  await control(tab, 'reasoning-streaming').click();
  check(await group(tab).count() === 1 && await group(tab).getAttribute('aria-expanded') === 'false', 'Empty active reasoning lost feedback');
  return before;
}

export async function verifyMixedOrder(tab) {
  await control(tab, 'complete-calls').click();
  await control(tab, 'count-10').click();
  await control(tab, 'mixed-reasoning').click();
  await control(tab, 'remount').click();
  await group(tab).press('Enter');
  const order = await tab.playwright.evaluate(() => [...document.querySelectorAll('[data-message-id="assistant-tool-activity"] [data-process-member-id], [data-message-id="assistant-tool-activity"] [data-slot="tool-activity-call"]')].map((element) => element.dataset.processMemberId ?? element.dataset.toolCallId));
  check(order.length === 12 && order[0] === 'reasoning:fixture-reasoning' && order[6] === 'reasoning:fixture-mixed-reasoning' && order[11] === 'fixture-tool-10', `Wrong mixed chronology: ${order}`);
  await control(tab, 'append-reasoning').click();
  check(await group(tab).getAttribute('aria-expanded') === 'true', 'Appended reasoning reset group choice');
  const stepCount = await tab.playwright.locator('[data-message-id="assistant-tool-activity"] [data-process-member-id]').count();
  check(stepCount === 3, 'Appended reasoning lost its identity');
  return { order, reasoningStepsAfterAppend: stepCount };
}

export async function verifyClosedFirstMerge(tab) {
  await control(tab, 'count-10').click();
  await control(tab, 'approval-transition').click();
  await control(tab, 'remount').click();
  check(await group(tab).count() === 2, 'Approval must split the mixed interval');
  await group(tab).last().click();
  const selected = tab.playwright.locator('[data-slot="tool-activity-call"][data-tool-call-id="fixture-tool-4"] [data-slot="tool-activity-call-trigger"]');
  await selected.press('Space');
  await selected.press('Alt+r');
  check(await group(tab).count() === 1 && await group(tab).getAttribute('aria-expanded') === 'true', 'Closed-first merge hid open-second segment');
  check(await selected.getAttribute('aria-expanded') === 'true', 'Merge reset individual call choice');
  await group(tab).click();
  await control(tab, 'append-call').click();
  await control(tab, 'append-reasoning').click();
  await control(tab, 'complete-calls').click();
  check(await group(tab).getAttribute('aria-expanded') === 'false', 'Direct merged close was overridden');
  await group(tab).click();
  check(await selected.getAttribute('aria-expanded') === 'true', 'Group close reset individual detail choice');
  return { closedFirstMergeOpen: true, directCloseRetained: true, callChoiceRetained: true };
}

export async function inspectHierarchy(tab) {
  return tab.playwright.evaluate(() => {
    const root = document.querySelector('[data-message-id="assistant-tool-activity"]');
    const read = (element) => {
      const css = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { font: css.fontSize, line: css.lineHeight, color: css.color, background: css.backgroundColor, gap: css.gap, marginBottom: css.marginBottom, height: rect.height, width: rect.width, scrollWidth: element.scrollWidth, maxHeight: css.maxHeight, overflow: css.overflowY };
    };
    return {
      output: read(root.querySelector('.wb-ai-message-output')),
      responses: [...root.querySelectorAll('.wb-ai-message-output > .ai-elements-message-response, .wb-ai-output-block > .ai-elements-message-response')].map(read),
      triggers: [...root.querySelectorAll('[data-slot="tool-activity-trigger"]')].map(read),
      icons: [...root.querySelectorAll('.wb-ai-tool-activity-chevron')].slice(0, 3).map(read),
      reasoning: [...root.querySelectorAll('.wb-ai-process-reasoning')].map(read),
      content: [...root.querySelectorAll('[data-slot="reasoning-content"]')].map(read),
      lists: [...root.querySelectorAll('[data-slot="tool-activity-list"]')].map(read),
      stage: read(document.querySelector('.tool-activity-stage')),
      shell: read(document.querySelector('.tool-activity-shell')),
    };
  });
}
