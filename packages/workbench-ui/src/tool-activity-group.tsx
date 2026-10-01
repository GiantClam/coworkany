"use client";

import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Ban, ChevronRight, CircleAlert, LoaderCircle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ai-elements/collapsible";
import { Reasoning, ReasoningContent } from "./ai-elements";
import { summarizeToolActivity, summarizeProcessActivity, type ProcessActivityEntry, type ProcessActivityMember, type ToolActivityPart } from "./tool-activity";

function entryIds(entry: ProcessActivityEntry) {
  return entry.type === "process-group" ? entry.members.map((member) => member.id) : entry.type === "tool-group" ? entry.memberIds ?? entry.parts.map((part) => `tool:${part.toolCallId}`) : [];
}

function toolMembers(entry: ProcessActivityEntry): readonly { id: string; part: ToolActivityPart }[] {
  return entry.type === "process-group" ? entry.members.flatMap((member) => member.part.type === "dynamic-tool" ? [{ id: member.id, part: member.part }] : []) : entry.type === "tool-group" ? entry.parts.map((part, index) => ({ id: entry.memberIds?.[index] ?? `tool:${part.toolCallId}`, part })) : [];
}

/** Keep choices at message scope: an approval can split a group without losing call choices. */
export function useToolActivityDisclosures(entries: readonly ProcessActivityEntry[]) {
  const [groups, setGroups] = useState<Record<string, boolean>>({});
  const [calls, setCalls] = useState<Record<string, boolean>>({});
  // A fixed portal container preserves each call's DOM and component state when
  // an approval splits/merges the surrounding groups. Only its host is moved.
  const hosts = useRef(new Map<string, { element: HTMLDivElement; focus?: HTMLElement }>());
  const scrollPositions = useRef(new Map<string, number>());
  useEffect(() => {
    setGroups((previous) => {
      let next = previous;
      for (const entry of entries) {
        const ids = entryIds(entry);
        const choices = ids.map((id) => previous[id]);
        const choice = choices.includes(true) ? true : choices.find((value) => value !== undefined);
        if (choice === undefined) continue;
        for (const id of ids) {
          if (previous[id] !== undefined) continue;
          if (next === previous) next = { ...previous };
          next[id] = choice;
        }
      }
      return next;
    });
  }, [entries]);
  return {
    // When independently toggled split groups merge, keep an inspected group
    // open. Individual call choices are never changed by this reconciliation.
    groupOpen: (parts: readonly ToolActivityPart[], memberIds?: readonly string[]) => (memberIds ?? parts.map((part) => `tool:${part.toolCallId}`)).some((id) => groups[id] === true),
    setGroupOpen: (parts: readonly ToolActivityPart[], open: boolean) => setGroups((previous) => ({ ...previous, ...Object.fromEntries(parts.map((part) => [`tool:${part.toolCallId}`, open])) })),
    membersOpen: (ids: readonly string[]) => ids.some((id) => groups[id] === true),
    setMembersOpen: (ids: readonly string[], open: boolean) => setGroups((previous) => ({ ...previous, ...Object.fromEntries(ids.map((id) => [id, open])) })),
    callOpen: (id: string) => calls[id] ?? false,
    setCallOpen: (id: string, open: boolean) => setCalls((previous) => ({ ...previous, [id]: open })),
    host: (id: string) => {
      if (typeof document === "undefined") return undefined;
      let host = hosts.current.get(id);
      if (!host) {
        host = { element: document.createElement("div") };
        hosts.current.set(id, host);
      }
      return host;
    },
    scrollPositions: scrollPositions.current,
  };
}

type Disclosures = ReturnType<typeof useToolActivityDisclosures>;

function ToolActivityMount({ id, disclosures }: { id: string; disclosures: Disclosures }) {
  const mount = useRef<HTMLDivElement>(null);
  const host = disclosures.host(id);
  useLayoutEffect(() => {
    if (!host || !mount.current) return;
    mount.current.append(host.element);
    host.focus?.focus({ preventScroll: true });
    host.focus = undefined;
    return () => {
      if (document.activeElement instanceof HTMLElement && host.element.contains(document.activeElement)) host.focus = document.activeElement;
      host.element.remove();
    };
  }, [host]);
  return <div ref={mount} />;
}

function ActivityIcon({ phase }: { phase: ReturnType<typeof summarizeToolActivity>["phase"] }) {
  const Icon = phase === "running" ? LoaderCircle : phase === "failed" ? CircleAlert : phase === "denied" ? Ban : undefined;
  if (!Icon) return null;
  return <Icon className={`wb-ai-tool-activity-icon${phase === "running" ? " is-running" : ""}`} aria-hidden="true" />;
}

function detailText(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
}

