import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const script = join(dirname(fileURLToPath(import.meta.url)), "bundle-desktop-skills.mjs");
const pptCommit = "d3d81fe3cf4cc642de225159586308bbe98eeb4d";
const dashiCommit = "7cb23347f91cda1a5519eafc8c040704e389535a";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function digestTree(root) {
  const hash = createHash("sha256");
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        hash.update(`${JSON.stringify([relativePath, "directory"])}\n`);
        await visit(path, relativePath);
      } else if (entry.isFile()) {
        hash.update(`${JSON.stringify([relativePath, "file", sha256(await readFile(path))])}\n`);
      }
    }
  }
  await visit(root);
  return hash.digest("hex");
}

async function put(root, path, content) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

test("offline bundle fingerprints complete skill trees and retains exact upstream bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-bundle-"));
  const ppt = `.artifacts/ppt-master-acquire-${pptCommit}/skills/ppt-master`;
  const dashi = `.artifacts/dashi-ppt-acquire-${dashiCommit}/skills/dashi-ppt`;
  const output = join(root, "apps/desktop/dist-runtime");
  const upstream = Buffer.from("---\nname: ppt-master\n---\n# 上游原文\r\n", "utf8");
  try {
    await mkdir(join(root, "scripts"));
    await copyFile(script, join(root, "scripts/bundle-desktop-skills.mjs"));
    await put(root, "content/skills/canonical/SKILL.md", "canonical\n");
    await put(root, "content/skills/canonical/tools/tool.py", "print('old')\n");
    await put(root, "content/skills/agency-agents/design/agent.md", "agent original\n");
    await put(root, ".artifacts/shared-skill-catalog.json", JSON.stringify({ schemaVersion: 1, skills: [{ id: "canonical", relativePath: "canonical/SKILL.md", digest: sha256("canonical\n") }] }));
    await put(root, `${ppt}/SKILL.md`, upstream);
    await put(root, `${ppt}/tools/工具.py`, "print('original')\n");
    await put(root, `${ppt}/templates/slide.bin`, Buffer.from([0, 255, 13, 10]));
    await put(root, `${ppt}/.hidden`, "hidden");
    await put(root, `${dashi}/SKILL.md`, "dashi original\n");
    await put(root, `${dashi}/tools/tool.py`, "dashi tool\n");
    await put(root, "scripts/desktop-skills.lock.json", `${JSON.stringify({
      schemaVersion: 1,
      directoryDigestAlgorithm: "sha256-tree-v1",
      resolution: "latest-on-build",
      skills: [
        { id: "ppt-master", repo: "hugohe3/ppt-master", version: "6.3.0", commit: pptCommit, branch: "v6.3.0", skillPath: "skills/ppt-master", stagingName: "ppt-master-acquire", directoryDigest: await digestTree(join(root, ppt)) },
        { id: "dashi-ppt", repo: "chuspeeism/dashi-ppt-skill", version: "0.4.11", commit: dashiCommit, branch: "main", skillPath: "skills/dashi-ppt", stagingName: "dashi-ppt-acquire", directoryDigest: await digestTree(join(root, dashi)) },
      ],
    }, null, 2)}\n`);
    await put(root, "apps/desktop/dist-runtime/skills/ppt-master/obsolete-patch.py", "stale");
    await put(root, "apps/desktop/dist-runtime/skills/canonical/obsolete.txt", "stale");
    const bundle = () => run(process.execPath, [join(root, "scripts/bundle-desktop-skills.mjs"), "--offline"], {
      windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024,
      // Git cannot be found even if a future regression accidentally requests a clone.
      env: { ...process.env, PATH: "", Path: "" },
    });
    const manifest = async (name = "ppt-master") => JSON.parse(await readFile(join(output, `skills/${name}.manifest.json`), "utf8"));
    const catalog = async () => JSON.parse(await readFile(join(output, "skill-catalog.json"), "utf8"));
    await bundle();
    const first = await manifest();
    assert.equal(first.version, "6.3.0");
    assert.equal(first.commit, pptCommit);
    assert.equal(first.digest, sha256(upstream));
    assert.equal(first.directoryDigestAlgorithm, "sha256-tree-v1");
    assert.match(first.directoryDigest, /^[a-f0-9]{64}$/);
    const firstCatalog = await catalog();
    assert.equal(firstCatalog.skills.find(({ id }) => id === "ppt-master").directoryDigest, first.directoryDigest);
    assert.equal(firstCatalog.directoryDigestAlgorithm, first.directoryDigestAlgorithm);
    assert.equal((await manifest("dashi-ppt")).directoryDigest, firstCatalog.skills.find(({ id }) => id === "dashi-ppt").directoryDigest);
    for (const path of ["ppt-master/obsolete-patch.py", "canonical/obsolete.txt", "agency-agents/design/agent.md"]) {
      await assert.rejects(readFile(join(output, "skills", path)), /ENOENT/);
    }
    assert.deepEqual(await readFile(join(output, "skills/ppt-master/SKILL.md")), upstream);
    assert.equal(await readFile(join(output, "skills/ppt-master/tools/工具.py"), "utf8"), "print('original')\n");
    await utimes(join(root, ppt, "SKILL.md"), new Date(0), new Date(0));
    await bundle();
    assert.equal((await manifest()).directoryDigest, first.directoryDigest, "timestamps do not invalidate content");

    await put(root, "content/skills/canonical/tools/tool.py", "print('new')\n");
    await bundle();
    assert.notEqual((await catalog()).skills.find(({ id }) => id === "canonical").directoryDigest, firstCatalog.skills.find(({ id }) => id === "canonical").directoryDigest);

    await rm(join(root, dashi, "SKILL.md"));
    await assert.rejects(bundle(), /offline_skill_missing:chuspeeism\/dashi-ppt-skill/);
    await put(root, `${dashi}/SKILL.md`, "dashi original\n");

    await put(root, `${ppt}/tools/工具.py`, "print('tampered')\n");
    await assert.rejects(bundle(), /skill_cache_integrity_failed:ppt-master/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
