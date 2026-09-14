param(
  [Parameter(Mandatory = $true)][string]$ManifestPath,
  [Parameter(Mandatory = $true)][string]$InstallRoot,
  [string]$OfflineZip,
  [string]$Proxy,
  [UInt64]$MinimumFreeBytes = 1073741824,
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"

function Convert-ToPowerShellCompatiblePath([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $value
  }

  if ($value.StartsWith("\\?\UNC\", [StringComparison]::OrdinalIgnoreCase)) {
    return "\\$($value.Substring(8))"
  }

  if ($value.StartsWith("\\?\", [StringComparison]::OrdinalIgnoreCase)) {
    return $value.Substring(4)
  }

  return $value
}

$ManifestPath = Convert-ToPowerShellCompatiblePath $ManifestPath
$InstallRoot = Convert-ToPowerShellCompatiblePath $InstallRoot
if (-not [string]::IsNullOrWhiteSpace($OfflineZip)) {
  $OfflineZip = Convert-ToPowerShellCompatiblePath $OfflineZip
}

function Write-RuntimeProgress([string]$message) {
  Write-Output "RUNTIME_PROGRESS:$message"
}

# Some stripped-down Windows PowerShell installations do not load the
# Microsoft.PowerShell.Utility module under the desktop bootstrap environment.
# Keep the installer self-contained with the .NET implementation in that case.
if ($null -eq (Get-Command Get-FileHash -ErrorAction SilentlyContinue)) {
  function Get-FileHash {
    param([Parameter(Mandatory = $true)][string]$LiteralPath, [string]$Algorithm = "SHA256")
    $stream = [IO.File]::OpenRead($LiteralPath)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
      [pscustomobject]@{ Algorithm = $Algorithm; Hash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
    } finally {
      $sha.Dispose()
      $stream.Dispose()
    }
  }
}

$mirrors = @("aliyun", "tencent", "tsinghua", "official")
$manifest = Get-Content -Raw -Encoding UTF8 $ManifestPath | ConvertFrom-Json
Write-RuntimeProgress "manifest_loaded"
$installRootResolved = [IO.Path]::GetFullPath([string]$InstallRoot)
$stageRoot = Join-Path ([IO.Path]::GetTempPath()) ("coworkany-runtime-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

function Assert-SafeRelativePath([string]$value, [string]$label) {
  if ([string]::IsNullOrWhiteSpace($value)) { throw "runtime_manifest_${label}_missing" }
  $normalized = $value.Replace('\', '/')
  if ([IO.Path]::IsPathRooted($value) -or $normalized.StartsWith('/') -or ($normalized -split '/') -contains '..') {
    throw "runtime_manifest_${label}_unsafe"
  }
}

function Assert-RuntimeManifestSchema() {
  if ($null -eq $manifest -or [int]$manifest.schemaVersion -ne 1) { throw "runtime_manifest_schema_unsupported" }
  if ([string]$manifest.platform -ne 'windows' -or [string]$manifest.architecture -ne 'x64') { throw "runtime_manifest_target_unsupported" }
  if ($null -eq $manifest.compatibility -or [string]$manifest.compatibility.architecture -ne 'x64') { throw "runtime_manifest_compatibility_missing" }
  if ($null -eq $manifest.integrity -or [string]$manifest.integrity.hashAlgorithm -ne 'sha256' -or [string]$manifest.integrity.signatureAlgorithm -ne 'ed25519') { throw "runtime_manifest_integrity_schema_missing" }
  $assets = @($manifest.assets)
  if ($assets.Count -eq 0) { throw "runtime_manifest_assets_missing" }
  foreach ($asset in $assets) {
    if ($asset.id -in @('python-embed-amd64', 'python-get-pip')) { throw "runtime_python_distribution_unsupported:restage_with_cpython_nuget" }
    if ([string]::IsNullOrWhiteSpace([string]$asset.id)) { throw "runtime_manifest_asset_id_missing" }
    if ([string]$asset.kind -notin @('archive', 'file')) { throw "runtime_manifest_asset_kind_invalid:$($asset.id)" }
    Assert-SafeRelativePath ([string]$asset.relativePath) "asset_path"
    if ($asset.kind -eq 'archive') { Assert-SafeRelativePath ([string]$asset.extractPath) "extract_path" }
    if ([string]$asset.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw "runtime_manifest_asset_hash_invalid:$($asset.id)" }
    if ($null -ne $asset.bytes -and ([int64]$asset.bytes -le 0)) { throw "runtime_manifest_asset_size_invalid:$($asset.id)" }
    if ($null -eq $asset.urls) { throw "runtime_manifest_asset_sources_missing:$($asset.id)" }
  }
}

function Assert-ManifestSignature() {
  $trustedPublicKey = "-----BEGIN PUBLIC KEY-----`nMCowBQYDK2VwAyEAHgKs3hyNJCHJsLN9sle73MWSPew6fOweDLoO1E935JA=`n-----END PUBLIC KEY-----`n"
  $required = $false
  if ($null -ne $manifest.integrity.required) { $required = [bool]$manifest.integrity.required }
  $signature = [string]$manifest.integrity.signature
  if ([string]::IsNullOrWhiteSpace($signature)) {
    if ($required) { throw "runtime_manifest_signature_missing" }
    return
  }
  $node = $env:COWORKANY_NODE_PATH
  if ([string]::IsNullOrWhiteSpace($node)) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
  if ([string]::IsNullOrWhiteSpace($node) -or -not (Test-Path -LiteralPath $node -PathType Leaf)) {
    $node = Join-Path (Split-Path -Parent ([IO.Path]::GetFullPath($ManifestPath))) "runtime/node/node.exe"
  }
  $scriptDirectory = $PSScriptRoot
  $verifier = Join-Path $scriptDirectory "runtime-manifest-crypto.mjs"
  if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or -not (Test-Path -LiteralPath $verifier -PathType Leaf)) { throw "runtime_manifest_signature_verifier_missing" }
  $publicKeyFile = Join-Path $stageRoot "runtime-manifest-public-key.pem"
  [IO.File]::WriteAllText($publicKeyFile, $trustedPublicKey, [Text.UTF8Encoding]::new($false))
  & $node $verifier verify $ManifestPath $publicKeyFile
  if ($LASTEXITCODE -ne 0) { throw "runtime_manifest_signature_invalid" }
}

function Assert-OfflineArchiveManifest([string]$archivePath) {
  if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) { throw "runtime_offline_archive_missing" }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($archivePath))
  try {
    $entry = $archive.Entries | Where-Object { $_.FullName.Replace('\', '/') -eq "runtime-manifest.json" } | Select-Object -First 1
    if ($null -eq $entry) { throw "runtime_offline_manifest_missing" }
    $reader = [IO.StreamReader]::new($entry.Open(), [Text.Encoding]::UTF8)
    try { $embedded = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  } finally { $archive.Dispose() }
  if ([int]$embedded.schemaVersion -ne [int]$manifest.schemaVersion -or [string]$embedded.manifestId -ne [string]$manifest.manifestId -or [string]$embedded.platform -ne [string]$manifest.platform -or [string]$embedded.architecture -ne [string]$manifest.architecture) { throw "runtime_offline_manifest_mismatch" }
  if ([string]$embedded.integrity.signature -ne [string]$manifest.integrity.signature -or [bool]$embedded.integrity.required -ne [bool]$manifest.integrity.required) { throw "runtime_offline_manifest_signature_mismatch" }
  $expectedAssets = @($manifest.assets)
  $embeddedAssets = @($embedded.assets)
  if ($expectedAssets.Count -ne $embeddedAssets.Count) { throw "runtime_offline_manifest_assets_mismatch" }
  foreach ($expected in $expectedAssets) {
    $actual = $embeddedAssets | Where-Object { [string]$_.id -eq [string]$expected.id } | Select-Object -First 1
    if ($null -eq $actual -or [string]$actual.kind -ne [string]$expected.kind -or [string]$actual.relativePath -ne [string]$expected.relativePath -or [string]$actual.extractPath -ne [string]$expected.extractPath -or [string]$actual.sha256 -ne [string]$expected.sha256 -or [int64]$actual.bytes -ne [int64]$expected.bytes) { throw "runtime_offline_manifest_asset_mismatch:$($expected.id)" }
  }
}

function Expand-SafeZip([string]$archivePath, [string]$destination) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $destinationFull = [IO.Path]::GetFullPath($destination)
  $destinationPrefix = if ($destinationFull.EndsWith([IO.Path]::DirectorySeparatorChar)) { $destinationFull } else { $destinationFull + [IO.Path]::DirectorySeparatorChar }
  $archive = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($archivePath))
  try {
    foreach ($entry in $archive.Entries) {
      $entryRelative = $entry.FullName.Replace('/', [IO.Path]::DirectorySeparatorChar)
      $entryFull = [IO.Path]::GetFullPath([IO.Path]::Combine($destinationFull, $entryRelative))
      if ($entryFull -ne $destinationFull -and -not $entryFull.StartsWith($destinationPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "runtime_archive_entry_unsafe:$($entry.FullName)"
      }
    }
  } finally { $archive.Dispose() }
  New-Item -ItemType Directory -Force -Path $destinationFull | Out-Null
  [IO.Compression.ZipFile]::ExtractToDirectory([IO.Path]::GetFullPath($archivePath), $destinationFull)
}

Assert-RuntimeManifestSchema
Assert-ManifestSignature
if ($OfflineZip) { Assert-OfflineArchiveManifest $OfflineZip }
if ($ValidateOnly) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
  Write-Output (ConvertTo-Json @{ status = "valid"; manifestId = $manifest.manifestId; platform = $manifest.platform; architecture = $manifest.architecture } -Compress)
  return
}

function Get-AvailableBytes([string]$path) {
  $fullPath = [IO.Path]::GetFullPath($path)
  $root = [IO.Path]::GetPathRoot($fullPath)
  if ([string]::IsNullOrWhiteSpace($root)) { throw "runtime_install_disk_root_missing" }
  try {
    return [UInt64]([IO.DriveInfo]::new($root).AvailableFreeSpace)
  } catch {
    throw "runtime_install_disk_probe_failed:$root"
  }
}

function Assert-SufficientDiskSpace() {
  $assetBytes = [UInt64]0
  foreach ($asset in @($manifest.assets)) {
    if ($null -ne $asset.bytes -and [int64]$asset.bytes -gt 0) {
      $assetBytes += [UInt64]$asset.bytes
    }
  }
  $requiredBytes = $assetBytes + [UInt64]$MinimumFreeBytes
  $availableBytes = Get-AvailableBytes $installRootResolved
  if ($availableBytes -lt $requiredBytes) {
    throw "runtime_install_disk_space_insufficient:available=$availableBytes;required=$requiredBytes"
  }
  $temporaryAvailableBytes = Get-AvailableBytes ([IO.Path]::GetTempPath())
  if ($temporaryAvailableBytes -lt $requiredBytes) {
    throw "runtime_install_temp_disk_space_insufficient:available=$temporaryAvailableBytes;required=$requiredBytes"
  }
}

function Invoke-ResumableDownload([string]$uri, [string]$destination, [int]$timeoutSeconds = 90) {
  $partial = "$destination.part"
  $existingBytes = if (Test-Path -LiteralPath $partial -PathType Leaf) { [UInt64](Get-Item -LiteralPath $partial).Length } else { [UInt64]0 }
  $request = [Net.HttpWebRequest]::Create($uri)
  $request.Timeout = $timeoutSeconds * 1000
  $request.ReadWriteTimeout = $timeoutSeconds * 1000
  if (-not [string]::IsNullOrWhiteSpace($Proxy)) {
    $request.Proxy = [Net.WebProxy]::new($Proxy)
  }
  if ($existingBytes -gt 0) { $request.AddRange([int64]$existingBytes) }
  $response = $null
  $input = $null
  $output = $null
  try {
    $response = [Net.HttpWebResponse]$request.GetResponse()
    $append = $existingBytes -gt 0 -and $response.StatusCode -eq [Net.HttpStatusCode]::PartialContent
    if (-not $append -and $existingBytes -gt 0) {
      Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    }
    $mode = if ($append) { [IO.FileMode]::Append } else { [IO.FileMode]::Create }
    $input = $response.GetResponseStream()
    $output = [IO.File]::Open($partial, $mode, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $buffer = New-Object byte[] (1024 * 1024)
    while (($read = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $output.Write($buffer, 0, $read)
    }
    $output.Flush($true)
    $output.Dispose(); $output = $null
    $input.Dispose(); $input = $null
    $response.Dispose(); $response = $null
    Move-Item -LiteralPath $partial -Destination $destination -Force
  } finally {
    if ($output) { $output.Dispose() }
    if ($input) { $input.Dispose() }
    if ($response) { $response.Dispose() }
  }
}

function Seed-BundledRuntime() {
  $bundledRuntimeRoot = Split-Path -Parent ([IO.Path]::GetFullPath($ManifestPath))
  if (-not (Test-Path -LiteralPath $bundledRuntimeRoot -PathType Container)) { return }
  $bundledRoot = Split-Path -Parent $bundledRuntimeRoot
  $bundledRuntime = Join-Path $bundledRoot "runtime"
  if (Test-Path -LiteralPath $bundledRuntime -PathType Container) {
    New-Item -ItemType Directory -Force -Path (Join-Path $stageRoot "runtime") | Out-Null
    foreach ($name in @("node", "opencode", "lancedb", "fonts", "embedding", "media")) {
      $source = Join-Path $bundledRuntime $name
      if (Test-Path -LiteralPath $source -PathType Container) { Copy-Item -LiteralPath $source -Destination (Join-Path $stageRoot "runtime") -Recurse -Force }
    }
  }
  $bundledSkills = Join-Path $bundledRoot "skills"
  if (Test-Path -LiteralPath $bundledSkills -PathType Container) { Copy-Item -LiteralPath $bundledSkills -Destination (Join-Path $stageRoot "skills") -Recurse -Force }
  $bundledAgents = Join-Path $bundledRoot "agents"
  if (Test-Path -LiteralPath $bundledAgents -PathType Container) { Copy-Item -LiteralPath $bundledAgents -Destination (Join-Path $stageRoot "agents") -Recurse -Force }
  Write-RuntimeProgress "bundled_runtime_seeded"
}

function Assert-Asset([object]$asset, [string]$root) {
  $target = Join-Path $root $asset.relativePath
  # A healthy system Node may already be staged as an executable even when
  # the fallback archive is not needed. Keep the capability probe idempotent.
  if ($asset.id -eq "node-embed-amd64" -and (Test-Path -LiteralPath (Join-Path $root "runtime/node/node.exe") -PathType Leaf)) { return }
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "runtime asset missing: $($asset.id)" }
  $item = Get-Item -LiteralPath $target
  if ($asset.bytes -and [int64]$asset.bytes -ne [int64]$item.Length) { throw "runtime asset size mismatch: $($asset.id)" }
  $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $asset.sha256.ToLowerInvariant()) { throw "runtime asset sha256 mismatch: $($asset.id)" }
}

function Expand-ArchiveAssets() {
  foreach ($asset in $manifest.assets) {
    if ($asset.kind -ne "archive") { continue }
    $archive = Join-Path $stageRoot $asset.relativePath
    $target = Join-Path $stageRoot $asset.extractPath
    if ($asset.id -eq "python-nuget-amd64") {
      Assert-Asset $asset $stageRoot
      if (Test-Path -LiteralPath (Join-Path $target "python.exe") -PathType Leaf) {
        Assert-StandardPython $target
      } else {
        $unpacked = Join-Path $stageRoot ("python-nuget-" + [guid]::NewGuid().ToString("N"))
        Expand-SafeZip $archive $unpacked
        $tools = Join-Path $unpacked "tools"
        Assert-StandardPython $tools
        Get-ChildItem -LiteralPath $tools -Force | Copy-Item -Destination $target -Recurse -Force
        Remove-Item -LiteralPath $unpacked -Recurse -Force
      }
      # NuGet omits the generic python3 command. Keep it beside the same DLLs/Lib.
      Copy-Item -LiteralPath (Join-Path $target "python.exe") -Destination (Join-Path $target "python3.exe") -Force
      continue
    }
    $alreadyExtracted = if ($asset.id -eq "node-embed-amd64") {
      Test-Path -LiteralPath (Join-Path $stageRoot "runtime/node/node.exe") -PathType Leaf
    } else { $false }
    if ($alreadyExtracted) { continue }
    Write-RuntimeProgress "extracting:$($asset.id)"
    if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
      # A compatible bundled/system runtime may have satisfied this asset
      # before download. In that case there is nothing left to extract.
      if ($alreadyExtracted) { continue }
      throw "runtime archive missing: $($asset.id)"
    }
    Expand-SafeZip $archive $target
  }
  $nodeRoot = Join-Path $stageRoot "runtime/node"
  $nestedNode = Get-ChildItem -LiteralPath $nodeRoot -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "node.exe") -PathType Leaf } | Select-Object -First 1
  if ($nestedNode) {
    Get-ChildItem -LiteralPath $nestedNode.FullName -Force | Move-Item -Destination $nodeRoot -Force
    # Move-Item may remove the now-empty source directory as part of the move.
    # Cleanup must therefore be idempotent on both PowerShell versions.
    try { Remove-Item -LiteralPath $nestedNode.FullName -Recurse -Force -ErrorAction Stop } catch { }
  }
}