function ToolActivityCall({ id, part, open, onOpenChange, locale, renderDetails, copyDetails, label }: {
  id: string; part: ToolActivityPart; open: boolean; onOpenChange: (open: boolean) => void; locale: "zh" | "en"; renderDetails: (part: ToolActivityPart) => ReactNode; copyDetails: boolean; label: string;
}) {
  const [copied, setCopied] = useState<"input" | "output" | "failed">();
  const phase = summarizeToolActivity([part], locale).phase;
  const output = part.state === "output-error" ? part.errorText : part.output;
  const copy = async (kind: "input" | "output") => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(detailText(kind === "input" ? part.input : output));
      setCopied(kind);
    } catch { setCopied("failed"); }
  };
  return <Collapsible open={open} onOpenChange={onOpenChange} className="wb-ai-tool-activity-call" data-slot="tool-activity-call" data-tool-call-id={part.toolCallId} data-activity-member-id={id} data-status={phase}>
    <CollapsibleTrigger className="wb-ai-tool-activity-call-trigger" data-slot="tool-activity-call-trigger">
      <ActivityIcon phase={phase} /><span className="wb-ai-tool-activity-name">{label}</span>
      <span className="wb-ai-tool-activity-call-state">{locale === "zh" ? ({ running: "运行中", completed: "已完成", failed: "失败", denied: "已拒绝", waiting: "等待中" })[phase] : ({ running: "Running", completed: "Completed", failed: "Failed", denied: "Denied", waiting: "Waiting" })[phase]}</span>
      <ChevronRight className="wb-ai-tool-activity-chevron" aria-hidden="true" />
    </CollapsibleTrigger>
    <CollapsibleContent className="wb-ai-tool-activity-details" data-slot="tool-activity-details">
      {copyDetails ? <div className="wb-ai-tool-activity-copy-actions">
        <button type="button" onClick={() => void copy("input")}>{copied === "input" ? (locale === "zh" ? "已复制参数" : "Input copied") : (locale === "zh" ? "复制完整参数" : "Copy full input")}</button>
        {output !== undefined ? <button type="button" onClick={() => void copy("output")}>{copied === "output" ? (locale === "zh" ? "已复制输出" : "Output copied") : (locale === "zh" ? "复制完整输出" : "Copy full output")}</button> : null}
        {copied === "failed" ? <span role="alert">{locale === "zh" ? "复制失败，请在详情中选择文本" : "Copy failed; select the text in details"}</span> : null}
      </div> : null}
      {renderDetails(part)}
    </CollapsibleContent>
  </Collapsible>;
}

/** Portals stay keyed at message scope; regrouping never remounts unaffected calls. */
export function ToolActivityPortals({ entries, locale, disclosures, renderDetails, copyDetails = true, callLabel = (part) => part.toolName }: {
  entries: readonly ProcessActivityEntry[]; locale: "zh" | "en"; disclosures: Disclosures; renderDetails: (part: ToolActivityPart) => ReactNode; copyDetails?: boolean; callLabel?: (part: ToolActivityPart) => string;
}) {
  const latestMembers = new Map(entries.flatMap(toolMembers).map((member) => [member.id, member]));
  return <>{[...latestMembers.values()].map(({ id, part }) => {
    const host = disclosures.host(id);
    return host ? createPortal(<ToolActivityCall id={id} part={part} open={disclosures.callOpen(id)} onOpenChange={(next) => disclosures.setCallOpen(id, next)} locale={locale} renderDetails={renderDetails} copyDetails={copyDetails} label={callLabel(part)} />, host.element, id) : null;
  })}</>;
}

function ProcessReasoningStep({ member, locale, disclosures }: { member: ProcessActivityMember; locale: "zh" | "en"; disclosures: Disclosures }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollKey = `content:${member.id}`;
  useLayoutEffect(() => {
    const content = ref.current?.querySelector<HTMLElement>('[data-slot="reasoning-content"]');
    if (content) content.scrollTop = disclosures.scrollPositions.get(scrollKey) ?? 0;
  }, [disclosures.scrollPositions, scrollKey]);
  if (member.part.type !== "reasoning") return null;
  return <div ref={ref} onScrollCapture={(event) => { if (event.target instanceof HTMLElement && event.target.dataset.slot === "reasoning-content") disclosures.scrollPositions.set(scrollKey, event.target.scrollTop); }}><Reasoning open isStreaming={false} locale={locale} className="wb-ai-process-reasoning" data-process-member-id={member.id}>
    <span className="wb-ai-process-step-label">{locale === "zh" ? "思考" : "Reasoning"}</span>
    <ReasoningContent tabIndex={0} aria-label={locale === "zh" ? "思考内容" : "Reasoning content"}>{member.part.text}</ReasoningContent>
  </Reasoning></div>;
}

