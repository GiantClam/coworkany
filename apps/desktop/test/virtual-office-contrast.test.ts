import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("office light-theme muted fallbacks keep small text at WCAG AA contrast", () => {
  const css = readFileSync(resolve(process.cwd(), "src/virtual-office/virtual-office.css"), "utf8");
  assert.match(css, /--virtual-office-muted, #5f5f58/u);
  assert.match(css, /\.virtual-office\s*\{[^}]*--virtual-office-muted:\s*color-mix/u);
  assert.doesNotMatch(css, /--wb-muted-foreground, #777/u);
  assert.match(css, /\.virtual-office--standalone/u);
  assert.match(css, /min-height:\s*clamp\(520px/u);
  assert.match(css, /\.virtual-office-role-popover/u);
});
