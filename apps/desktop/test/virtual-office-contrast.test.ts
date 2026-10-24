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
  assert.match(css, /height:\s*clamp\(560px,\s*70vh,\s*760px\)/u);
  assert.match(css, /\.virtual-office-role-popover/u);
  assert.match(css, /--virtual-office-warm-surface:\s*color-mix/u);
  assert.match(css, /\.virtual-office-stage\s*\{[^}]*isolation:\s*isolate/u);
  assert.match(css, /\.virtual-office--standalone\s*\{[^}]*border:\s*0[^}]*border-radius:\s*0[^}]*padding:\s*0[^}]*background:\s*transparent/u);
  assert.match(css, /\.virtual-office-scene\s*\{[^}]*border:\s*1px/u);
  assert.match(css, /@media\s*\(max-width:\s*380px\)/u);
  assert.match(css, /\.virtual-office--standalone \.virtual-office-scene__canvas\s*\{[^}]*height:\s*100%[^}]*min-height:\s*100%/u);
  assert.doesNotMatch(css, /@media\s*\(min-width:\s*721px\)\s+and\s*\(max-width:\s*900px\)/u);
  assert.match(css, /env\(safe-area-inset-bottom\)/u);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/u);
});