export function ToolActivityGroup({ parts, members, memberIds, active = false, locale, disclosures, children }: {
  parts: readonly ToolActivityPart[]; members?: readonly ProcessActivityMember[]; memberIds?: readonly string[]; active?: boolean; locale: "zh" | "en"; disclosures: Disclosures; children?: ReactNode;
}) {
  const summary = members ? summarizeProcessActivity(members.map((member) => member.part), locale, active) : summarizeToolActivity(parts, locale);
  const ids = members ? members.map((member) => member.id) : memberIds ?? parts.map((part) => `tool:${part.toolCallId}`);
  const rows = members ? members.flatMap((member) => member.part.type === "dynamic-tool" ? [{ id: member.id, part: member.part }] : []) : parts.map((part, index) => ({ id: ids[index]!, part }));
  const open = disclosures.membersOpen(ids);
  const setOpen = (next: boolean) => disclosures.setMembersOpen(ids, next);
  const groupRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousList = useRef<{ element: HTMLDivElement; members: string } | undefined>(undefined);
  const positions = disclosures.scrollPositions;
  const memberKey = JSON.stringify(ids);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) { previousList.current = undefined; return; }
    if (previousList.current?.element === list && previousList.current.members === memberKey) return;
    const focusedCall = document.activeElement instanceof HTMLElement && list.contains(document.activeElement)
      ? document.activeElement.closest<HTMLElement>('[data-slot="tool-activity-call"]')?.dataset.activityMemberId : undefined;
    const inspectedOffset = focusedCall ? positions.get(focusedCall) : undefined;
    const openOffset = ids.filter((id) => disclosures.membersOpen([id])).map((id) => positions.get(id)).find((value) => value !== undefined);
    list.scrollTop = inspectedOffset ?? openOffset ?? ids.map((id) => positions.get(id)).find((value) => value !== undefined) ?? 0;
    previousList.current = { element: list, members: memberKey };
  }, [memberKey, positions, open]);
  const [inspection, setInspection] = useState<{ id: string; revision: number }>();
  useEffect(() => {
    if (!inspection || !open) return;
    const call = Array.from(groupRef.current?.querySelectorAll<HTMLElement>('[data-slot="tool-activity-call"]') ?? []).find((element) => element.dataset.toolCallId === inspection.id);
    // Scroll only inside the bounded list: preserve the conversation reading position.
    const list = groupRef.current?.querySelector<HTMLElement>('[data-slot="tool-activity-list"]');
    if (call && list) list.scrollTop += call.getBoundingClientRect().top - list.getBoundingClientRect().top;
  }, [inspection, open]);
  const inspectFailure = () => {
    const id = summary.failedCallIds[0];
    if (!id) return;
    setOpen(true);
    const memberId = rows.find((row) => row.part.toolCallId === id)?.id;
    if (memberId) disclosures.setCallOpen(memberId, true);
    setInspection((previous) => ({ id, revision: (previous?.revision ?? 0) + 1 }));
  };
  return <Collapsible ref={groupRef} open={open} onOpenChange={setOpen} className="wb-ai-tool-activity-group" data-slot="tool-activity-group" data-process-kind={"kind" in summary ? summary.kind : undefined} data-process-id={members?.[0]?.id} data-tool-call-id={parts[0]?.toolCallId} data-tool-name={parts[0]?.toolName} data-status={summary.phase} aria-busy={summary.phase === "running" || undefined}>
    <div className="wb-ai-tool-activity-header">
      <CollapsibleTrigger className="wb-ai-tool-activity-trigger" data-slot="tool-activity-trigger">
        <ActivityIcon phase={summary.phase} /><span>{summary.label}</span><ChevronRight className="wb-ai-tool-activity-chevron" aria-hidden="true" />
      </CollapsibleTrigger>
      {summary.failed > 0 ? <button type="button" className="wb-ai-tool-activity-failure-action" data-slot="tool-activity-failure-action" onClick={inspectFailure}>{locale === "zh" ? "查看失败详情" : "Inspect failure"}</button> : null}
    </div>
    <CollapsibleContent ref={listRef} className="wb-ai-tool-activity-list" data-slot="tool-activity-list" onScroll={(event) => { for (const id of ids) positions.set(id, event.currentTarget.scrollTop); }}>
      {members ? members.map((member) => member.part.type === "dynamic-tool" ? <ToolActivityMount key={member.id} id={member.id} disclosures={disclosures} /> : <ProcessReasoningStep key={member.id} member={member} locale={locale} disclosures={disclosures} />) : rows.map((row) => <ToolActivityMount key={row.id} id={row.id} disclosures={disclosures} />)}
    </CollapsibleContent>
    {children}
  </Collapsible>;
}
