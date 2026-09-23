export type TextSplitSeparator = "blank_line" | "line" | "heading" | "custom" | "regex";

export function splitWorkflowText(raw: string, separator: TextSplitSeparator = "blank_line", delimiter = "", trim = true, pattern = "") {
  let segments: string[];
  if (separator === "line") segments = raw.split(/\r?\n/u);
  else if (separator === "heading") {
    const lines = raw.split(/\r?\n/u);
    segments = [];
    for (const line of lines) {
      if (/^\s*(?:#{1,6}\s+|\[[^\]\n]+\]\s*$)/u.test(line) && segments.length) segments.push("");
      if (!segments.length) segments.push(line);
      else segments[segments.length - 1] = `${segments[segments.length - 1]}\n${line}`;
    }
  } else if (separator === "custom" && delimiter) segments = raw.split(delimiter);
  else if (separator === "regex" && pattern) segments = raw.split(new RegExp(pattern, "u"));
  else segments = raw.split(/\r?\n\s*\r?\n/u);
  return segments.map((segment) => trim ? segment.trim() : segment).filter((segment) => segment.length > 0);
}
