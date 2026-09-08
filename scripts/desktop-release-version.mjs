import { readFile, writeFile, appendFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;
const manifests = ["package.json", "apps/desktop/package.json", "apps/desktop/src-tauri/tauri.conf.json"];
const cargoPackage = /(\[package\][\s\S]*?\nversion = ")([^"]+)(")/;
const cargoLock = /(\[\[package\]\]\nname = "coworkany"\nversion = ")([^"]+)(")/;

export function releaseVersion(value, tagged = false) {
  if (tagged && !value?.startsWith("v")) throw new Error("release_tag_requires_v_prefix");
  const version = tagged ? value.slice(1) : value;
  if (!versionPattern.test(version ?? "")) throw new Error("release_version_requires_semver");
  return { version, tag: `v${version}`, prerelease: version.includes("-") };
}

export async function manageVersion(directory, mode, value) {
  if (!["--check", "--set"].includes(mode)) throw new Error("usage: desktop-release-version.mjs --check vX.Y.Z | --set X.Y.Z");
  const metadata = releaseVersion(value, mode === "--check");
  const files = await Promise.all(manifests.map(async path => {
    const content = await readFile(resolve(directory, path), "utf8");
    const json = JSON.parse(content);
    return { path, version: json.version, updated: `${JSON.stringify({ ...json, version: metadata.version }, null, 2)}\n` };
  }));
  for (const [path, pattern] of [["apps/desktop/src-tauri/Cargo.toml", cargoPackage], ["apps/desktop/src-tauri/Cargo.lock", cargoLock]]) {
    const content = await readFile(resolve(directory, path), "utf8");
    const match = content.match(pattern);
    if (!match) throw new Error(`release_version_field_missing:${path}`);
    files.push({ path, version: match[2], updated: content.replace(pattern, (_, prefix, old, suffix) => `${prefix}${metadata.version}${suffix}`) });
  }
  if (mode === "--check") {
    const mismatches = files.filter(file => file.version !== metadata.version);
    if (mismatches.length) throw new Error(`release_version_mismatch:${mismatches.map(file => `${file.path}=${file.version}`).join(",")}; expected ${metadata.version}`);
  } else {
    for (const file of files) await writeFile(resolve(directory, file.path), file.updated);
  }
  return metadata;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const metadata = await manageVersion(root, process.argv[2], process.argv[3]);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, Object.entries(metadata).map(([key, value]) => `${key}=${value}\n`).join(""));
  console.log(JSON.stringify(metadata));
}
