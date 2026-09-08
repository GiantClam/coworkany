import test from "node:test";
import assert from "node:assert/strict";
import { desktopStylePlatform } from "../src/desktop-platform";

test("macOS WebKit and Chromium use desktop styles while Windows keeps its baseline", () => {
  assert.equal(desktopStylePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 0), "macos");
  assert.equal(desktopStylePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0", 0), "macos");
  assert.equal(desktopStylePlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", 0), "windows");
  assert.equal(desktopStylePlatform("Mozilla/5.0 (X11; Linux x86_64)", 0), "other");
});

test("iOS including iPad desktop browsing does not enable macOS layout", () => {
  assert.equal(desktopStylePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5), "other");
  assert.equal(desktopStylePlatform("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", 5), "other");
  assert.equal(desktopStylePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5), "other");
});
