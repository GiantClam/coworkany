export function resolveDesktopRunModel(reportedModel?: string | null, trackedModel?: string | null, fallbackModel?: string | null) {
  const reported = reportedModel?.trim();
  if (reported) return reported;
  const tracked = trackedModel?.trim();
  if (tracked === "unknown") return "unknown";
  return tracked || fallbackModel?.trim() || "unknown";
}
