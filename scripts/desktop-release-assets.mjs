import { readdir, mkdir, copyFile, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseVersion } from "./desktop-release-version.mjs";

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : entry.isFile() ? [join(directory, entry.name)] : []))).flat();
}

export async function collectReleaseAssets(input, output, tag, commit, macosMode = "release") {
  const { version, prerelease } = releaseVersion(tag, true);
  if (!/^[a-f0-9]{40}$/.test(commit ?? "")) throw new Error("release_commit_requires_full_sha");
  if (!["release", "internal"].includes(macosMode)) throw new Error(`release_macos_mode_invalid:${macosMode}`);
  const required = [
    `CoworkAny_${version}_x64-setup.exe`,
    "CoworkAny-Windows-x64-normal.zip",
    "CoworkAny-Windows-x64-portable.zip",
    ...(macosMode === "internal" ? ["CoworkAny-macOS-arm64-internal-portable.zip"] : [`CoworkAny-${version}-macOS-arm64.dmg`, "CoworkAny-macOS-arm64-portable.zip"]),
  ];
  const files = await walk(input);
  const selected = required.map(name => {
    const matches = files.filter(path => path.replaceAll("\\", "/").split("/").at(-1) === name);
    if (matches.length !== 1) throw new Error(`release_asset_expected_once:${name}:${matches.length}`);
    return { name, path: matches[0] };
  });
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error("release_output_must_be_empty");
  const assets = [];
  for (const { name, path } of selected) {
    const bytes = (await stat(path)).size;
    if (bytes === 0 || bytes >= 2 * 1024 ** 3) throw new Error(`release_asset_size_invalid:${name}`);
    const target = join(output, name);
    await copyFile(path, target);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(target)) hash.update(chunk);
    assets.push({ name, bytes, sha256: hash.digest("hex") });
  }
  const manifest = { schemaVersion: 1, version, tag, commit, prerelease, macosMode, assets };
  await writeFile(join(output, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(output, "SHA256SUMS"), assets.map(asset => `${asset.sha256}  ${asset.name}\n`).join(""));
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output, tag, commit] = process.argv.slice(2);
  if (!input || !output) throw new Error("usage: desktop-release-assets.mjs INPUT OUTPUT TAG COMMIT");
  console.log(JSON.stringify(await collectReleaseAssets(resolve(input), resolve(output), tag, commit, process.argv[6] ?? "release")));
}