function Get-OpenCodeVersion([string]$path) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  $previousModelsFetch = $env:OPENCODE_DISABLE_MODELS_FETCH
  $previousAutoUpdate = $env:OPENCODE_DISABLE_AUTOUPDATE
  try {
    # A version probe must also stay local when validating an offline archive.
    $env:OPENCODE_DISABLE_MODELS_FETCH = "true"
    $env:OPENCODE_DISABLE_AUTOUPDATE = "true"
    $output = & $path --version 2>$null
    if ($LASTEXITCODE -eq 0) { return (($output -join "`n").Trim()) }
  } catch { return $null }
  finally {
    $env:OPENCODE_DISABLE_MODELS_FETCH = $previousModelsFetch
    $env:OPENCODE_DISABLE_AUTOUPDATE = $previousAutoUpdate
  }
  return $null
}

function Install-OpenCodePackage([switch]$Offline) {
  Write-RuntimeProgress "opencode_check"
  $requiredVersion = "1.18.30"
  $target = Join-Path $stageRoot "runtime/opencode/opencode.exe"
  if (Test-Path -LiteralPath $target -PathType Leaf) {
    $actualVersion = Get-OpenCodeVersion $target
    if ($actualVersion -ceq $requiredVersion) { return }
    if ($Offline) { throw "offline_opencode_version_mismatch:expected=$requiredVersion;actual=$actualVersion" }
  } elseif ($Offline) { throw "offline_opencode_missing" }
  $nodeRoot = Join-Path $stageRoot "runtime/node"
  $npm = Join-Path $nodeRoot "npm.cmd"
  if (-not (Test-Path -LiteralPath $npm -PathType Leaf)) { throw "npm unavailable for OpenCode bootstrap" }
  $prefix = Join-Path $stageRoot "runtime/opencode/npm-root"
  New-Item -ItemType Directory -Force -Path $prefix | Out-Null
  $registries = @(
    "https://registry.npmmirror.com",
    "https://mirrors.cloud.tencent.com/npm/",
    "https://mirrors.tuna.tsinghua.edu.cn/npm/",
    "https://registry.npmjs.org"
  )
  $proxyArgs = if ([string]::IsNullOrWhiteSpace($Proxy)) { @() } else { @("--proxy", $Proxy) }
  $installed = $false
  foreach ($registry in $registries) {
    try {
      & $npm install --prefix $prefix --no-save --no-fund --no-audit --fetch-timeout 30000 --fetch-retries 1 --registry $registry @proxyArgs "opencode-ai@$requiredVersion" 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) { $installed = $true; break }
    } catch { }
  }
  if (-not $installed) { throw "OpenCode package installation failed on configured registries" }
  $candidate = Join-Path $prefix "node_modules/opencode-ai/bin/opencode.exe"
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "OpenCode package did not provide Windows executable" }
  $actualVersion = Get-OpenCodeVersion $candidate
  if ($actualVersion -cne $requiredVersion) { throw "opencode_version_mismatch:expected=$requiredVersion;actual=$actualVersion" }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  Copy-Item -LiteralPath $candidate -Destination $target -Force
}

