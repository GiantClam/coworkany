import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const scripts = dirname(fileURLToPath(import.meta.url));
test("desktop probing and launch share bundled-first OpenCode selection", async () => {
  const host = await readFile(join(scripts, "../apps/desktop/src-tauri/src/host.rs"), "utf8");
  const shell = await readFile(join(scripts, "../apps/desktop/src-tauri/src/lib.rs"), "utf8");
  assert.match(host, /ordered_runtime_candidates\(private, packaged, configured/u);
  assert.match(shell, /host::opencode_executable\(&app\)/u);
  assert.match(shell, /"up-dist-manifest"/u);
});
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const options = { windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 };
const loadFunctions = (name) => `
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile(${quote(join(scripts, name))},[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw $errors[0] }
$ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] },$false) | ForEach-Object { . ([scriptblock]::Create($_.Extent.Text)) }
`;

test("OpenCode installer verifies existing and downloaded executables, with no offline npm fallback", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "runtime-version-"));
  try {
    // All executable paths resolve to PowerShell functions; no real runtime is launched.
    const command = `
$ErrorActionPreference='Stop'
${loadFunctions("install-desktop-runtime.ps1")}
$stageRoot=${quote(root)}; $Proxy=''
$target=Join-Path $stageRoot 'runtime/opencode/opencode.exe'
$npm=Join-Path $stageRoot 'runtime/node/npm.cmd'
$candidate=Join-Path $stageRoot 'runtime/opencode/npm-root/node_modules/opencode-ai/bin/opencode.exe'
New-Item -ItemType Directory -Force -Path (Split-Path $target),(Split-Path $npm),(Split-Path $candidate) | Out-Null
[IO.File]::WriteAllText($target,'old')
[IO.File]::WriteAllText($npm,'unused')
[IO.File]::WriteAllText($candidate,'new')
$script:targetVersion='1.18.27'; $script:candidateVersion='1.18.27'; $script:npmCalls=0
function Get-OpenCodeVersion([string]$path) { if ($path -eq $target) { return $script:targetVersion }; return $script:candidateVersion }
Set-Item -LiteralPath "Function:$npm" -Value {
  $script:npmCalls++
  if ($args -notcontains 'opencode-ai@1.18.27') { throw 'unpinned_package' }
  $global:LASTEXITCODE=0
}
Install-OpenCodePackage -Offline
if ($script:npmCalls -ne 0) { throw 'offline_network' }
foreach ($version in @('1.18.26','','1.18.27-preview','1.18.270')) {
  $script:targetVersion=$version
  try { Install-OpenCodePackage -Offline; throw 'accepted_invalid_offline' } catch { if ($_.Exception.Message -notlike 'offline_opencode_version_mismatch*') { throw } }
}
if ($script:npmCalls -ne 0) { throw 'offline_network' }
Remove-Item -LiteralPath $target
try { Install-OpenCodePackage -Offline; throw 'accepted_missing_offline' } catch { if ($_.Exception.Message -ne 'offline_opencode_missing') { throw } }
[IO.File]::WriteAllText($target,'old')
$script:targetVersion='1.18.26'
Install-OpenCodePackage
if ($script:npmCalls -ne 1 -or [IO.File]::ReadAllText($target) -ne 'new') { throw 'stale_exe_not_replaced' }
[IO.File]::WriteAllText($target,'preserved')
$script:candidateVersion='1.18.26'
try { Install-OpenCodePackage; throw 'accepted_wrong_download' } catch { if ($_.Exception.Message -notlike 'opencode_version_mismatch*') { throw } }
if ([IO.File]::ReadAllText($target) -ne 'preserved') { throw 'overwrote_before_verification' }
Write-Output 'version-regression-ok'
`;
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-Command", command], options);
    assert.match(stdout, /version-regression-ok/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("staging selects only the pinned version and rejects stale output", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "stage-version-"));
  try {
    const command = `
$ErrorActionPreference='Stop'
${loadFunctions("stage-desktop-runtime.ps1")}
$root=${quote(root)}
$old=Join-Path $root 'old.exe'; $good=Join-Path $root 'good.exe'; $target=Join-Path $root 'target.exe'
[IO.File]::WriteAllText($old,'old'); [IO.File]::WriteAllText($good,'good'); [IO.File]::WriteAllText($target,'stale')
function Get-OpenCodeVersion([string]$path) { if ([IO.File]::ReadAllText($path) -eq 'good') { return '1.18.27' }; return '1.18.26' }
if (-not (Stage-OpenCode @($old,$good) $target)) { throw 'not_staged' }
if ([IO.File]::ReadAllText($target) -ne 'good') { throw 'wrong_candidate' }
if (-not (Stage-OpenCode @() $target)) { throw 'valid_target_not_reused' }
[IO.File]::WriteAllText($target,'stale')
try { Stage-OpenCode @($old) $target; throw 'accepted_stale' } catch { if ($_.Exception.Message -notlike 'opencode_version_required*') { throw } }
Remove-Item -LiteralPath $target
if (Stage-OpenCode @() $target) { throw 'claimed_missing_staged' }
Write-Output 'stage-regression-ok'
`;
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-Command", command], options);
    assert.match(stdout, /stage-regression-ok/);
    const source = await readFile(join(scripts, "stage-desktop-runtime.ps1"), "utf8");
    assert.match(source, /opencode = @\{[^\n]*version = "1\.18\.27"/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("version probes require successful exact output and restore offline environment flags", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-probe-"));
  try {
    const fixture = join(root, "fixture.ps1");
    await mkdir(root, { recursive: true });
    await writeFile(fixture, `if ($args[0] -ne '--version' -or $env:OPENCODE_DISABLE_MODELS_FETCH -ne 'true' -or $env:OPENCODE_DISABLE_AUTOUPDATE -ne 'true') { throw 'unsafe_probe' }; Write-Output $env:FIXTURE_VERSION; exit ([int]$env:FIXTURE_EXIT)`, "utf8");
    for (const name of ["install-desktop-runtime.ps1", "stage-desktop-runtime.ps1"]) {
      const command = `
$ErrorActionPreference='Stop'
${loadFunctions(name)}
$env:OPENCODE_DISABLE_MODELS_FETCH='previous'; $env:OPENCODE_DISABLE_AUTOUPDATE=$null
$env:FIXTURE_VERSION='1.18.27'; $env:FIXTURE_EXIT='0'
if ((Get-OpenCodeVersion ${quote(fixture)}) -ne '1.18.27') { throw 'version_probe_failed' }
$env:FIXTURE_EXIT='1'
if (Get-OpenCodeVersion ${quote(fixture)}) { throw 'accepted_nonzero_exit' }
if ($env:OPENCODE_DISABLE_MODELS_FETCH -ne 'previous' -or $null -ne $env:OPENCODE_DISABLE_AUTOUPDATE) { throw 'environment_not_restored' }
Write-Output 'probe-regression-ok'
`;
      const { stdout } = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], options);
      assert.match(stdout, /probe-regression-ok/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
