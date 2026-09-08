import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = resolve(process.env.COWORKANY_MAC_APP_PATH ?? join(root, "apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/CoworkAny.app"));
const output = resolve(process.env.COWORKANY_MAC_PORTABLE_OUTPUT ?? join(root, ".artifacts/desktop-release"));
const name = "CoworkAny-macOS-arm64-portable";
const stage = join(output, name);
const archive = join(output, `${name}.zip`);

if (process.platform !== "darwin") throw new Error(`macos_portable_package_requires_darwin:${process.platform}`);
await access(app, constants.F_OK).catch(() => { throw new Error(`macos_app_bundle_missing:${app}`); });
await rm(stage, { recursive: true, force: true });
await rm(archive, { force: true });
await mkdir(stage, { recursive: true });
// Preserve signed bundle symlinks and extended attributes, including notarization data.
await promisify(execFile)("ditto", [app, join(stage, "CoworkAny.app")]);
await promisify(execFile)("codesign", ["--verify", "--deep", "--strict", join(stage, "CoworkAny.app")]);
await mkdir(join(stage, "CoworkAny Data"), { recursive: true });
await writeFile(join(stage, "portable.flag"), "", "utf8");
await writeFile(join(stage, "README.txt"), "Keep CoworkAny.app, CoworkAny Data, and portable.flag together. Do not store CoworkAny Data inside CoworkAny.app.\n", "utf8");
await promisify(execFile)("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", stage, archive]);
console.log(JSON.stringify({ status: "packaged", archive, app, dataDirectory: "CoworkAny Data" }));
