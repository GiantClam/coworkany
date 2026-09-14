import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "package-desktop-runtime.ps1");

test("offline runtime packager uses the manifest as its source of truth", async () => {
  const source = await readFile(scriptPath, "utf8");
  assert.match(source, /runtime\/runtime-manifest\.json/u);
  assert.match(source, /runtime_package_manifest_target_invalid/u);
  assert.match(source, /foreach \(\$asset in @\(\$manifest\.assets\)\)/u);
  assert.match(source, /Verify-Asset \$asset \$stage/u);
});

test("offline runtime packager preserves the installer import contract", async () => {
  const source = await readFile(scriptPath, "utf8");
  assert.match(source, /CoworkAny-Runtime-x64\.zip/u);
  assert.match(source, /install-desktop-runtime\.ps1/u);
  assert.match(source, /Compress-Archive/u);
  assert.match(source, /SkipDownloads/u);
  assert.match(source, /runtime_package_archive_missing/u);
  assert.match(source, /runtime-manifest-crypto\.mjs/u);
  assert.match(source, /RequireSignature/u);
  assert.match(source, /runtime_package_manifest_signature_required/u);
  assert.match(source, /signatureAlgorithm -ne "ed25519"/u);
});

test("offline runtime packager preflights standard Python and upstream requirements", async () => {
  const source = await readFile(scriptPath, "utf8");
  assert.match(source, /Prepare-OfflinePython \$stage/u);
  assert.match(source, /Test-StandardPythonProbe/u);
  assert.match(source, /--no-index --no-deps --dry-run/u);
  assert.doesNotMatch(source, /import pptx|import.*pathops/u);
  assert.doesNotMatch(source, /Enable-EmbeddedPythonSitePackages|get-pip\.py|--target \$sitePackages/u);
  assert.match(source, /runtime_package_python_dependencies_failed/u);
  assert.match(source, /assert not sys.flags.isolated and not sys.flags.safe_path/u);
  assert.doesNotMatch(source, /Presentation\(\)|run.font.name/u);
  assert.match(source, /SkipPythonDependencies/u);
});

const run = promisify(execFile);
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const ps = (command) => run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { windowsHide: true, timeout: 1200000, maxBuffer: 128 * 1024 });