function Assert-StandardPython([string]$pythonRoot) {
  if (Get-ChildItem -LiteralPath $pythonRoot -Filter "*._pth" -File -ErrorAction SilentlyContinue) { throw "runtime_python_distribution_unsupported:embedded_pth" }
  foreach ($required in @("python.exe", "python313.dll", "Lib/os.py", "Lib/venv/__init__.py", "Lib/ensurepip/__init__.py")) {
    if (-not (Test-Path -LiteralPath (Join-Path $pythonRoot $required) -PathType Leaf)) { throw "runtime_python_distribution_unsupported:missing_$required" }
  }
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & (Join-Path $pythonRoot "python.exe") -s -E -c 'import sys, struct, venv, ensurepip; assert sys.version_info[:3] == (3, 13, 6) and struct.calcsize(chr(80)) == 8 and not sys.flags.isolated and not sys.flags.safe_path' 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "runtime_python_distribution_unsupported:probe_failed" }
  } finally { $ErrorActionPreference = $previousErrorAction }
}

function Test-PythonRequirements([string]$python, [string]$requirements) {
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    # Let pip interpret the original requirements, including version constraints.
    # Dry-run and no-index make the readiness check read-only and network-free.
    & $python -s -E -m pip --isolated install --no-index --no-deps --dry-run --disable-pip-version-check -r $requirements 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { return $false }
    & $python -s -E -m pip --isolated check 2>&1 | Out-Null
    return $LASTEXITCODE -eq 0
  } finally { $ErrorActionPreference = $previousErrorAction }
}

