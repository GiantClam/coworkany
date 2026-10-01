// Run with the selected in-app Browser's tab from node_repl, not standalone
// Playwright/CDP. The tab must show tool-activity-acceptance.html in English.
// All mutations use visible fixture controls; evaluate only inspects the DOM.
const check = (condition, message) => { if (!condition) throw new Error(message); };
const trigger = (tab) => tab.playwright.locator('[data-slot="tool-activity-trigger"]');
const call = (tab, id) => tab.playwright.locator(`[data-slot="tool-activity-call"][data-tool-call-id="${id}"]`);
const callTrigger = (tab, id) => tab.playwright.locator(`[data-slot="tool-activity-call"][data-tool-call-id="${id}"] [data-slot="tool-activity-call-trigger"]`);
const control = (tab, id) => tab.playwright.getByTestId(id);

export async function verifyDensity(tab) {
  await control(tab, 'complete-calls').click();
  await control(tab, 'remount').click();
  const result = [];
  for (const count of [1, 10, 50]) {
    await control(tab, `count-${count}`).click();
    check(await trigger(tab).count() === 1, `${count} calls must occupy one group`);
    check(await trigger(tab).getAttribute('aria-expanded') === 'false', 'Group must start closed');
    check(await tab.playwright.locator('[data-slot="tool-input"]').count() === 0, 'Closed trace leaked raw input');
    result.push({ count, summary: await trigger(tab).innerText() });
  }
  return result;
}

export async function verifyBoundaryContinuity(tab) {
  await control(tab, 'count-50').click();
  await control(tab, 'remount').click();
  await trigger(tab).press('Enter');
  const id = 'fixture-tool-21';
  await callTrigger(tab, id).press('Space');
  await tab.playwright.getByRole('button', { name: 'Copy full input', exact: true }).click();
  await tab.playwright.getByRole('button', { name: 'Input copied', exact: true }).waitFor({ state: 'visible' });
  await callTrigger(tab, id).press('Alt+r');
  const inspect = () => call(tab, id).evaluate((element) => ({
    focus: element.contains(document.activeElement),
    scroll: element.closest('[data-slot="tool-activity-list"]').scrollTop,
  }));
  const before = await inspect();
  check(before.focus && before.scroll > 0, 'Fixture must inspect a scrolled, focused call');
  for (const key of ['Alt+a', 'Alt+m', 'Alt+r']) {
    // Send to the already focused call. Locator.press may scroll its target
    // into view before dispatch, which would itself change the reading offset.
    await tab.cua.keypress({ keys: ['ALT', key.split('+')[1]] });
    const after = await inspect();
    check(after.focus && after.scroll === before.scroll, `${key}: focus or list offset changed (${JSON.stringify({ before, after })})`);
    check(await callTrigger(tab, id).getAttribute('aria-expanded') === 'true', `${key}: call choice lost`);
    check(await tab.playwright.getByRole('button', { name: 'Input copied', exact: true }).count() === 1, `${key}: call component remounted`);
  }
  // Conflicting split-group choices reconcile open, preserving inspection.
  await callTrigger(tab, id).press('Alt+m');
  await trigger(tab).first().click();
  await callTrigger(tab, id).press('Alt+r');
  check(await trigger(tab).getAttribute('aria-expanded') === 'true', 'Merge hid the inspected group');
  await control(tab, 'append-call').click();
  await control(tab, 'complete-calls').click();
  check(await tab.playwright.locator('[data-slot="tool-activity-call"]').count() === 51, 'Append lost a call');
  check(await callTrigger(tab, id).getAttribute('aria-expanded') === 'true', 'Completion reset call choice');
  check(await tab.playwright.locator('[data-slot="tool-output"]').count() === 1, 'Unselected outputs expanded');
  return { focusedCall: id, retainedListOffset: before.scroll, callsAfterAppend: 51 };
}

export async function verifyFullInspection(tab) {
  await control(tab, 'count-10').click();
  await control(tab, 'remount').click();
  await control(tab, 'mixed-outcomes').click();
  check((await trigger(tab).first().innerText()).includes('failed'), 'Failure hidden in closed summary');
  await tab.playwright.getByRole('button', { name: 'Inspect failure', exact: true }).first().click();
  check(await callTrigger(tab, 'fixture-tool-2').getAttribute('aria-expanded') === 'true', 'Failure action missed failed call');
  await control(tab, 'complete-calls').click();
  await control(tab, 'remount').click();
  await control(tab, 'long-output').click();
  await trigger(tab).click();
  await callTrigger(tab, 'fixture-tool-1').click();
  await tab.playwright.getByRole('button', { name: 'Copy full output', exact: true }).click();
  await tab.playwright.getByRole('button', { name: 'Output copied', exact: true }).waitFor({ state: 'visible' });
  await tab.playwright.getByRole('textbox', { name: 'Clipboard verification', exact: true }).press('Meta+v');
  const copied = await tab.playwright.getByRole('textbox', { name: 'Clipboard verification', exact: true }).evaluate((element) => ({
    length: element.value.length,
    complete: element.value.endsWith('LONG_OUTPUT_SENTINEL_tool_activity_fixture'),
  }));
  check(copied.complete && copied.length > 20000, 'Long output copy was truncated');
  await control(tab, 'approval-transition').click();
  await tab.playwright.locator('[data-slot="tool-header"]').click();
  check(await tab.playwright.getByRole('button', { name: 'Approve', exact: true }).isVisible(), 'Closing parameters hid approval');
  await tab.playwright.getByRole('button', { name: 'Reject', exact: true }).click();
  check((await trigger(tab).innerText()).includes('denied'), 'Rejection reported as success');
  return copied;
}
