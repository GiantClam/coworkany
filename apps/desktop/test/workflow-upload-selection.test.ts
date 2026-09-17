import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("workflow local-file pickers and persistence accept one file", () => {
  const source = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

  assert.match(source, /paths\.into_iter\(\)\.take\(1\)/);
  assert.match(source, /\$dialog\.Multiselect = \$false/);
  assert.match(source, /choose file with prompt "Choose workflow file"/);
  assert.doesNotMatch(source, /multiple selections allowed/);
});
