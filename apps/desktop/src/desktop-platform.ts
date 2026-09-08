/** UI-only detection; runtime executable selection stays in the native host. */
export function desktopStylePlatform(userAgent: string, maxTouchPoints = 0): "macos" | "windows" | "other" {
  if (/Windows NT/i.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(userAgent) && !/iPhone|iPad|iPod/i.test(userAgent) && maxTouchPoints < 2) return "macos";
  return "other";
}
