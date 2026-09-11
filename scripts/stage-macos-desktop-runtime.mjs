import { access, chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const output = resolve(process.env.COWORKANY_MAC_RUNTIME_OUTPUT ?? join(root, "apps/desktop/dist-runtime/runtime"));
const source = {
  node: process.env.COWORKANY_MAC_NODE_RUNTIME_DIR,
  opencode: process.env.COWORKANY_MAC_OPENCODE_RUNTIME_DIR,
  python: process.env.COWORKANY_MAC_PYTHON_RUNTIME_DIR,
  font: process.env.COWORKANY_MAC_FONT_PATH,
};

async function removeOutput(path) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function requiredPath(name, value) {
  if (!value) throw new Error(`macos_runtime_${name}_path_required`);
  const path = resolve(value);
  await access(path, constants.F_OK).catch(() => { throw new Error(`macos_runtime_${name}_missing:${path}`); });
  return path;
}

async function copyRuntimeDirectory(name, destination, executable) {
  const path = await requiredPath(name, source[name]);
  const details = await stat(path);
  if (!details.isDirectory()) throw new Error(`macos_runtime_${name}_directory_required:${path}`);
  await cp(path, destination, { recursive: true, dereference: true });
  await access(join(destination, executable), constants.X_OK).catch(() => { throw new Error(`macos_runtime_${name}_executable_missing:${join(destination, executable)}`); });
}

async function repairTopLevelPythonEntrypoint() {
  const pythonRoot = join(output, "python");
  const topLevel = join(pythonRoot, "python3");
  const innerApp = join(pythonRoot, "Resources/Python.app");
  const innerExecutable = join(innerApp, "Contents/MacOS/Python");
  const topLevelLinks = await execFileAsync("/usr/bin/otool", ["-L", topLevel], { encoding: "utf8" });
  const topLevelDependencies = new Set(topLevelLinks.stdout.split("\n").map(line => line.trim().split(" (", 1)[0]));
  if (topLevelDependencies.has("@loader_path/../Python")) {
    await execFileAsync("/usr/bin/install_name_tool", ["-change", "@loader_path/../Python", "@loader_path/Python", topLevel]);
    await execFileAsync("/usr/bin/codesign", ["--force", "--sign", "-", topLevel]);
  }
  const innerLinks = await execFileAsync("/usr/bin/otool", ["-L", innerExecutable], { encoding: "utf8" });
  const absoluteFramework = "/Library/Frameworks/Python.framework/Versions/3.12/Python";
  if (innerLinks.stdout.includes(absoluteFramework)) {
    // The nested Python.app is signed by Python.org. install_name_tool
    // invalidates that signature, so sign the nested app explicitly before
    // signing the containing runtime directory.
    await execFileAsync("/usr/bin/install_name_tool", ["-change", absoluteFramework, "@loader_path/../../../../Python", innerExecutable]);
    await execFileAsync("/usr/bin/codesign", ["--force", "--sign", "-", innerApp]);
  }
}

async function makeWritableTree(path) {
  const details = await stat(path);
  await chmod(path, details.mode | (details.isDirectory() ? 0o700 : 0o600));
  if (!details.isDirectory()) return;
  for (const entry of await readdir(path)) await makeWritableTree(join(path, entry));
}

async function resolvePackage(name) {
  const desktopModules = join(root, "apps/desktop/node_modules");
  let entry;
  try {
    // Some packages intentionally hide package.json through `exports`; resolve
    // their public entrypoint and walk back to the package root instead.
    entry = require.resolve(name, { paths: [desktopModules] });
  } catch {
    // pnpm can keep an optional native package in its virtual store without
    // linking it on a prior install performed for another platform.
    const store = join(root, "node_modules/.pnpm");
    const encoded = name.replace("/", "+");
    const entries = await readdir(store).catch(() => []);
    for (const entry of entries.filter(item => item.startsWith(`${encoded}@`)).sort().reverse()) {
      const candidate = join(store, entry, "node_modules", ...name.split("/"));
      try {
        await access(join(candidate, "package.json"), constants.F_OK);
        return candidate;
      } catch { /* keep searching other pnpm versions */ }
    }
    throw new Error(`macos_runtime_package_missing:${name}; run pnpm install on an Apple Silicon Mac`);
  }
  let directory = dirname(entry);
  while (directory !== dirname(directory)) {
    try {
      await access(join(directory, "package.json"), constants.F_OK);
      return directory;
    } catch {
      directory = dirname(directory);
    }
  }
  throw new Error(`macos_runtime_package_manifest_missing:${name}`);
}

async function copyLanceDb() {
  const destination = join(output, "lancedb");
  const queue = [
    { name: "@lancedb/lancedb", path: await resolvePackage("@lancedb/lancedb") },
    { name: "@lancedb/lancedb-darwin-arm64", path: await resolvePackage("@lancedb/lancedb-darwin-arm64") },
  ];
  const seen = new Set();
  while (queue.length) {
    const item = queue.shift();
    if (!item || seen.has(item.name)) continue;
    seen.add(item.name);
    const manifest = JSON.parse(await readFile(join(item.path, "package.json"), "utf8"));
    const target = join(destination, "node_modules", ...item.name.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await cp(item.path, target, {
      recursive: true,
      dereference: true,
      filter: path => {
        const itemRelative = relative(item.path, path).replaceAll("\\\\", "/");
        return itemRelative !== "node_modules" && !itemRelative.startsWith("node_modules/");
      },
    });
    const dependencies = { ...(manifest.dependencies ?? {}) };
    if (item.name === "@lancedb/lancedb") dependencies["apache-arrow"] = manifest.peerDependencies?.["apache-arrow"] ?? "*";
    for (const dependency of Object.keys(dependencies)) {
      if (!seen.has(dependency)) queue.push({ name: dependency, path: await resolvePackage(dependency) });
    }
  }
  return [...seen].sort();
}

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error(`macos_runtime_stage_requires_darwin_arm64:${process.platform}-${process.arch}`);
}

await removeOutput(output);
await mkdir(output, { recursive: true });
await copyRuntimeDirectory("node", join(output, "node"), "node");
await copyRuntimeDirectory("opencode", join(output, "opencode"), "opencode");
await copyRuntimeDirectory("python", join(output, "python"), "python3");
await repairTopLevelPythonEntrypoint();
const font = await requiredPath("font", source.font);
await mkdir(join(output, "fonts"), { recursive: true });
await cp(font, join(output, "fonts/NotoSansCJKsc-Regular.otf"), { dereference: true });
const lancedbPackages = await copyLanceDb();
await mkdir(join(output, "embedding"), { recursive: true });
await writeFile(join(output, "embedding/local-hash-384-v1.json"), `${JSON.stringify({ schemaVersion: 1, id: "local-hash-384-v1", type: "builtin-feature-hash", dimension: 384, network: false })}\n`);
if (process.env.COWORKANY_MAC_RUNTIME_LICENSES_PATH) {
  await cp(await requiredPath("licenses", process.env.COWORKANY_MAC_RUNTIME_LICENSES_PATH), join(output, "LICENSES.txt"));
}
// Tauri strips quarantine/provenance attributes while assembling the app. Some
// Python framework files are read-only in the source archive, which makes that
// cleanup fail with EPERM on macOS. Normalize owner write bits before bundling.
await makeWritableTree(output);

const manifest = {
  schemaVersion: 1,
  manifestId: "coworkany-runtime-macos-arm64-v1",
  platform: "macos",
  architecture: "arm64",
  compatibility: { architecture: "arm64", macos: ["12+"] },
  runtime: {
    node: "runtime/node/node",
    opencode: "runtime/opencode/opencode",
    python: "runtime/python/python3",
    font: "runtime/fonts/NotoSansCJKsc-Regular.otf",
    lancedb: "runtime/lancedb/node_modules/@lancedb/lancedb/dist/index.js",
    embedding: "runtime/embedding/local-hash-384-v1.json",
  },
  distribution: "bundled-signed-only",
};
await writeFile(join(output, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const files = await Promise.all(["node/node", "opencode/opencode", "python/python3", "fonts/NotoSansCJKsc-Regular.otf"].map(async relativePath => ({ relativePath, bytes: (await stat(join(output, relativePath))).size })));
console.log(JSON.stringify({ status: "staged", target: "macos-arm64", output, files, lancedbPackages }));
