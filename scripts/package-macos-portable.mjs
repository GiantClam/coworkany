import { access, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = resolve(process.env.COWORKANY_MAC_APP_PATH ?? join(root, "apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/CoworkAny.app"));
const output = resolve(process.env.COWORKANY_MAC_PORTABLE_OUTPUT ?? join(root, ".artifacts/desktop-release"));
const internal = process.env.COWORKANY_MAC_PORTABLE_MODE === "internal";
const name = internal ? "CoworkAny-macOS-arm64-internal-portable" : "CoworkAny-macOS-arm64-portable";
const stage = join(output, name);
const archive = join(output, `${name}.zip`);

async function listPythonMachOFiles(rootPath) {
  const files = [];
  const visit = async path => {
    const details = await stat(path);
    if (details.isDirectory()) {
      for (const entry of await readdir(path)) await visit(join(path, entry));
      return;
    }
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (name === "Python" || name === "python3" || name === "python3.12" || path.endsWith(".dylib") || path.endsWith(".so")) files.push(path);
  };
  await visit(rootPath);
  return files;
}

async function validateBundledPython(appPath) {
  const python = join(appPath, "Contents/Resources/_up_/dist-runtime/runtime/python/python3");
  const innerPython = join(appPath, "Contents/Resources/_up_/dist-runtime/runtime/python/Resources/Python.app/Contents/MacOS/Python");
  await access(python, constants.X_OK).catch(() => { throw new Error(`macos_bundled_python_missing:${python}`); });
  await access(innerPython, constants.X_OK).catch(() => { throw new Error(`macos_bundled_python_inner_missing:${innerPython}`); });
  const [{ stdout: topLevelLinks }, { stdout: innerLinks }] = await Promise.all([
    promisify(execFile)("/usr/bin/otool", ["-L", python], { encoding: "utf8" }),
    promisify(execFile)("/usr/bin/otool", ["-L", innerPython], { encoding: "utf8" }),
  ]);
  const pythonRoot = dirname(python);
  const allFiles = await listPythonMachOFiles(pythonRoot);
  const allLinks = await Promise.all(allFiles.map(async file => (await promisify(execFile)("/usr/bin/otool", ["-L", file], { encoding: "utf8" })).stdout));
  if (topLevelLinks.includes("/Library/Frameworks/Python.framework/") || !topLevelLinks.includes("@loader_path/Python") || innerLinks.includes("/Library/Frameworks/Python.framework/") || allLinks.some(links => links.includes("/Library/Frameworks/Python.framework/"))) {
    throw new Error("macos_bundled_python_not_relocatable");
  }
  await promisify(execFile)(python, ["-c", "import os,sys,venv; assert os.path.realpath(sys.prefix) == os.path.realpath(os.environ['PYTHONHOME']); print(sys.version.split()[0])"], {
    timeout: 60_000,
    env: { ...process.env, PYTHONHOME: dirname(python), PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1" },
  });
}

if (process.platform !== "darwin") throw new Error(`macos_portable_package_requires_darwin:${process.platform}`);
await access(app, constants.F_OK).catch(() => { throw new Error(`macos_app_bundle_missing:${app}`); });
await rm(stage, { recursive: true, force: true });
await rm(archive, { force: true });
await mkdir(stage, { recursive: true });
// Preserve bundle symlinks and extended attributes, including notarization data
// when the release path has a signed app.
await promisify(execFile)("ditto", [app, join(stage, "CoworkAny.app")]);
const packagedApp = join(stage, "CoworkAny.app");
if (internal) await writeFile(join(packagedApp, "Contents", "Resources", "internal-portable.flag"), "", "utf8");
if (internal) await promisify(execFile)("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", packagedApp]);
await validateBundledPython(packagedApp);
if (!internal) await promisify(execFile)("codesign", ["--verify", "--deep", "--strict", packagedApp]);
await mkdir(join(stage, "CoworkAny Data"), { recursive: true });
await writeFile(join(stage, "portable.flag"), "", "utf8");
const instructions = internal
  ? "CoworkAny macOS 内测版（Apple Silicon）。本包仅使用 ad hoc 签名，未使用 Developer ID，未完成公证。\n\n首次打开如果 macOS 阻止应用：\n1. 在 Finder 中双击 CoworkAny.app；如果出现拦截提示，先点“好”。\n2. 打开“系统设置”→“隐私与安全性”→“安全性”。\n3. 点击 CoworkAny.app 旁边的“仍要打开”（Open Anyway），并确认。该按钮通常只在刚刚被拦截过一次后出现。\n4. 回到 Finder，对 CoworkAny.app 按住 Control 键点击或右键，选择“打开”。\n也可以首次直接使用 Control-click CoworkAny.app →“打开”。仅在确认 ZIP 来源可信时执行上述操作。\n\n请保持 CoworkAny.app、CoworkAny Data 和 portable.flag 位于同一目录；不要把 CoworkAny Data 放入 CoworkAny.app 内。\n"
  : "Keep CoworkAny.app, CoworkAny Data, and portable.flag together. Do not store CoworkAny Data inside CoworkAny.app.\n";
await writeFile(join(stage, "README.txt"), instructions, "utf8");
await promisify(execFile)("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", stage, archive]);
console.log(JSON.stringify({ status: "packaged", mode: internal ? "internal" : "release", archive, app, dataDirectory: "CoworkAny Data" }));