function Install-PythonDependencies([switch]$Offline) {
  Write-RuntimeProgress "python_dependencies_check"
  $python = Join-Path $stageRoot "runtime/python/python.exe"
  Assert-StandardPython (Split-Path -Parent $python)
  $proxyArgs = if ([string]::IsNullOrWhiteSpace($Proxy)) { @() } else { @("--proxy", $Proxy) }
  $requirements = Join-Path $stageRoot "skills/ppt-master/requirements.txt"
  if (-not (Test-Path -LiteralPath $requirements -PathType Leaf)) { throw "python_requirements_missing" }
  $probe = @'
import os, sys, pip, venv, ensurepip
assert not sys.flags.isolated and not sys.flags.safe_path
assert os.path.dirname(os.path.abspath(__file__)) in sys.path
'@
  $probeFile = Join-Path ([IO.Path]::GetTempPath()) ("coworkany-python-probe-" + [guid]::NewGuid().ToString("N") + ".py")
  [IO.File]::WriteAllText($probeFile, $probe, [Text.UTF8Encoding]::new($false))
  try {
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $python -s -E $probeFile 2>&1 | Out-Null
    $probeExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorAction
  } finally { Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue }
  if ($probeExitCode -ne 0) { throw "runtime_python_distribution_unsupported:script_probe_failed" }
  if (Test-PythonRequirements $python $requirements) { return }
  if ($Offline) { throw "offline_python_requirements_missing" }
  & $python -s -E -m ensurepip --upgrade 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Python ensurepip bootstrap failed" }
  $indexes = @(
    "https://mirrors.aliyun.com/pypi/simple",
    "https://mirrors.cloud.tencent.com/repository/pypi/simple",
    "https://pypi.tuna.tsinghua.edu.cn/simple",
    "https://pypi.org/simple"
  )
  $installed = $false
  foreach ($index in $indexes) {
    try {
      & $python -s -E -m pip --isolated install --disable-pip-version-check --no-input --no-warn-script-location --prefix (Split-Path -Parent $python) --timeout 30 --retries 1 --index-url $index @proxyArgs -r $requirements 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) { $installed = $true; break }
    } catch { }
  }
  if (-not $installed -or -not (Test-PythonRequirements $python $requirements)) { throw "python_requirements_installation_failed" }
}

