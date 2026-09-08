import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { manageVersion, releaseVersion } from "./desktop-release-version.mjs";
import { collectReleaseAssets } from "./desktop-release-assets.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "coworkany-release-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("release tags require SemVer; prereleases remain prereleases", () => {
  assert.deepEqual(releaseVersion("v1.2.3-beta.1", true), { version: "1.2.3-beta.1", tag: "v1.2.3-beta.1", prerelease: true });
  assert.equal(releaseVersion("v1.2.3", true).prerelease, false);
  for (const tag of ["main", "1.2.3", "v1.2", "v01.2.3", "v1.2.3-01", "v1.2.3\nsha=bad", "v1.2.3/../../bad", "v1.2.3+build"]) assert.throws(() => releaseVersion(tag, true));
});

test("version update keeps JS, Tauri, Cargo and Cargo.lock aligned; check rejects drift", async t => {
  const directory = await fixture(t);
  await mkdir(join(directory, "apps/desktop/src-tauri"), { recursive: true });
  for (const path of ["package.json", "apps/desktop/package.json", "apps/desktop/src-tauri/tauri.conf.json"]) await writeFile(join(directory, path), '{"version":"0.1.2","retained":true}\n');
  await writeFile(join(directory, "apps/desktop/src-tauri/Cargo.toml"), '[package]\nname = "coworkany"\nversion = "0.1.2"\n[dependencies]\nserde = "1"\n');
  await writeFile(join(directory, "apps/desktop/src-tauri/Cargo.lock"), 'version = 4\n[[package]]\nname = "another"\nversion = "7.8.9"\n[[package]]\nname = "coworkany"\nversion = "0.1.2"\n');
  await assert.rejects(manageVersion(directory, "--check", "v0.1.3"), /release_version_mismatch/);
  await manageVersion(directory, "--set", "0.1.3");
  await manageVersion(directory, "--check", "v0.1.3");
  assert.equal(JSON.parse(await readFile(join(directory, "package.json"))).retained, true);
  assert.match(await readFile(join(directory, "apps/desktop/src-tauri/Cargo.lock"), "utf8"), /name = "another"\nversion = "7.8.9"/);
  await writeFile(join(directory, "apps/desktop/package.json"), '{"version":"0.1.4"}');
  await assert.rejects(manageVersion(directory, "--check", "v0.1.3"), /apps\/desktop\/package.json=0.1.4/);
});

const names = ["CoworkAny_0.1.3_x64-setup.exe", "CoworkAny-Windows-x64-normal.zip", "CoworkAny-Windows-x64-portable.zip", "CoworkAny-0.1.3-macOS-arm64.dmg", "CoworkAny-macOS-arm64-portable.zip"];
const commit = "a".repeat(40);

test("release assembly requires both platforms and hashes exact shipped bytes", async t => {
  const directory = await fixture(t);
  const input = join(directory, "input"), output = join(directory, "output");
  await mkdir(input);
  for (const name of names.slice(0, -1)) await writeFile(join(input, name), name);
  await assert.rejects(collectReleaseAssets(input, output, "v0.1.3", commit), /release_asset_expected_once/);
  await writeFile(join(input, names.at(-1)), names.at(-1));
  const manifest = await collectReleaseAssets(input, output, "v0.1.3", commit);
  assert.equal(manifest.assets.length, 5);
  assert.equal(manifest.commit, commit);
  for (const asset of manifest.assets) {
    assert.equal(asset.sha256, createHash("sha256").update(asset.name).digest("hex"));
    assert.equal(await readFile(join(output, asset.name), "utf8"), asset.name);
  }
  assert.equal((await readFile(join(output, "SHA256SUMS"), "utf8")).trim().split("\n").length, 5);
  await assert.rejects(collectReleaseAssets(input, output, "v0.1.3", commit), /release_output_must_be_empty/);
});

test("duplicate assets and non-commit refs cannot masquerade as a complete release", async t => {
  const directory = await fixture(t);
  await mkdir(join(directory, "input/duplicate"), { recursive: true });
  for (const name of names) await writeFile(join(directory, "input", name), "data");
  await writeFile(join(directory, "input/duplicate", names[0]), "stale");
  await assert.rejects(collectReleaseAssets(join(directory, "input"), join(directory, "output"), "v0.1.3", commit), /expected_once:.*:2/);
  await assert.rejects(collectReleaseAssets(join(directory, "input"), join(directory, "output"), "v0.1.3", "main"), /full_sha/);
});
