import { access, cp, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(repoRoot, "content", "skills");
const target = join(repoRoot, "apps", "desktop", "dist-runtime", "skills");
const agentsSource = join(source, "agency-agents");
const agentsTarget = join(repoRoot, "apps", "desktop", "dist-runtime", "agents");
const execFileAsync = promisify(execFile);
const offline = process.argv.includes("--offline");
const directoryDigestAlgorithm = "sha256-tree-v1";
const skillLock = JSON.parse(await readFile(join(repoRoot, "scripts", "desktop-skills.lock.json"), "utf8"));
if (skillLock?.schemaVersion !== 1 || skillLock?.directoryDigestAlgorithm !== directoryDigestAlgorithm || !Array.isArray(skillLock?.skills)) {
  throw new Error("desktop_skill_lock_invalid");
}
function lockedSkill(id) {
  const skill = skillLock.skills.find((entry) => entry?.id === id);
  if (!skill || !["repo", "version", "commit", "branch", "skillPath", "stagingName", "directoryDigest"].every((key) => typeof skill[key] === "string" && skill[key].trim())) {
    throw new Error(`desktop_skill_lock_invalid:${id}`);
  }
  return skill;
}
const pptMaster = lockedSkill("ppt-master");
const dashiPpt = lockedSkill("dashi-ppt");
await mkdir(dirname(target), { recursive: true });
await syncDirectory(source, target, new Set(["ppt-master", "dashi-ppt", "ppt-master.manifest.json", "dashi-ppt.manifest.json"]));
// Agency Agents are OpenCode agents, not SKILL.md packages. Keep their
// runtime definitions in dist-runtime/agents so the skill scanner never
// attempts to resolve an agency-* ID as a Skill.
await rm(join(target, "agency-agents"), { recursive: true, force: true });

function runtimeAgentId(category, sourcePath) {
  const fileSlug = sourcePath.replace(/\.md$/iu, "").replaceAll("/", "-");
  return fileSlug.startsWith(`${category}-`) ? `agency-${fileSlug}` : `agency-${category}-${fileSlug}`;
}

async function listAgentFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listAgentFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files.sort();
}

