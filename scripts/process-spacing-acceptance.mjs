// Mounted spacing assertions for the Codex Browser runtime.
// Fixture changes are made through visible controls; evaluate only reads layout.
const check = (condition, message) => { if (!condition) throw new Error(message); };
const control = (tab, id) => tab.playwright.getByTestId(id);

export async function measureProcessSpacing(tab) {
  return tab.playwright.evaluate(() => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height };
    };
    const styleVisible = (element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().height > 0;
    };
    const classify = (element) => element.dataset.outputKind ?? (element.matches(".wb-ai-tool-activity-group, .wb-ai-message-activity, .wb-ai-process-reasoning") ? "process" : element.matches(".ai-elements-message-response, .wb-ai-report") ? "primary" : "boundary");
    const outputGroups = [...document.querySelectorAll(".ai-elements-message-assistant .wb-ai-message-output")].map((output) => [...output.children].filter(styleVisible).map((element) => ({ kind: classify(element), hasKind: Boolean(element.dataset.outputKind), rect: rect(element), messageId: output.closest("[data-message-id]")?.getAttribute("data-message-id") ?? null })));
    const outputs = outputGroups.flat();
    const outputGutters = outputGroups.flatMap((group) => group.slice(1).map((current, index) => ({ from: group[index].kind, to: current.kind, value: current.rect.top - group[index].rect.bottom, messageId: current.messageId })));
    const rows = [...document.querySelectorAll(".wb-ai-message-row")].filter(styleVisible).map((row) => ({ role: row.classList.contains("wb-ai-message-row-user") ? "user" : "assistant", rect: rect(row), messageId: row.getAttribute("data-message-id"), turn: row.closest("[data-message-turn-id]")?.getAttribute("data-message-turn-id") ?? null }));
    const rowGutters = rows.slice(1).map((current, index) => ({ from: rows[index].role, to: current.role, sameTurn: rows[index].turn === current.turn, value: current.rect.top - rows[index].rect.bottom }));
    const closedDetails = [...document.querySelectorAll("[data-slot='tool-activity-list'], [data-slot='reasoning-content']")].filter((element) => element.closest("[data-state='closed'], [aria-expanded='false']"));
    const openHeaders = [...document.querySelectorAll(".wb-ai-tool-activity-header")].map((header) => {
      const detail = header.nextElementSibling;
      return detail && styleVisible(detail) ? { value: detail.getBoundingClientRect().top - header.getBoundingClientRect().bottom, detailHeight: detail.getBoundingClientRect().height } : null;
    }).filter(Boolean);
    return {
      outputs,
      outputGutters,
      rows,
      rowGutters,
      closedFootprints: closedDetails.map((element) => ({ height: element.getBoundingClientRect().height, margin: getComputedStyle(element).margin, padding: getComputedStyle(element).padding })),
      openHeaderDetails: openHeaders,
      outputKindsPresent: outputs.every((output) => output.hasKind && (output.kind === "primary" || output.kind === "process" || output.kind === "boundary")),
      outputKindCoverage: outputs.filter((output) => output.hasKind).length,
    };
  });
}

const near = (actual, expected, tolerance = 1) => Math.abs(actual - expected) <= tolerance;

export async function assertProcessSpacing(tab, { mode = "single" } = {}) {
  await control(tab, mode === "multi" ? "spacing-multi" : "spacing-single").click();
  const result = await measureProcessSpacing(tab);
  check(result.outputKindsPresent, "Direct output children must expose primary/process/boundary classification");
  check(result.outputs.length >= 5, `Spacing fixture rendered too few output blocks: ${result.outputs.length}`);
  for (const gutter of result.outputGutters) {
    const expected = gutter.from === "process" && gutter.to === "process" ? 4 : gutter.from === "primary" && gutter.to === "process" ? 8 : gutter.from === "process" && gutter.to === "primary" ? 12 : 16;
    check(near(gutter.value, expected), `Unexpected ${gutter.from}->${gutter.to} gutter: ${gutter.value}px, expected ${expected}px`);
  }
  const assistantRows = result.rowGutters.filter((gutter) => gutter.from === "assistant" && gutter.to === "assistant" && gutter.sameTurn);
  if (mode === "multi") check(assistantRows.length > 0 && assistantRows.every((gutter) => near(gutter.value, 16)), `Consecutive same-turn assistant row gutter missing: ${JSON.stringify(assistantRows)}`);
  check(result.rowGutters.some((gutter) => gutter.from === "user" && gutter.to === "assistant" && near(gutter.value, 32)), "User-to-assistant turn gutter missing");
  if (mode === "multi") {
    const turnBoundaries = result.rowGutters.filter((gutter) => !gutter.sameTurn);
    check(turnBoundaries.length > 0 && turnBoundaries.every((gutter) => near(gutter.value, 32)), `Turn boundary gutter missing: ${JSON.stringify(turnBoundaries)}`);
  }
  const zeroBox = (value) => value.split(/\s+/).every((part) => Number.parseFloat(part) === 0);
  check(result.closedFootprints.every((footprint) => footprint.height <= 1 && zeroBox(footprint.margin) && zeroBox(footprint.padding)), `Closed details retain layout footprint: ${JSON.stringify(result.closedFootprints)}`);
  return result;
}

export async function assertOpenDetailSpacing(tab) {
  const trigger = tab.playwright.locator("[data-slot='tool-activity-trigger']").first();
  check(await trigger.count() === 1, "No process disclosure available for open-detail measurement");
  await trigger.click();
  const result = await measureProcessSpacing(tab);
  check(result.openHeaderDetails.length > 0 && result.openHeaderDetails.every((detail) => near(detail.value, 8)), `Open detail gutter must be 8px: ${JSON.stringify(result.openHeaderDetails)}`);
  return result.openHeaderDetails;
}

