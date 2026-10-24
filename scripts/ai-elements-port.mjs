import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const AI_ELEMENTS_COMMIT = "6a9d5b1822ffb10bba4bd97175f01edd7d8651cd";
export const AI_ELEMENTS_PORTS = ["message", "reasoning", "tool", "conversation"];

/** Reproducible import/dependency adaptations; keep upstream JSX and classes. */
export function adaptAIElementsSource(name, original) {
  let source = original
    .replaceAll('"@repo/shadcn-ui/components/ui/collapsible"', '"../collapsible"')
    .replace(/"@repo\/shadcn-ui\/(?:components\/ui\/(?:button|button-group|tooltip|badge)|lib\/utils)"/g, '"./primitives"')
    .replace(/import \{ (?:cjk|code|math|mermaid) \} from "@streamdown\/[^\"]+";\n/g, "")
    .replace('import { Shimmer } from "./shimmer";', 'import { Shimmer } from "./primitives";')
    .replace('import { CodeBlock } from "./code-block";', 'import { CodeBlock } from "./primitives";');
  source = source.replace('"use client";\n', '"use client";\n\nimport React from "react";\n');
  if (name === "message" || name === "conversation") {
    source = source.replace('import type { UIMessage } from "ai";', 'import type { DesktopUIMessage as UIMessage } from "@coworkany/workbench-client";');
  }
  if (name === "tool") {
    source = source.replace('import type { DynamicToolUIPart, ToolUIPart } from "ai";', 'import type { DesktopUIMessagePart } from "@coworkany/workbench-client";\ntype DynamicToolUIPart = Extract<DesktopUIMessagePart, { type: "dynamic-tool" }>;\ntype ToolUIPart = Omit<DynamicToolUIPart, "type"> & { type: `tool-${string}` };\nexport type ToolState = DynamicToolUIPart["state"];');
  }
  if (name === "reasoning") {
    source = source.replace('const [isOpen, setIsOpen] = useControllableState<boolean>({', 'const [openState, setIsOpen] = useControllableState<boolean>({');
    source = source.replace('    const [duration, setDuration]', '    const isOpen = openState ?? false;\n    const [duration, setDuration]');
  }
  if (name === "message" || name === "reasoning") {
    // Streamdown supplies its installed default Markdown plugins, including GFM.
    source = source.replace('const streamdownPlugins = { cjk, code, math, mermaid };\n\n', "");
    source = source.replace('      plugins={streamdownPlugins}\n', "");
    source = source.replace('<Streamdown plugins={streamdownPlugins}>', '<Streamdown>');
  }
  return source;
}

export const sourceHash = (source) => createHash("sha256").update(source).digest("hex");

export function verifyAIElementsPorts(root = new URL("../packages/workbench-ui/src/ai-elements/", import.meta.url)) {
  const provenance = JSON.parse(readFileSync(new URL("official/provenance.json", root), "utf8"));
  if (provenance.commit !== AI_ELEMENTS_COMMIT) throw new Error("AI Elements commit drift");
  for (const name of AI_ELEMENTS_PORTS) {
    const original = readFileSync(new URL(`upstream/${name}.tsx.txt`, root), "utf8");
    const actual = readFileSync(new URL(`official/${name}.tsx`, root), "utf8");
    if (sourceHash(original) !== provenance.upstreamSha256[`${name}.tsx`]) throw new Error(`${name}: upstream hash mismatch`);
    if (actual !== adaptAIElementsSource(name, original)) throw new Error(`${name}: undocumented source adaptation`);
    if (sourceHash(actual) !== provenance.adaptedSha256[`${name}.tsx`]) throw new Error(`${name}: adapted hash mismatch`);
  }
  return provenance;
}