test("packager rejects an embedded manifest even when its executable is already staged", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "package-legacy-python-"));
  try {
    await mkdir(join(root, "runtime", "python"), { recursive: true });
    await writeFile(join(root, "runtime", "python", "python.exe"), "old", "utf8");
    await writeFile(join(root, "runtime", "runtime-manifest.json"), JSON.stringify({
      schemaVersion: 1, platform: "windows", architecture: "x64",
      integrity: { hashAlgorithm: "sha256", signatureAlgorithm: "ed25519" },
      assets: [{ id: "python-embed-amd64" }],
    }), "utf8");
    await assert.rejects(ps(`& ${quote(scriptPath)} -SourceRoot ${quote(root)} -OutputDir ${quote(join(root, "out"))} -SkipDownloads`), /runtime_package_python_distribution_unsupported/);
    assert.equal(await readFile(join(root, "runtime", "python", "python.exe"), "utf8"), "old");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("official NuGet package assembles and migrates offline with sibling imports, pip and venv", {
  skip: process.platform !== "win32" || !process.env.COWORKANY_TEST_PYTHON_NUPKG,
  timeout: 1200000,
}, async (t) => {
  const scripts = dirname(scriptPath);
  const root = await mkdtemp(join(tmpdir(), "package-python-integration-"));
  const source = join(root, "source");
  const install = join(root, "install");
  const output = join(root, "output");
  const manifestPath = join(source, "runtime", "runtime-manifest.json");
  try {
    for (const path of ["runtime/python", "runtime/opencode", "skills/ppt-master", "agents"]) await mkdir(join(source, path), { recursive: true });
    const requirements = await readFile(process.env.COWORKANY_TEST_PYTHON_REQUIREMENTS || join(scripts, "../apps/desktop/dist-runtime/skills/ppt-master/requirements.txt"));
    await writeFile(join(source, "skills/ppt-master/requirements.txt"), requirements);
    await writeFile(join(source, "agents/fixture.txt"), "fixture", "utf8");
    await copyFile(process.env.COWORKANY_TEST_PYTHON_NUPKG, join(source, "runtime/python/python.3.13.6.nupkg"));
    // A stale build directory must be replaced in package staging, never patched in place.
    await writeFile(join(source, "runtime/python/python.exe"), "old executable", "utf8");
    await writeFile(join(source, "runtime/python/python313._pth"), "isolated sentinel", "utf8");
    await writeFile(join(source, "runtime/python/get-pip.py"), "legacy sentinel", "utf8");
    for (const name of ["install-desktop-runtime.ps1", "runtime-manifest-crypto.mjs"]) await copyFile(join(scripts, name), join(source, name));
    // Only OpenCode is a fixture; Python, pip, requirements and archive operations are real.
    await ps(`Add-Type -TypeDefinition 'public class VersionFixture { public static void Main() { System.Console.WriteLine("1.18.30"); } }' -OutputAssembly ${quote(join(source, "runtime/opencode/opencode.exe"))} -OutputType ConsoleApplication`);
    const manifest = {
      schemaVersion: 1, manifestId: "python-integration", platform: "windows", architecture: "x64",
      compatibility: { architecture: "x64" },
      integrity: { hashAlgorithm: "sha256", signatureAlgorithm: "ed25519", required: false },
      python: { distribution: "cpython-nuget", version: "3.13.6" },
      assets: [{ id: "python-nuget-amd64", kind: "archive", relativePath: "runtime/python/python.3.13.6.nupkg", extractPath: "runtime/python", bytes: 14170995, sha256: "cc1d4850a31f18a5c5d52007c248a99f1c360c96886f6fd2e324a55dc1d1967b", urls: {} }],
    };
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    await ps(`& ${quote(scriptPath)} -SourceRoot ${quote(source)} -OutputDir ${quote(output)} -SkipDownloads`);
    assert.equal(await readFile(join(source, "runtime/python/python313._pth"), "utf8"), "isolated sentinel");
    await mkdir(join(install, "runtime/python"), { recursive: true });
    await writeFile(join(install, "runtime/python/python313._pth"), "previous managed runtime", "utf8");
    await writeFile(join(install, "config.json"), '{"preserve":true}', "utf8");
    const zip = join(output, "CoworkAny-Runtime-x64.zip");
    await ps(`Add-Type -AssemblyName System.IO.Compression.FileSystem
$z=[IO.Compression.ZipFile]::OpenRead(${quote(zip)})
try { if (-not ($z.Entries | Where-Object { $_.FullName.Replace('\\','/') -eq 'runtime/python/python3.exe' })) { throw 'package_python3_missing' } } finally { $z.Dispose() }`);
    const installArgs = `-ManifestPath ${quote(manifestPath)} -InstallRoot ${quote(install)} -OfflineZip ${quote(zip)} -MinimumFreeBytes 0`;
    await ps(`& ${quote(join(scripts, "install-desktop-runtime.ps1"))} ${installArgs}`);
    assert.equal(await readFile(join(install, "config.json"), "utf8"), '{"preserve":true}');
    assert.equal(await readFile(join(`${install}.last-known-good`, "runtime/python/python313._pth"), "utf8"), "previous managed runtime");
    assert.deepEqual(await readFile(join(install, "skills/ppt-master/requirements.txt")), requirements);
    const names = await readdir(join(install, "runtime/python"));
    assert.ok(!names.some((name) => name.endsWith("._pth") || name === "get-pip.py" || name === "tools"));
    const probes = join(root, "script directory with spaces");
    await mkdir(probes);
    await writeFile(join(probes, "sibling.py"), "VALUE = 42\n", "utf8");
    await writeFile(join(probes, "probe.py"), "import sys, sibling, pip, venv, ensurepip, pptx\nassert sibling.VALUE == 42\nassert sys.version_info[:3] == (3, 13, 6)\nassert not sys.flags.isolated and not sys.flags.safe_path\nprint('standard-python-ok')\n", "utf8");
    const python = join(install, "runtime/python/python.exe");
    const python3 = join(install, "runtime/python/python3.exe");
    assert.deepEqual(await readFile(python3), await readFile(python));
    const { stdout } = await run(python, ["-s", "-E", join(probes, "probe.py")], { windowsHide: true, cwd: root });
    assert.match(stdout, /standard-python-ok/);
    await run(python, ["-s", "-E", "-m", "pip", "check"], { windowsHide: true, timeout: 30000 });
    const venv = join(root, "venv");
    await run(python, ["-s", "-E", "-m", "venv", venv], { windowsHide: true, timeout: 120000 });
    await run(join(venv, "Scripts/python.exe"), ["-m", "pip", "--version"], { windowsHide: true, timeout: 30000 });
    // Even if the NUPKG is valid, an offline extracted embedded payload must fail closed.
    const corruptZip = join(output, "legacy-payload-fixture.zip");
    await copyFile(zip, corruptZip);
    await ps(`Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$z=[IO.Compression.ZipFile]::Open(${quote(corruptZip)},[IO.Compression.ZipArchiveMode]::Update)
try { $e=$z.CreateEntry('runtime/python/python313._pth'); $w=[IO.StreamWriter]::new($e.Open()); try { $w.Write('isolated') } finally { $w.Dispose() } } finally { $z.Dispose() }`);
    await assert.rejects(ps(`& ${quote(join(scripts, "install-desktop-runtime.ps1"))} ${installArgs.replace(quote(zip), quote(corruptZip))}`), /runtime_python_distribution_unsupported/);
    assert.equal(await readFile(join(install, "config.json"), "utf8"), '{"preserve":true}');
    t.diagnostic(`Verified official CPython 3.13.6, original requirements, package assembly, offline migration, retained rollback, sibling imports and venv.`);
  } finally {
    if (process.env.COWORKANY_KEEP_RUNTIME_TEST_OUTPUT === "1") t.diagnostic(`Retained integration artifacts: ${root}`);
    else await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
