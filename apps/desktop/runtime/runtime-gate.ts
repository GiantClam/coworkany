/**
 * Development Tauri processes may use host-machine runtimes. Packaged macOS
 * builds keep the signed-bundle repair gate fail-closed.
 */
export function shouldRepairRuntime(probe: { readonly ready: boolean; readonly development?: boolean }) {
  return !probe.ready && probe.development !== true;
}