function Install-VerifiedAsset([object]$asset) {
  $target = Join-Path $stageRoot $asset.relativePath
  if ($asset.id -eq "node-embed-amd64" -and (Test-Path -LiteralPath (Join-Path $stageRoot "runtime/node/node.exe") -PathType Leaf)) { return }
  Write-RuntimeProgress "downloading:$($asset.id)"
  $targetDir = Split-Path -Parent $target
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  $tmp = "$target.download"
  $lastError = $null
  foreach ($mirror in $mirrors) {
    $url = $asset.urls.$mirror
    if ([string]::IsNullOrWhiteSpace($url)) { continue }
    try {
      Invoke-ResumableDownload $url $tmp 90
      $hash = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($hash -ne $asset.sha256.ToLowerInvariant()) { throw "sha256 mismatch for $($asset.id) from $mirror" }
      Move-Item -LiteralPath $tmp -Destination $target -Force
      return
    } catch {
      $lastError = $_
      if ($_.Exception.Message -like "sha256 mismatch*") {
        Remove-Item -LiteralPath "$tmp.part" -Force -ErrorAction SilentlyContinue
      }
      Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
  }
  throw "Unable to install $($asset.id): $lastError"
}

function Activate-StagedRuntime() {
  $backupRoot = "$installRootResolved.last-known-good"
  $movedExisting = $false
  $activated = $false
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $installRootResolved) | Out-Null
  try {
    if (Test-Path -LiteralPath $installRootResolved) {
      # Runtime activation swaps the entire data root. Preserve user-owned
      # state (config, database, logs and projects) while replacing only the
      # green runtime payload; otherwise every repair would erase settings.
      foreach ($existing in Get-ChildItem -LiteralPath $installRootResolved -Force) {
        if ($existing.Name -in @("runtime", "skills", "agents")) { continue }
        Copy-Item -LiteralPath $existing.FullName -Destination (Join-Path $stageRoot $existing.Name) -Recurse -Force
      }
      if (Test-Path -LiteralPath $backupRoot) { Remove-Item -LiteralPath $backupRoot -Recurse -Force }
      Move-Item -LiteralPath $installRootResolved -Destination $backupRoot
      $movedExisting = $true
    }
    Move-Item -LiteralPath $stageRoot -Destination $installRootResolved
    $activated = $true
  } catch {
    if ($activated -and (Test-Path -LiteralPath $installRootResolved)) { Remove-Item -LiteralPath $installRootResolved -Recurse -Force -ErrorAction SilentlyContinue }
    if ($movedExisting -and (Test-Path -LiteralPath $backupRoot) -and -not (Test-Path -LiteralPath $installRootResolved)) {
      Move-Item -LiteralPath $backupRoot -Destination $installRootResolved -Force -ErrorAction SilentlyContinue
    }
    throw
  }
}

