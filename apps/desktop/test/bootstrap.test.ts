import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { embeddingDescriptorPath, fontsAssetPath, isRuntimeReady, MANDATORY_RUNTIME_COMPONENTS, type BootstrapManifest } from "../runtime/bootstrap";
import { desktopPlatform } from "../runtime/platform";
import { shouldRepairRuntime } from "../runtime/runtime-gate";

test("runtime readiness requires every mandatory component", () => {
  const base: BootstrapManifest = { schemaVersion: 1, source: "system", checkedAt: new Date(0).toISOString(), probes: [
    { component: "node", ok: true }, { component: "opencode", ok: true }, { component: "python", ok: true }, { component: "host", ok: true },
    { component: "knowledge", ok: true }, { component: "fonts", ok: true }, { component: "skills", ok: true }, { component: "lancedb", ok: true }, { component: "embedding", ok: true }, { component: "migrations", ok: true },
  ] };
  assert.equal(isRuntimeReady(base), true);
  assert.equal(isRuntimeReady({ ...base, probes: base.probes.map((probe) => probe.component === "embedding" ? { ...probe, ok: false } : probe) }), false);
  assert.equal(isRuntimeReady({ ...base, probes: base.probes.map((probe) => probe.component === "python" ? { ...probe, ok: false } : probe) }), false);
  assert.equal(isRuntimeReady({ ...base, probes: base.probes.map((probe) => probe.component === "host" ? { ...probe, ok: false } : probe) }), false);
  assert.equal(isRuntimeReady({ ...base, probes: base.probes.map((probe) => probe.component === "lancedb" ? { ...probe, ok: false } : probe) }), false);
  assert.equal(isRuntimeReady({ ...base, probes: base.probes.filter((probe) => probe.component !== "migrations") }), false);
});

test("each damaged runtime fixture blocks the repair gate until the repeated probe is healthy", () => {
  const base: BootstrapManifest = { schemaVersion: 1, source: "private", checkedAt: new Date(0).toISOString(), probes: MANDATORY_RUNTIME_COMPONENTS.map((component) => ({ component, ok: true })) };
  for (const component of MANDATORY_RUNTIME_COMPONENTS) {
    const damaged = { ...base, probes: base.probes.map((probe) => probe.component === component ? { ...probe, ok: false, detail: `fixture damaged: ${component}` } : probe) };
    assert.equal(isRuntimeReady(damaged), false, `${component} fixture must trigger repair`);
    assert.equal(isRuntimeReady(base), true, `${component} fixture must pass after the repaired probe`);
  }
});

test("runtime repair requires standard Python script semantics without generating a probe artifact", () => {
  const source = readFileSync(resolve(process.cwd(), "../../scripts/install-desktop-runtime.ps1"), "utf8");
  // Keep the PowerShell source ASCII-safe so legacy Windows PowerShell cannot
  // reinterpret the probe text before Python receives it.
  assert.match(source, /assert not sys\.flags\.isolated and not sys\.flags\.safe_path/u);
  assert.match(source, /import sys, struct, venv, ensurepip/u);
  assert.doesNotMatch(source, /Presentation\(|presentation\.save|run\.font\.name/u);
  assert.doesNotMatch(source, /ppt\/slides\/slide1\.xml|Microsoft YaHei/u);
});

test("runtime probes resolve the concrete font and embedding assets", () => {
  const fontAsset = desktopPlatform().fontAsset;
  assert.equal(fontsAssetPath("C:/CoworkAny/runtime/fonts"), join("C:/CoworkAny/runtime/fonts", fontAsset));
  assert.equal(fontsAssetPath(join("C:/CoworkAny/runtime/fonts", fontAsset)), join("C:/CoworkAny/runtime/fonts", fontAsset));
  assert.equal(embeddingDescriptorPath("C:/CoworkAny/runtime/embedding"), join("C:/CoworkAny/runtime/embedding", "local-hash-384-v1.json"));
  assert.equal(embeddingDescriptorPath("C:/CoworkAny/runtime/embedding/custom.json"), "C:/CoworkAny/runtime/embedding/custom.json");
});

test("browser preview opens the desktop shell without a Tauri bootstrap", () => {
  const source = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

  assert.match(source, /if \(!isTauriBridgeAvailable\(\)\) \{[\s\S]*setRuntimeStatus\(locale === "zh" \? "浏览器预览模式 · Tauri 未连接"/);
  assert.match(source, /setRuntimeReady\(true\);[\s\S]*setShellReady\(true\);[\s\S]*return;/);
});

test("development runtime does not enter the signed macOS repair gate", () => {
  assert.equal(shouldRepairRuntime({ ready: false, development: true }), false);
  assert.equal(shouldRepairRuntime({ ready: false, development: false }), true);
  assert.equal(shouldRepairRuntime({ ready: true, development: false }), false);
});
