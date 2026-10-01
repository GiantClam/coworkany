import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { isWorkbenchSessionPath, workbenchSessionScope, WORKBENCH_ROUTE_MANIFEST } from "@coworkany/workbench-ui";
import { resolveDesktopRunAction } from "../src/route-actions";

type EntryContract = {
  readonly surface: "home" | "conversation" | "media" | "workflow" | "library" | "settings";
  readonly sessionScope?: string;
};

/**
 * Release-facing entry inventory. Keeping this keyed by the shared manifest
 * makes an added route fail this test until its desktop surface is classified.
 */
const ENTRY_CONTRACTS: Readonly<Record<string, EntryContract>> = {
  "/dashboard": { surface: "home" },
  "/dashboard/ai": { surface: "conversation" },
  "/dashboard/ai?entry=consulting-advisor": { surface: "conversation", sessionScope: "entry:consulting-advisor" },
  "/dashboard/ai?agent=executive-brand&entry=consulting-advisor": { surface: "conversation", sessionScope: "executive-brand" },
  "/dashboard/ai?agent=executive-growth&entry=consulting-advisor": { surface: "conversation", sessionScope: "executive-growth" },
  "/dashboard/ai?agent=executive-ppt": { surface: "conversation", sessionScope: "executive-ppt" },
  "/dashboard/ai?agent=executive-presentation-ppt": { surface: "conversation", sessionScope: "executive-presentation-ppt" },
  "/dashboard/writer": { surface: "conversation", sessionScope: "entry:writer" },
  "/dashboard/image-assistant": { surface: "media", sessionScope: "entry:image-assistant" },
  "/dashboard/capabilities": { surface: "media" },
  "/dashboard/agent-platform": { surface: "library" },
  "/dashboard/workflows": { surface: "workflow" },
  "/dashboard/tasks": { surface: "library" },
  "/dashboard/usage": { surface: "library" },
  "/dashboard/assets": { surface: "library" },
  "/dashboard/knowledge-base": { surface: "library" },
  "/dashboard/video": { surface: "media" },
  "/dashboard/settings": { surface: "settings" },
};

test("every desktop function entry has a release regression contract", () => {
  const manifestPaths = WORKBENCH_ROUTE_MANIFEST.map((route) => route.path).sort();
  const coveredPaths = Object.keys(ENTRY_CONTRACTS).sort();
  assert.deepEqual(coveredPaths, manifestPaths);

  for (const route of WORKBENCH_ROUTE_MANIFEST) {
    const contract = ENTRY_CONTRACTS[route.path];
    assert.ok(contract, `missing release regression contract for ${route.path}`);
    if (contract.sessionScope) {
      assert.equal(isWorkbenchSessionPath(route.path), true, `${route.path} must remain a session entry`);
      assert.equal(workbenchSessionScope(route.path), contract.sessionScope, `${route.path} must preserve its session scope`);
    }
  }
});

test("desktop route selection keeps every contracted surface mounted", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const expectedSurfaceMarkers: Record<EntryContract["surface"], string[]> = {
    home: ["const isHomeRoute = selected.path === \"/dashboard\"", "<HomeEntryGroups"],
    conversation: ["selected.mode === \"chat\" || selected.mode === \"writer\"", "<DesktopConversationWorkspace"],
    media: ["selected.path === \"/dashboard/image-assistant\" || selected.path === \"/dashboard/video\" || selected.path === \"/dashboard/capabilities\"", "<DesktopMediaWorkspace"],
    workflow: ["selected.path === \"/dashboard/workflows\"", "<DesktopWorkflowWorkspace", "<WorkbenchWorkflowDirectory"],
    library: ["<DesktopLibraryWorkspace"],
    settings: ["selected.path === \"/dashboard/settings\"", "<DesktopSettingsPanel"],
  };

  for (const contract of Object.values(ENTRY_CONTRACTS)) {
    for (const marker of expectedSurfaceMarkers[contract.surface]) assert.ok(appSource.includes(marker), `missing ${contract.surface} desktop surface marker: ${marker}`);
  }
});

test("agent, writing, and media entries retain their execution capability", () => {
  assert.equal(resolveDesktopRunAction("/dashboard/ai", null, "image_generate"), "llm_generate");
  assert.equal(resolveDesktopRunAction("/dashboard/ai?agent=executive-ppt", "ppt_generate", "llm_generate"), "ppt_generate");
  assert.equal(resolveDesktopRunAction("/dashboard/ai?agent=executive-presentation-ppt", "ppt_generate", "llm_generate"), "ppt_generate");
  assert.equal(resolveDesktopRunAction("/dashboard/writer", "writer", "llm_generate"), "writer");
  assert.equal(resolveDesktopRunAction("/dashboard/image-assistant", "image_generate", "llm_generate"), "image_generate");
  assert.equal(resolveDesktopRunAction("/dashboard/video", "video_generate", "music_generate"), "music_generate");
  assert.equal(resolveDesktopRunAction("/dashboard/workflows", "agent_execute", "llm_generate"), "agent_execute");
});
