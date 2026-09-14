/**
 * Development Tauri processes may use host-machine runtimes. Packaged macOS
 * builds keep the signed-bundle repair gate fail-closed.
 */
export function shouldRepairRuntime(probe: { readonly ready: boolean; readonly development?: boolean }) {
  return !probe.ready && probe.development !== true;
}

/**
 * Image generation is a direct workflow-host operation. It does not need the
 * optional Python/media-index stack that is used by PPT/video/knowledge
 * features, so a delayed optional component must not block this capability.
 */
export function canRunImageWorkflow(probe: {
  readonly ready: boolean;
  readonly node?: boolean;
  readonly host?: boolean;
  readonly migrations?: boolean;
}) {
  return probe.ready || (probe.node === true && probe.host === true && probe.migrations === true);
}