await rm(agentsTarget, { recursive: true, force: true });
await mkdir(agentsTarget, { recursive: true });
const agencyAgents = [];
for (const categoryEntry of (await readdir(agentsSource, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
  const category = categoryEntry.name;
  const categoryRoot = join(agentsSource, category);
  for (const file of await listAgentFiles(categoryRoot)) {
    const sourcePath = relative(categoryRoot, file).replaceAll("\\", "/");
    const id = runtimeAgentId(category, sourcePath);
    await cp(file, join(agentsTarget, `${id}.md`), { force: true });
    agencyAgents.push({ id, category, sourcePath, relativePath: `${id}.md`, sourceUrl: `https://github.com/msitarzewski/agency-agents/blob/main/${category}/${sourcePath}` });
  }
}
await writeFile(join(repoRoot, "apps", "desktop", "dist-runtime", "agency-agent-manifest.json"), `${JSON.stringify({ schemaVersion: 1, repository: "https://github.com/msitarzewski/agency-agents", agents: agencyAgents }, null, 2)}\n`, "utf8");
const catalogPath = join(repoRoot, ".artifacts", "shared-skill-catalog.json");
try { await writeFile(join(repoRoot, "apps", "desktop", "dist-runtime", "skill-catalog.json"), await readFile(catalogPath, "utf8"), "utf8"); }
catch { throw new Error("Run the shared skill catalog generator before bundling desktop skills."); }

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

// Preserve the directory itself for Tauri's concurrent resource scanner, while
// removing files deleted upstream. Copy every upstream byte without patches.
async function syncDirectory(sourceRoot, targetRoot, preservedNames = new Set()) {
  await mkdir(targetRoot, { recursive: true });
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const names = new Set(entries.map((entry) => entry.name));
  for (const entry of await readdir(targetRoot, { withFileTypes: true })) {
    if (!names.has(entry.name) && !preservedNames.has(entry.name)) {
      await rm(join(targetRoot, entry.name), { recursive: true, force: true });
    }
  }
  for (const entry of entries) {
    const from = join(sourceRoot, entry.name);
    const to = join(targetRoot, entry.name);
    if (!entry.isDirectory() && !entry.isFile()) throw new Error(`Unsupported skill entry: ${from}`);
    const existing = await lstat(to).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (existing && (existing.isSymbolicLink() || existing.isDirectory() !== entry.isDirectory())) {
      await rm(to, { recursive: true, force: true });
    }
    if (entry.isDirectory()) await syncDirectory(from, to);
    else await cp(from, to, { force: true });
  }
}

async function digestDirectory(directory) {
  const hash = createHash("sha256");
  // sha256-tree-v1: sorted depth-first traversal; one UTF-8 JSON array + LF
  // per entry: [slash-relative-path,"directory"] or [path,"file",fileSha256].
  // Includes hidden files and empty directories; excludes timestamps/modes.
  async function visit(root, prefix = "") {
    const entries = await readdir(root, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const path = join(root, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        hash.update(`${JSON.stringify([relativePath, "directory"])}\n`);
        await visit(path, relativePath);
      } else if (entry.isFile()) {
        const digest = createHash("sha256").update(await readFile(path)).digest("hex");
        hash.update(`${JSON.stringify([relativePath, "file", digest])}\n`);
      } else { throw new Error(`Unsupported skill entry: ${path}`); }
    }
  }
  await visit(directory);
  return hash.digest("hex");
}

async function acquireGitSkill({ id, repo, commit, branch, skillPath, stagingName, directoryDigest }) {
  const staging = join(repoRoot, ".artifacts", `${stagingName}-${commit}`);
  const acquired = join(staging, skillPath);
  if (await exists(join(acquired, "SKILL.md"))) {
    if (await digestDirectory(acquired) !== directoryDigest) throw new Error(`skill_cache_integrity_failed:${id}`);
    return acquired;
  }
  if (offline) throw new Error(`offline_skill_missing:${repo}@${commit}`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(dirname(staging), { recursive: true });
  try {
    // Git for Windows may apply core.autocrlf during checkout, which changes
    // the pinned tree bytes and makes the lock digest fail. Disable conversion
    // so every platform verifies the same upstream content.
    await execFileAsync("git", ["-c", "core.autocrlf=false", "clone", "--depth", "1", "--branch", branch, `https://github.com/${repo}.git`, staging], { windowsHide: true, timeout: 180000, maxBuffer: 64 * 1024 });
    // The locked commit may no longer be the branch tip. Fetch it explicitly
    // after the shallow branch clone so release runners can reproduce older,
    // approved skill revisions instead of failing with "unable to read tree".
    await execFileAsync("git", ["-c", "core.autocrlf=false", "-C", staging, "fetch", "--depth", "1", "origin", commit], { windowsHide: true, timeout: 180000, maxBuffer: 64 * 1024 });
    await execFileAsync("git", ["-c", "core.autocrlf=false", "-C", staging, "checkout", "--detach", commit], { windowsHide: true, timeout: 60000, maxBuffer: 64 * 1024 });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw new Error(`Unable to acquire ${repo} ${commit}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!(await exists(join(acquired, "SKILL.md")))) throw new Error(`Acquired ${repo} repository has no ${skillPath}/SKILL.md`);
  if (await digestDirectory(acquired) !== directoryDigest) {
    await rm(staging, { recursive: true, force: true });
    throw new Error(`skill_source_integrity_failed:${id}`);
  }
  return acquired;
}

const pptSource = await acquireGitSkill(pptMaster);
const pptTarget = join(target, "ppt-master");
// Tauri scans bundled resource directories while `beforeDevCommand` is still
// running. Keep the target directory present and overlay the pinned skill so
// the resource scanner never observes a path that was listed and then removed.
await syncDirectory(pptSource, pptTarget);
const dashiSource = await acquireGitSkill(dashiPpt);
const dashiTarget = join(target, "dashi-ppt");
await syncDirectory(dashiSource, dashiTarget);
const catalogOutput = join(repoRoot, "apps", "desktop", "dist-runtime", "skill-catalog.json");
const catalog = JSON.parse(await readFile(catalogOutput, "utf8"));
const pptDigest = createHash("sha256").update(await readFile(join(pptSource, "SKILL.md"))).digest("hex");
const dashiDigest = createHash("sha256").update(await readFile(join(dashiSource, "SKILL.md"))).digest("hex");
catalog.skills = [
  ...(Array.isArray(catalog.skills) ? catalog.skills : []).filter((skill) => !["ppt-master", "dashi-ppt"].includes(skill?.id)),
  { id: "ppt-master", digest: pptDigest, relativePath: "ppt-master/SKILL.md", source: pptMaster.repo, version: pptMaster.version, commit: pptMaster.commit },
  { id: "dashi-ppt", digest: dashiDigest, relativePath: "dashi-ppt/SKILL.md", source: dashiPpt.repo, version: dashiPpt.version, commit: dashiPpt.commit },
];
catalog.directoryDigestAlgorithm = directoryDigestAlgorithm;
for (const skill of catalog.skills) {
  skill.directoryDigest = await digestDirectory(dirname(join(target, skill.relativePath)));
}
const pptDirectoryDigest = catalog.skills.find((skill) => skill.id === "ppt-master").directoryDigest;
const dashiDirectoryDigest = catalog.skills.find((skill) => skill.id === "dashi-ppt").directoryDigest;
await writeFile(catalogOutput, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
await writeFile(join(target, "ppt-master.manifest.json"), `${JSON.stringify({ schemaVersion: 1, source: pptMaster.repo, version: pptMaster.version, commit: pptMaster.commit, skillPath: "ppt-master/SKILL.md", digest: pptDigest, directoryDigest: pptDirectoryDigest, directoryDigestAlgorithm }, null, 2)}\n`, "utf8");
await writeFile(join(target, "dashi-ppt.manifest.json"), `${JSON.stringify({ schemaVersion: 1, source: dashiPpt.repo, version: dashiPpt.version, commit: dashiPpt.commit, skillPath: "dashi-ppt/SKILL.md", digest: dashiDigest, directoryDigest: dashiDirectoryDigest, directoryDigestAlgorithm }, null, 2)}\n`, "utf8");
console.log(`Bundled canonical skills, ppt-master ${pptMaster.commit}, and dashi-ppt ${dashiPpt.commit} into ${target}`);
