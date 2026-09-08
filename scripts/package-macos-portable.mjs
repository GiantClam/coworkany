import { access, mkdir, rm, writeFile } from "node:fs/promises";
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

if (process.platform !== "darwin") throw new Error(`macos_portable_package_requires_darwin:${process.platform}`);
await access(app, constants.F_OK).catch(() => { throw new Error(`macos_app_bundle_missing:${app}`); });
await rm(stage, { recursive: true, force: true });
await rm(archive, { force: true });
await mkdir(stage, { recursive: true });
// Preserve bundle symlinks and extended attributes, including notarization data
// when the release path has a signed app.
await promisify(execFile)("ditto", [app, join(stage, "CoworkAny.app")]);
if (!internal) await promisify(execFile)("codesign", ["--verify", "--deep", "--strict", join(stage, "CoworkAny.app")]);
await mkdir(join(stage, "CoworkAny Data"), { recursive: true });
await writeFile(join(stage, "portable.flag"), "", "utf8");
const instructions = internal
  ? "INTERNAL TEST BUILD - NOT SIGNED OR NOTARIZED. Keep CoworkAny.app, CoworkAny Data, and portable.flag together. On another Mac, first launch may require Control-click CoworkAny.app > Open, or Privacy & Security > Open Anyway. Do not store CoworkAny Data inside CoworkAny.app.\n"
  : "Keep CoworkAny.app, CoworkAny Data, and portable.flag together. Do not store CoworkAny Data inside CoworkAny.app.\n";
await writeFile(join(stage, "README.txt"), instructions, "utf8");
await promisify(execFile)("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", stage, archive]);
console.log(JSON.stringify({ status: "packaged", mode: internal ? "internal" : "release", archive, app, dataDirectory: "CoworkAny Data" }));