export async function assertTextScaleReflow(tab) {
  await control(tab, "text-scale-200").click();
  const result = await tab.playwright.evaluate(() => {
    const stage = document.querySelector(".tool-activity-stage");
    const controls = [...document.querySelectorAll("[data-testid^='spacing-']")];
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const visible = (element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
    };
    const outputBlocks = [...document.querySelectorAll(".ai-elements-message-assistant .wb-ai-message-output")].flatMap((output) => [...output.children].filter(visible));
    const blockBoxes = outputBlocks.map(box);
    const blockOverlap = blockBoxes.some((current, index) => blockBoxes.slice(index + 1).some((next) => current.left < next.right - 1 && next.left < current.right - 1 && current.top < next.bottom - 1 && next.top < current.bottom - 1));
    const processTriggers = [...document.querySelectorAll(".ai-elements-message-assistant .wb-ai-tool-activity-trigger, .ai-elements-message-assistant .wb-ai-tool-activity-call-trigger")].filter(visible);
    const processParts = processTriggers.map((trigger) => {
      const triggerBox = box(trigger);
      const labels = [...trigger.querySelectorAll(".wb-ai-tool-activity-name, .wb-ai-tool-activity-trigger > span")].filter(visible).map(box);
      const icons = [...trigger.querySelectorAll(".wb-ai-tool-activity-icon, .wb-ai-tool-activity-chevron")].filter(visible).map(box);
      const inside = [...labels, ...icons].every((part) => part.left >= triggerBox.left - 1 && part.right <= triggerBox.right + 1 && part.top >= triggerBox.top - 1 && part.bottom <= triggerBox.bottom + 1);
      return { trigger: triggerBox, inside, labelCount: labels.length, iconCount: icons.length };
    });
    return {
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      stageWidth: stage?.getBoundingClientRect().width ?? 0,
      horizontalOverflow: Boolean(stage && stage.scrollWidth > stage.clientWidth + 1),
      outputHorizontalOverflow: outputBlocks.some((element) => element.scrollWidth > element.clientWidth + 1),
      controlsReachable: controls.every((element) => element.getBoundingClientRect().height > 0),
      visibleProcessTriggerCount: processTriggers.length,
      processParts,
      blockOverlap,
    };
  });
  check(result.rootFontSize === "32px", `Text scale did not reach 200% root size: ${result.rootFontSize}`);
  check(!result.horizontalOverflow && !result.outputHorizontalOverflow && result.controlsReachable, `200% text scale reflow failed: ${JSON.stringify(result)}`);
  check(result.visibleProcessTriggerCount > 0 && result.processParts.every((part) => part.inside), `200% process control bounds failed: ${JSON.stringify(result.processParts)}`);
  check(!result.blockOverlap, "200% text scale caused overlapping primary/process output blocks");
  return { ...result, metadata: await assertMessageMetadataReflow(tab) };
}

export async function measureMessageMetadataReflow(tab) {
  return tab.playwright.evaluate(() => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const inside = (part, bounds) => part.left >= bounds.left - 1 && part.right <= bounds.right + 1 && part.top >= bounds.top - 1 && part.bottom <= bounds.bottom + 1;
    return [...document.querySelectorAll(".wb-ai-message-header")].map((header) => {
      const bounds = box(header);
      const content = box(header.closest(".ai-elements-message-content"));
      const parts = [...header.children].map((part) => {
        const range = document.createRange();
        range.selectNodeContents(part);
        const fragments = [...range.getClientRects()].map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }));
        const rect = part.getBoundingClientRect();
        const style = getComputedStyle(part);
        const visible = style.display !== "none" && style.visibility === "visible" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0 && fragments.length > 0;
        return { text: part.textContent, dateTime: part.getAttribute("datetime"), ariaLabel: part.getAttribute("aria-label"), title: part.getAttribute("title"), visible, fragments, inside: inside(box(part), bounds) && fragments.every((fragment) => inside(fragment, bounds)) };
      });
      const overlap = parts[0].fragments.some((role) => parts[1].fragments.some((time) => role.left < time.right - 1 && time.left < role.right - 1 && role.top < time.bottom - 1 && time.top < role.bottom - 1));
      const style = getComputedStyle(header);
      return { role: header.closest(".wb-ai-message-row").classList.contains("wb-ai-message-row-user") ? "user" : "assistant", createdAt: header.getAttribute("data-message-created-at"), bounds, content, parts, visible: style.display !== "none" && style.visibility === "visible" && Number(style.opacity) > 0 && bounds.right > bounds.left && bounds.bottom > bounds.top, inside: inside(bounds, content) && parts.every((part) => part.inside), overlap };
    });
  });
}

export async function assertMessageMetadataReflow(tab) {
  const headers = await measureMessageMetadataReflow(tab);
  check(headers.some((header) => header.role === "user") && headers.some((header) => header.role === "assistant"), "Metadata reflow fixture must include user and assistant headers");
  check(headers.every((header) => header.visible && header.parts.length === 2 && header.parts.every((part) => part.visible && part.text?.trim())), "Role and complete timestamp must remain visibly present");
  check(headers.every((header) => {
    const time = header.parts[1];
    return time.dateTime && time.dateTime === header.createdAt && time.title && time.ariaLabel?.includes(time.title) && time.ariaLabel.includes(time.text);
  }), "Complete timestamp value and localized accessible label must remain intact");
  check(headers.every((header) => header.inside && !header.overlap), `Role/time metadata clips or overlaps: ${JSON.stringify(headers)}`);
  return headers;
}
