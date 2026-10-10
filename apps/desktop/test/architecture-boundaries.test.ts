import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { readdirSync } from "node:fs";

const desktopRoot = join(process.cwd());
const sourceRoots = [join(desktopRoot, "src"), join(desktopRoot, "runtime")];
const forbiddenPatterns: readonly [RegExp, string][] = [
  [/from\s+["']next\//u, "Next route/API import"],
  [/["']@\/lib\/(?:auth|billing|enterprise|r2|railway|cloudflare|dify|ragflow)/iu, "SaaS infrastructure import"],
  [/ai-sdk-native/iu, "ai-sdk-native text runtime"],
  [/chat\/completions/iu, "direct chat completions endpoint"],
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|mjs)$/u.test(entry.name) ? [path] : [];
  });
}

test("desktop workbench source stays host-mediated and SaaS-free", () => {
  const violations: string[] = [];
  for (const root of sourceRoots) {
    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, "utf8");
      for (const [pattern, label] of forbiddenPatterns) {
        if (pattern.test(source)) violations.push(`${label}: ${relative(desktopRoot, file)}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("ordinary chat remains on the OpenCode session path", () => {
  const app = readFileSync(join(desktopRoot, "src", "App.tsx"), "utf8");
  const host = readFileSync(join(desktopRoot, "runtime", "host.ts"), "utf8");
  assert.match(app, /type:\s*["']session\.create["']/u);
  assert.match(app, /type:\s*["']session\.prompt["']/u);
  assert.match(host, /command\.type === ["']session\.prompt["']/u);
  assert.match(host, /runOpenCode\(\{ \.\.\.command, runId \}, session, \{ signal: controller\.signal \}\)/u);
});

test("workflow persistence and artifact evidence use the typed desktop service seam", () => {
  const host = readFileSync(join(desktopRoot, "runtime", "host.ts"), "utf8");
  const rustHost = readFileSync(join(desktopRoot, "src-tauri", "src", "host.rs"), "utf8");
  const ports = readFileSync(join(desktopRoot, "runtime", "workflow-ports.ts"), "utf8");
  assert.match(host, /requestService: \(method, payload\) => requestService\(method, payload, controller\.signal\)/u);
  assert.match(ports, /workflow\.repository\.create/u);
  assert.match(ports, /workflow\.repository\.update_status/u);
  assert.match(ports, /workflow\.artifact\.register/u);
  assert.match(ports, /workflow\.event\.append/u);
  assert.match(host, /runtime\.artifact\.write/u);
  assert.match(rustHost, /runtime_artifact_workspace_mismatch/u);
  assert.match(rustHost, /runtime_artifact_content_too_large/u);
  assert.match(rustHost, /std::fs::rename/u);
  assert.doesNotMatch(host, /from ["']\.\/storage["']/u);
  assert.doesNotMatch(host, /from ["']\.\/artifacts["']/u);
});

test("virtual office stays behind the desktop home and injected reader seam", () => {
  const app = readFileSync(join(desktopRoot, "src", "App.tsx"), "utf8");
  const home = readFileSync(join(desktopRoot, "src", "home", "DesktopHome.tsx"), "utf8");
  const composition = readFileSync(join(desktopRoot, "src", "virtual-office", "office-composition.ts"), "utf8");
  assert.match(app, /createAgentDirectoryReader/u);
  assert.match(app, /agentDirectoryReader/u);
  assert.match(app, /<DesktopHome/u);
  assert.doesNotMatch(app, /from ["']pixi\.js["']/u);
  assert.match(home, /VirtualOfficeHome/u);
  assert.match(composition, /agentDirectoryReader/u);
  assert.match(composition, /createRoleRunAdapter/u);
  assert.match(composition, /enabledOfficeRoles/u);
  assert.match(composition, /createAgentDirectoryHealthSource/u);
});

test("Pixi scene stays renderer-only", () => {
  const scene = readFileSync(join(desktopRoot, "src", "virtual-office", "office-scene.ts"), "utf8");
  assert.doesNotMatch(scene, /WorkbenchClient|tauriBridge|storage|navigation\.ts/u);
  assert.match(scene, /OfficeSnapshot/u);
  assert.match(scene, /onActivate/u);
});
