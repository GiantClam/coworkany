import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { delimiter } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { missingMacOSRuntimeInputs, resolveMacOSRuntimeInputs } from "./resolve-macos-runtime-inputs.mjs";

async function executable(path) {
  await writeFile(path, "binary");
  await chmod(path, 0o755);
}

test("auto-discovers developer runtimes when explicit inputs are absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-runtime-inputs-"));
  const nodeRoot = join(root, "node-v22", "bin");
  const pythonRoot = join(root, "python", "bin");
  const opencodeRoot = join(root, "home", ".opencode", "bin");
  const mediaRoot = join(root, "media");
  const fontRoot = join(root, "home", "Library", "Fonts");
  await Promise.all([nodeRoot, pythonRoot, opencodeRoot, mediaRoot, fontRoot].map(path => mkdir(path, { recursive: true })));
  await executable(join(nodeRoot, "node"));
  await executable(join(pythonRoot, "python3"));
  await executable(join(opencodeRoot, "opencode"));
  await executable(join(mediaRoot, "ffmpeg"));
  await executable(join(mediaRoot, "ffprobe"));
  await writeFile(join(fontRoot, "NotoSansCJKsc-Regular.otf"), "font");

  const source = await resolveMacOSRuntimeInputs({
    env: { PATH: [mediaRoot, join(root, "python", "bin")].join(delimiter) },
    platform: "darwin",
    architecture: "arm64",
    execPath: join(nodeRoot, "node"),
    homeDirectory: join(root, "home"),
  });

  assert.equal(source.node.endsWith("/node-v22"), true);
  assert.equal(source.python.endsWith("/python"), true);
  assert.equal(source.opencode, join(root, "home", ".opencode"));
  assert.equal(source.ffmpeg.endsWith("/media/ffmpeg"), true);
  assert.equal(source.ffprobe.endsWith("/media/ffprobe"), true);
  assert.equal(source.font.endsWith("/Library/Fonts/NotoSansCJKsc-Regular.otf"), true);
  assert.deepEqual(missingMacOSRuntimeInputs(source), []);
});

test("explicit runtime inputs take precedence over automatic discovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-runtime-inputs-"));
  const explicitNode = join(root, "explicit-node");
  const automaticNode = join(root, "automatic-node", "bin");
  await mkdir(explicitNode, { recursive: true });
  await mkdir(automaticNode, { recursive: true });
  await executable(join(explicitNode, "node"));
  await executable(join(automaticNode, "node"));

  const source = await resolveMacOSRuntimeInputs({
    env: { COWORKANY_MAC_NODE_RUNTIME_DIR: explicitNode, PATH: "" },
    platform: "darwin",
    architecture: "arm64",
    execPath: join(automaticNode, "node"),
    homeDirectory: root,
  });

  assert.equal(source.node, explicitNode);
});

test("reports all missing inputs with their environment variable names", () => {
  assert.deepEqual(missingMacOSRuntimeInputs({}), [
    "node=COWORKANY_MAC_NODE_RUNTIME_DIR",
    "opencode=COWORKANY_MAC_OPENCODE_RUNTIME_DIR",
    "python=COWORKANY_MAC_PYTHON_RUNTIME_DIR",
    "font=COWORKANY_MAC_FONT_PATH",
    "ffmpeg=COWORKANY_MAC_STATIC_FFMPEG_PATH or COWORKANY_MAC_FFMPEG_PATH",
    "ffprobe=COWORKANY_MAC_STATIC_FFPROBE_PATH or COWORKANY_MAC_FFPROBE_PATH",
  ]);
});