try {
  $pythonAssets = @($manifest.assets | Where-Object { $_.id -eq "python-nuget-amd64" -and $_.relativePath -eq "runtime/python/python.3.13.6.nupkg" -and $_.extractPath -eq "runtime/python" })
  if ($pythonAssets.Count -ne 1) { throw "runtime_python_distribution_unsupported:cpython_nuget_required" }
  Assert-SufficientDiskSpace
  # An offline runtime archive is self-contained. Avoid copying the packaged
  # runtime/skills into staging before extracting the same bytes again.
  if (-not $OfflineZip) { Seed-BundledRuntime }
  if ($OfflineZip) {
    Write-RuntimeProgress "offline_archive_loaded"
    Expand-SafeZip ([IO.Path]::GetFullPath($OfflineZip)) $stageRoot
  } else {
    Write-RuntimeProgress "downloading_missing_runtime"
    foreach ($asset in $manifest.assets) { Install-VerifiedAsset $asset }
  }
  Expand-ArchiveAssets
  Install-OpenCodePackage -Offline:([bool]$OfflineZip)
  Install-PythonDependencies -Offline:([bool]$OfflineZip)
  foreach ($asset in $manifest.assets) { Assert-Asset $asset $stageRoot }
  Write-RuntimeProgress "activating_runtime"
  Activate-StagedRuntime
  Write-RuntimeProgress "completed"
  Write-Output (ConvertTo-Json @{ status = "ok"; installed = $manifest.assets.id; source = if ($OfflineZip) { "offline" } else { "mirrors" } } -Compress)
} catch {
  if (Test-Path -LiteralPath $stageRoot) {
    try { Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction Stop } catch { }
  }
  throw
}
