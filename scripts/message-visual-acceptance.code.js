async (page) => {
  const base = "__BASE_URL__";
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const report = { target: "6a9d5b1822ffb10bba4bd97175f01edd7d8651cd", comparisons: [], interactions: [], pageErrors: errors };
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const url = (view, query = "") => `${base}/test/fixtures/assistant-turn-${view === "official" ? "reference" : "acceptance"}.html?${query}`;
  const goto = async (view, query) => {
    await page.goto(url(view, query));
    await page.locator('[data-slot="message-content"]').first().waitFor();
  };
  const state = async (slot) => page.locator(`[data-slot="${slot}"]`).last().getAttribute("data-state");
  const sharedSlots = ["user-message-content", "message-content", "reasoning-trigger", "message-response", "message-actions", "message-toolbar"];
  const sharedMetrics = async () => page.evaluate(() => {
    const properties = ["display", "flexDirection", "alignItems", "justifyContent", "gap", "fontSize", "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderTopColor", "borderRadius", "color", "backgroundColor", "marginTop", "marginBottom"];
    const slots = ["user-message-content", "message-content", "reasoning-trigger", "message-response", "message-actions", "message-toolbar"];
    return Object.fromEntries(slots.map((slot) => {
      const selector = slot === "user-message-content" ? '[data-slot="message"][data-message-role="user"] [data-slot="message-content"]' : slot === "message-response" ? ".ai-elements-message-response, .reference-message-response" : `[data-slot="${slot}"]`;
      const element = [...document.querySelectorAll(selector)].at(-1);
      if (!element) throw new Error(`Missing ${slot}`);
      const css = getComputedStyle(element);
      return [slot, Object.fromEntries(properties.map((property) => [property, css[property]]))];
    }));
  });
  const metrics = async () => page.evaluate(() => {
    const properties = ["display", "flexDirection", "alignItems", "justifyContent", "gap", "fontSize", "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderTopColor", "borderRadius", "color", "backgroundColor", "marginTop", "marginBottom"];
    const slots = ["user-message-content", "message-content", "reasoning-trigger", "tool", "tool-header", "message-response", "message-actions", "message-toolbar"];
    return Object.fromEntries(slots.map((slot) => {
      const selector = slot === "user-message-content" ? '[data-slot="message"][data-message-role="user"] [data-slot="message-content"]' : slot === "message-response" ? ".ai-elements-message-response, .reference-message-response" : `[data-slot="${slot}"]`;
      const element = [...document.querySelectorAll(selector)].at(-1);
      if (!element) throw new Error(`Missing ${slot}`);
      const css = getComputedStyle(element);
      return [slot, Object.fromEntries(properties.map((property) => [property, css[property]]))];
    }));
  });
  const expandedMetrics = async () => page.evaluate(() => {
    const properties = ["display", "flexDirection", "gap", "fontSize", "lineHeight", "paddingTop", "paddingRight", "paddingLeft", "borderTopWidth", "borderTopColor", "color", "backgroundColor"];
    const selectors = {
      "conversation-content": '[data-slot="conversation-content"]',
      "reasoning-content": '[data-slot="reasoning-content"]',
      "tool-content": '[data-slot="tool-content"]',
      "tool-input": '[data-slot="tool-input"]',
      "tool-output": '[data-slot="tool-output"]',
      "tool-badge": '[data-slot="tool-header"] .rounded-full',
      "reasoning-icon": '[data-slot="reasoning-trigger"] svg',
      "tool-icon": '[data-slot="tool-header"] svg',
    };
    return Object.fromEntries(Object.entries(selectors).map(([slot, selector]) => {
      const element = [...document.querySelectorAll(selector)].at(-1);
      if (!element) throw new Error(`Missing expanded ${slot}`);
      const css = getComputedStyle(element);
      const result = Object.fromEntries(properties.map((property) => [property, css[property]]));
      if (slot.endsWith("icon") || slot === "tool-badge") {
        const rect = element.getBoundingClientRect();
        result.width = rect.width;
        result.height = rect.height;
      }
      return [slot, result];
    }));
  });
  const desktopExpandedMetrics = async () => page.evaluate(() => {
    const properties = ["display", "flexDirection", "gap", "fontSize", "lineHeight", "paddingTop", "paddingRight", "paddingLeft", "borderTopWidth", "borderTopColor", "color", "backgroundColor"];
    const selectors = {
      "conversation-content": '[data-slot="conversation-content"]',
      "reasoning-content": '[data-slot="reasoning-content"]',
      "tool-activity-group": '[data-slot="tool-activity-group"]',
      "tool-activity-trigger": '[data-slot="tool-activity-trigger"]',
      "tool-activity-call-trigger": '[data-slot="tool-activity-call-trigger"]',
      "tool-activity-details": '[data-slot="tool-activity-details"]',
      "tool-content": '[data-slot="tool-content"]',
      "tool-input": '[data-slot="tool-input"]',
      "tool-output": '[data-slot="tool-output"]',
    };
    return Object.fromEntries(Object.entries(selectors).map(([slot, selector]) => {
      const element = [...document.querySelectorAll(selector)].at(-1);
      if (!element) throw new Error(`Missing compact expanded ${slot}`);
      const css = getComputedStyle(element);
      return [slot, Object.fromEntries(properties.map((property) => [property, css[property]]))];
    }));
  });
  await page.setViewportSize({ width: 1100, height: 850 });
  for (const theme of ["light", "dark"]) {
    const pair = {};
    const expandedPair = {};
    for (const view of ["official", "desktop"]) {
      await goto(view, `theme=${theme}&step=7`);
      pair[view] = view === "official" ? await metrics() : await sharedMetrics();
      check(pair[view]["reasoning-trigger"].display === "flex", `${view}: reasoning must be a flex row`);
      check(pair[view]["reasoning-trigger"].fontSize === "14px", `${view}: reasoning typography`);
      check(pair[view]["message-content"].display === "flex", `${view}: message content layout`);
      check(pair[view]["message-content"].gap === "8px", `${view}: message spacing`);
      if (view === "official") {
        check(pair[view]["tool-header"].paddingTop === "12px", `${view}: tool padding`);
        check(pair[view].tool.borderTopWidth === "1px", `${view}: tool border`);
        check(pair[view].tool.borderTopColor !== pair[view].tool.color, `${view}: tool must use the theme border color`);
      } else {
        const group = page.locator('[data-slot="tool-activity-group"]').last();
        await group.waitFor();
        check(await group.getAttribute("data-state") === "closed", `${view}: compact tool group starts collapsed`);
        check(await group.locator('[data-slot="tool-activity-trigger"]').count() === 1, `${view}: compact group trigger missing`);
        check(await group.locator('[data-slot="tool-activity-call"]').count() === 0, `${view}: collapsed group must hide call rows`);
      }
      await page.screenshot({ path: `output/playwright/message-parity-${view}-${theme}.png`, fullPage: true });
      await page.locator('[data-slot="reasoning-trigger"]').focus();
      await page.keyboard.press("Enter");
      if (view === "official") {
        await page.locator('[data-slot="tool-header"]').focus();
        await page.keyboard.press("Enter");
        await page.locator('[data-slot="tool-output"]').waitFor();
        await page.waitForFunction(() => !document.getAnimations().some((animation) => animation.playState === "running" && animation.effect?.target instanceof Element && animation.effect.target.closest('[data-slot="reasoning-trigger"], [data-slot="reasoning-content"], [data-slot="tool-header"], [data-slot="tool-content"]')));
        expandedPair[view] = await expandedMetrics();
        check(expandedPair[view]["reasoning-icon"].width === 16 && expandedPair[view]["tool-icon"].width === 16, `${view}: upstream icon scale`);
        await page.locator('[data-slot="tool-header"]').evaluate((element) => element.blur());
      } else {
        const group = page.locator('[data-slot="tool-activity-group"]').last();
        const groupTrigger = group.locator('[data-slot="tool-activity-trigger"]');
        await groupTrigger.focus();
        await page.keyboard.press("Enter");
        check(await group.getAttribute("data-state") === "open", `${view}: compact group keyboard open`);
        const call = group.locator('[data-slot="tool-activity-call"]').last();
        await call.waitFor();
        const callTrigger = call.locator('[data-slot="tool-activity-call-trigger"]');
        await callTrigger.focus();
        await page.keyboard.press("Enter");
        await call.locator('[data-slot="tool-activity-details"]').waitFor();
        await call.locator('[data-slot="tool-output"]').waitFor();
        expandedPair[view] = await desktopExpandedMetrics();
        check(expandedPair[view]["tool-activity-group"].display === "block", `${view}: compact group layout`);
        check(await call.getAttribute("data-state") === "open", `${view}: compact call keyboard open`);
        await callTrigger.evaluate((element) => element.blur());
      }
      await page.locator(".ai-elements-conversation-viewport").evaluate((element) => { element.scrollTop = 0; });
      await page.screenshot({ path: `output/playwright/message-parity-${view}-expanded-${theme}.png`, fullPage: true });
    }
    for (const slot of sharedSlots) {
      const properties = pair.official[slot];
      for (const [property, expected] of Object.entries(properties)) {
        check(pair.desktop[slot][property] === expected, `${theme} ${slot}.${property}: official=${expected}, desktop=${pair.desktop[slot][property]}`);
      }
    }
    for (const slot of ["conversation-content", "reasoning-content"]) {
      const properties = expandedPair.official[slot];
      for (const [property, expected] of Object.entries(properties)) {
        check(expandedPair.desktop[slot][property] === expected, `${theme} expanded ${slot}.${property}: official=${expected}, desktop=${expandedPair.desktop[slot][property]}`);
      }
    }
    report.comparisons.push({ theme, ...pair });
    report.comparisons.push({ theme, state: "expanded", ...expandedPair });
    const scrollPair = {};
    for (const view of ["official", "desktop"]) {
      await goto(view, `theme=${theme}&scenario=scroll&step=3`);
      await page.waitForFunction(() => {
        const element = document.querySelector(".ai-elements-conversation-viewport");
        return element && element.scrollTop > element.scrollHeight - element.clientHeight - 10;
      });
      await page.locator(".ai-elements-conversation-viewport").hover();
      await page.mouse.wheel(0, -600);
      await page.locator('[data-slot="conversation-scroll-button"]').waitFor();
      scrollPair[view] = await page.locator('[data-slot="conversation-scroll-button"]').evaluate((element) => {
        const css = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const parent = element.parentElement.getBoundingClientRect();
        return { width: rect.width, height: rect.height, centerOffset: Math.round(rect.x + rect.width / 2 - parent.x - parent.width / 2), bottom: css.bottom, padding: css.padding, borderRadius: css.borderRadius, borderTopColor: css.borderTopColor, color: css.color, backgroundColor: css.backgroundColor };
      });
      check(scrollPair[view].width === 36 && scrollPair[view].height === 36 && scrollPair[view].centerOffset === 0, `${view}: centered upstream scroll control`);
    }
    check(JSON.stringify(scrollPair.desktop) === JSON.stringify(scrollPair.official), `${theme}: scroll button geometry differs`);
    report.comparisons.push({ theme, state: "manual-scroll", ...scrollPair });
  }
  for (const view of ["official", "desktop"]) {
    await goto(view, "theme=light&step=1");
    check(await state("reasoning") === "open", `${view}: streaming reasoning must open`);
    await page.screenshot({ path: `output/playwright/message-parity-${view}-thinking.png`, fullPage: true });
    await page.getByTestId("advance").click();
    await page.waitForFunction(() => document.querySelector('[data-slot="reasoning"]')?.getAttribute("data-state") === "closed");
    await page.locator('[data-slot="reasoning-trigger"]').focus();
    await page.keyboard.press("Enter");
    check(await state("reasoning") === "open", `${view}: keyboard reasoning reopen`);
    await page.screenshot({ path: `output/playwright/message-parity-${view}-reasoning-expanded.png`, fullPage: true });
    await page.getByTestId("advance").click();
    if (view === "official") {
      check(await state("tool") === "open", `${view}: running tool automatic expansion`);
      await page.screenshot({ path: `output/playwright/message-parity-${view}-tool-running.png`, fullPage: true });
      await page.evaluate(() => { window.acceptanceToolNode = document.querySelector('[data-slot="tool"]'); });
      await page.getByTestId("advance").click();
      check(await state("tool") === "closed", `${view}: completed mounted tool collapse`);
      await page.screenshot({ path: `output/playwright/message-parity-${view}-tool-completed.png`, fullPage: true });
      check(await page.evaluate(() => window.acceptanceToolNode === document.querySelector('[data-slot="tool"]')), `${view}: tool remounted during completion`);
      await page.getByTestId("remount").click();
      check(await state("tool") === "closed", `${view}: restored complete tool collapsed`);
      await goto(view, "theme=light&step=3");
      await page.locator('[data-slot="tool-header"]').focus();
      await page.keyboard.press("Enter");
      check(await state("tool") === "closed", `${view}: keyboard tool close`);
      await page.keyboard.press("Space");
      check(await state("tool") === "open", `${view}: keyboard tool open`);
      await page.getByTestId("advance").click();
      check(await state("tool") === "open", `${view}: preserve manual open on completion`);
    } else {
      const group = page.locator('[data-slot="tool-activity-group"]').last();
      check(await group.getAttribute("data-state") === "closed", `${view}: running compact group starts collapsed`);
      await page.evaluate(() => { window.acceptanceToolNode = document.querySelector('[data-slot="tool-activity-group"]'); });
      await group.locator('[data-slot="tool-activity-trigger"]').focus();
      await page.keyboard.press("Enter");
      const call = group.locator('[data-slot="tool-activity-call"]').last();
      await call.waitFor();
      await page.evaluate(() => { window.acceptanceToolCallNode = document.querySelector('[data-slot="tool-activity-call"]'); });
      await call.locator('[data-slot="tool-activity-call-trigger"]').focus();
      await page.keyboard.press("Enter");
      check(await group.getAttribute("data-state") === "open", `${view}: running compact group opens`);
      check(await call.getAttribute("data-state") === "open", `${view}: running compact call opens`);
      check(await call.locator('[data-slot="tool-input"]').count() === 1, `${view}: running compact call input missing`);
      check(await call.locator('[data-slot="tool-output"]').count() === 0, `${view}: running compact call must not expose output early`);
      await page.screenshot({ path: `output/playwright/${view}-tool-running.png`, fullPage: true });
      await page.getByTestId("advance").click();
      await call.locator('[data-slot="tool-output"]').waitFor();
      check(await group.getAttribute("data-state") === "open", `${view}: completed group preserves manual open`);
      check(await call.getAttribute("data-state") === "open", `${view}: completed call preserves manual open`);
      await page.screenshot({ path: `output/playwright/${view}-tool-completed.png`, fullPage: true });
      check(await page.evaluate(() => window.acceptanceToolNode === document.querySelector('[data-slot="tool-activity-group"]')), `${view}: tool group remounted during completion`);
      check(await page.evaluate(() => window.acceptanceToolCallNode === document.querySelector('[data-slot="tool-activity-call"]')), `${view}: portal tool call remounted during completion`);
      await page.getByTestId("remount").click();
      check(await state("tool-activity-group") === "closed", `${view}: restored complete group collapsed`);
      await goto(view, "theme=light&step=3");
      const manualGroup = page.locator('[data-slot="tool-activity-group"]').last();
      await manualGroup.locator('[data-slot="tool-activity-trigger"]').focus();
      await page.keyboard.press("Enter");
      check(await manualGroup.getAttribute("data-state") === "open", `${view}: keyboard group open`);
      const manualCall = manualGroup.locator('[data-slot="tool-activity-call"]').last();
      await manualCall.waitFor();
      await manualCall.locator('[data-slot="tool-activity-call-trigger"]').focus();
      await page.keyboard.press("Enter");
      check(await manualCall.getAttribute("data-state") === "open", `${view}: keyboard call open`);
      await page.getByTestId("advance").click();
      check(await manualGroup.getAttribute("data-state") === "open", `${view}: preserve manual group open on completion`);
      check(await manualCall.getAttribute("data-state") === "open", `${view}: preserve manual call open on completion`);
    }
    if (view === "desktop") {
      for (const scenario of ["approval", "error", "denied"]) {
        await goto(view, `theme=light&step=4&scenario=${scenario}`);
        if (scenario === "approval") {
          check(await state("tool") === "open", `${scenario}: disclosure state`);
          check(!(await page.locator('[data-slot="tool-header"]').innerText()).includes("tool-search-1"), "visible raw tool id");
          check(await page.getByRole("button", { name: "Approve", exact: true }).isVisible(), "approval action not visible");
          await page.screenshot({ path: `output/playwright/message-parity-desktop-${scenario}.png`, fullPage: true });
          await page.locator('[data-slot="tool-header"]').focus();
          await page.keyboard.press("Enter");
          check(await state("tool") === "closed", `${scenario}: keyboard disclosure toggle`);
        } else {
          const group = page.locator('[data-slot="tool-activity-group"]').last();
          check(await group.getAttribute("data-state") === "closed", `${scenario}: compact group starts collapsed`);
          await group.locator('[data-slot="tool-activity-trigger"]').focus();
          await page.keyboard.press("Enter");
          const call = group.locator('[data-slot="tool-activity-call"]').last();
          await call.waitFor();
          await call.locator('[data-slot="tool-activity-call-trigger"]').focus();
          await page.keyboard.press("Enter");
          check(await call.getAttribute("data-state") === "open", `${scenario}: compact call opens`);
          if (scenario === "error") check((await page.locator('[data-slot="tool-output"]').innerText()).includes("Fixture tool failed"), "tool error missing");
          await page.screenshot({ path: `output/playwright/message-parity-desktop-${scenario}.png`, fullPage: true });
          await call.locator('[data-slot="tool-activity-call-trigger"]').focus();
          await page.keyboard.press("Enter");
          check(await call.getAttribute("data-state") === "closed", `${scenario}: compact call keyboard toggle`);
        }
      }
    }
    report.interactions.push({ view, reasoningAutoClose: true, keyboard: true, mountedToolCompletion: true, manualExpansion: true });
  }
  for (const theme of ["light", "dark"]) {
    await goto("desktop", `theme=${theme}&step=5&scenario=markdown`);
    check(await page.locator('.ai-elements-message-response h2').innerText() === "Result", "streaming Markdown heading");
    await page.getByTestId("advance").click();
    await page.waitForFunction(() => document.querySelector('.ai-elements-message-response pre')?.textContent?.includes('const answer = 42;'));
    check((await page.locator('.ai-elements-message-response pre').innerText()).includes("const answer = 42;"), "completed Markdown code");
    await page.setViewportSize({ width: 420, height: 800 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "narrow viewport page overflow");
    await page.screenshot({ path: `output/playwright/message-parity-markdown-${theme}.png`, fullPage: true });
    await page.setViewportSize({ width: 1100, height: 850 });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await goto("desktop", "theme=light&step=1");
  check(await page.locator(".ai-elements-official-shimmer").evaluate((element) => getComputedStyle(element).animationName) === "none", "reduced motion shimmer must be disabled");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  report.interactions.push({ approval: true, error: true, denied: true, reducedMotion: true, markdown: { themes: ["light", "dark"], streamingFence: true, narrowViewport: 420 } });
  await goto("desktop", "theme=light&scenario=restore&step=3");
  await page.waitForTimeout(1200);
  const restoredTop = await page.locator(".ai-elements-conversation-viewport").evaluate((element) => element.scrollTop);
  check(Math.abs(restoredTop - 420) < 3, `restored scroll raced initial bottom follow: ${restoredTop}`);
  await page.getByTestId("advance").click();
  await page.getByTestId("append-activity").click();
  check(Math.abs(await page.locator(".ai-elements-conversation-viewport").evaluate((element) => element.scrollTop) - 420) < 3, "restored scroll moved during activity");
  report.interactions.push({ restoredScrollTop: restoredTop });
  await goto("desktop", "theme=light&scenario=scroll&step=3");
  const viewport = page.locator(".ai-elements-conversation-viewport");
  await page.waitForFunction(() => {
    const element = document.querySelector(".ai-elements-conversation-viewport");
    return element && element.scrollTop > element.scrollHeight - element.clientHeight - 10;
  });
  await viewport.hover();
  await page.mouse.wheel(0, -600);
  await page.waitForFunction(() => document.querySelector('[data-slot="conversation-scroll-button"]'));
  const before = await viewport.evaluate((element) => element.scrollTop);
  await page.getByTestId("advance").click();
  await page.getByTestId("append-activity").click();
  const after = await viewport.evaluate((element) => element.scrollTop);
  check(Math.abs(after - before) < 3, `manual scroll jumped ${before} -> ${after}`);
  await page.getByRole("button", { name: "Scroll to latest", exact: true }).click();
  await page.waitForFunction(() => {
    const element = document.querySelector(".ai-elements-conversation-viewport");
    return element && element.scrollTop > element.scrollHeight - element.clientHeight - 10;
  });
  await page.getByTestId("complete").click();
  const signature = () => page.locator('[data-slot="message-output"]').last().locator(":scope > [data-slot], :scope > .ai-elements-message-response").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-slot") ?? "message-response"));
  const beforeReload = await signature();
  // Session state proves a fresh mount. UIMessage persistence is tested separately.
  await page.goto(url("desktop", "theme=light&scenario=scroll"));
  await page.locator('[data-slot="tool-activity-group"]').waitFor();
  check((await page.getByTestId("step").innerText()) === "7", "completed fixture reload state");
  check(JSON.stringify(await signature()) === JSON.stringify(beforeReload), "reload chronology changed");
  check(await state("tool-activity-group") === "closed", "reloaded completed tool group must collapse");
  report.interactions.push({ manualScroll: { before, after }, returnToLatest: true, reload: true, chronology: beforeReload });
  check(errors.length === 0, `Browser errors: ${errors.join("; ")}`);
  await page.evaluate((result) => { window.MESSAGE_VISUAL_REPORT = result; }, report);
}
