param(
  [string]$OutputRoot = "apps/desktop/dist-runtime/runtime"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$destination = Join-Path $root $OutputRoot
New-Item -ItemType Directory -Force -Path (Join-Path $destination "node"), (Join-Path $destination "opencode"), (Join-Path $destination "fonts"), (Join-Path $destination "embedding"), (Join-Path $destination "media") | Out-Null
$embeddingDescriptor = @{ schemaVersion = 1; id = "local-hash-384-v1"; type = "builtin-feature-hash"; dimension = 384; network = $false; description = "Deterministic local feature-hash embedding used for offline hybrid retrieval." } | ConvertTo-Json -Compress
Set-Content -LiteralPath (Join-Path $destination "embedding/local-hash-384-v1.json") -Value $embeddingDescriptor -Encoding utf8
$lancedbDestination = Join-Path $destination "lancedb"
node (Join-Path $root "scripts/stage-lancedb-runtime.mjs") $root $lancedbDestination | Write-Output
$distRoot = Split-Path -Parent $destination
Copy-Item -LiteralPath (Join-Path $root "scripts/install-desktop-runtime.ps1") -Destination (Join-Path $distRoot "install-desktop-runtime.ps1") -Force
Copy-Item -LiteralPath (Join-Path $root "scripts/runtime-manifest-crypto.mjs") -Destination (Join-Path $distRoot "runtime-manifest-crypto.mjs") -Force

function Copy-IfFile([string]$source, [string]$target) {
  if ([string]::IsNullOrWhiteSpace($source) -or -not (Test-Path -LiteralPath $source -PathType Leaf)) { return $false }
  Copy-Item -LiteralPath $source -Destination $target -Force
  return $true
}

$mediaSourceDirectories = @(
  (Join-Path $env:LOCALAPPDATA "CoworkAny/runtime/media"),
  (Join-Path $env:APPDATA "CoworkAny/runtime/media")
)
foreach ($name in @("ffmpeg.exe", "ffprobe.exe")) {
  $target = Join-Path $destination "media/$name"
  if (Test-Path -LiteralPath $target -PathType Leaf) { continue }
  $command = Get-Command $name -ErrorAction SilentlyContinue
  $candidates = @()
  if ($command -and $command.Source) { $candidates += $command.Source }
  foreach ($directory in $mediaSourceDirectories) { $candidates += Join-Path $directory $name }
  foreach ($candidate in $candidates) {
    if ((Copy-IfFile $candidate $target)) { break }
  }
}
$mediaFfmpegStaged = Test-Path -LiteralPath (Join-Path $destination "media/ffmpeg.exe") -PathType Leaf
$mediaFfprobeStaged = Test-Path -LiteralPath (Join-Path $destination "media/ffprobe.exe") -PathType Leaf

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
$nodeTarget = Join-Path $destination "node/node.exe"
$nodeStaged = Copy-IfFile $node $nodeTarget

function Get-OpenCodeVersion([string]$path) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  $previousUserProfile = $env:USERPROFILE
  $probeUserProfile = Join-Path ([IO.Path]::GetTempPath()) ("coworkany-opencode-version-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path (Join-Path $probeUserProfile ".config") | Out-Null
  $previousModelsFetch = $env:OPENCODE_DISABLE_MODELS_FETCH
  $previousAutoUpdate = $env:OPENCODE_DISABLE_AUTOUPDATE
  try {
    # OpenCode's version command creates its config directory. Isolate that
    # side effect so an existing user config cannot turn a valid binary into
    # a false-negative probe (EEXIST).
    $env:USERPROFILE = $probeUserProfile
    $env:OPENCODE_DISABLE_MODELS_FETCH = "true"
    $env:OPENCODE_DISABLE_AUTOUPDATE = "true"
    $output = & $path --version 2>$null
    if ($LASTEXITCODE -eq 0) { return (($output -join "`n").Trim()) }
  } catch { return $null }
  finally {
    $env:USERPROFILE = $previousUserProfile
    $env:OPENCODE_DISABLE_MODELS_FETCH = $previousModelsFetch
    $env:OPENCODE_DISABLE_AUTOUPDATE = $previousAutoUpdate
  }
  return $null
}

function Stage-OpenCode([string[]]$candidates, [string]$target) {
  $foundExecutable = $false
  foreach ($candidate in @($candidates) + @($target)) {
    if ([string]::IsNullOrWhiteSpace($candidate) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    $foundExecutable = $true
    if ((Get-OpenCodeVersion $candidate) -cne "1.18.30") { continue }
    if ([IO.Path]::GetFullPath($candidate) -ne [IO.Path]::GetFullPath($target)) {
      Copy-Item -LiteralPath $candidate -Destination $target -Force
    }
    return $true
  }
  # Do not leave an old executable available for packaging under a new manifest.
  if ($foundExecutable) { throw "opencode_version_required:1.18.30" }
  return $false
}

$opencodeCandidates = @()
if ($node) { $opencodeCandidates += (Join-Path (Split-Path $node -Parent) "node_modules/opencode-ai/bin/opencode.exe") }
$opencodeCandidates += (Join-Path $env:APPDATA "npm/node_modules/opencode-ai/bin/opencode.exe")
$opencodeCandidates += (Join-Path $env:LOCALAPPDATA "npm/node_modules/opencode-ai/bin/opencode.exe")
$opencodeTarget = Join-Path $destination "opencode/opencode.exe"
$opencodeStaged = Stage-OpenCode $opencodeCandidates $opencodeTarget
$fontStaged = Copy-IfFile (Join-Path $env:WINDIR "Fonts/msyh.ttc") (Join-Path $destination "fonts/msyh.ttc")

@{
  schemaVersion = 1
  manifestId = "coworkany-runtime-windows-x64-v1"
  platform = "windows"
  architecture = "x64"
  compatibility = @{ architecture = "x64"; windows = @("10-22H2", "11") }
  integrity = @{ hashAlgorithm = "sha256"; signatureAlgorithm = "ed25519"; signature = $null; required = $false; publicKey = "-----BEGIN PUBLIC KEY-----`nMCowBQYDK2VwAyEAHgKs3hyNJCHJsLN9sle73MWSPew6fOweDLoO1E935JA=`n-----END PUBLIC KEY-----`n" }
  stagedAt = [DateTime]::UtcNow.ToString("o")
  node = @{ staged = $nodeStaged; path = if ($nodeStaged) { "runtime/node/node.exe" } else { $null } }
  opencode = @{ staged = $opencodeStaged; version = "1.18.30"; path = if ($opencodeStaged) { "runtime/opencode/opencode.exe" } else { $null } }
  python = @{ staged = $false; distribution = "cpython-nuget"; version = "3.13.6"; path = "runtime/python/python.exe"; reason = "Official CPython NuGet tools are installed locally by the runtime installer." }
  fonts = @{ staged = $fontStaged; path = if ($fontStaged) { "runtime/fonts/msyh.ttc" } else { $null } }
  lancedb = @{ staged = Test-Path -LiteralPath (Join-Path $destination "lancedb/node_modules/@lancedb/lancedb/dist/index.js") -PathType Leaf; path = "runtime/lancedb/node_modules/@lancedb/lancedb/dist/index.js"; native = "runtime/lancedb/node_modules/@lancedb/lancedb-win32-x64-msvc/lancedb.win32-x64-msvc.node" }
  embedding = @{ staged = $true; path = "runtime/embedding/local-hash-384-v1.json"; model = "local-hash-384-v1"; dimension = 384; network = $false }
  media = @{ staged = $mediaFfmpegStaged -and $mediaFfprobeStaged; path = "runtime/media"; binaries = @("runtime/media/ffmpeg.exe", "runtime/media/ffprobe.exe") }
  assets = @(
    @{
      id = "node-embed-amd64"
      kind = "archive"
      relativePath = "runtime/node/node-v22.22.0-win-x64.zip"
      extractPath = "runtime/node"
      sha256 = "c97fa376d2becdc8863fcd3ca2dd9a83a9f3468ee7ccf7a6d076ec66a645c77a"
      urls = @{
        aliyun = "https://npmmirror.com/mirrors/node/v22.22.0/node-v22.22.0-win-x64.zip"
        tencent = "https://mirrors.cloud.tencent.com/nodejs-release/v22.22.0/node-v22.22.0-win-x64.zip"
        tsinghua = "https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/v22.22.0/node-v22.22.0-win-x64.zip"
        official = "https://nodejs.org/dist/v22.22.0/node-v22.22.0-win-x64.zip"
      }
    },
    @{
      id = "python-nuget-amd64"
      kind = "archive"
      relativePath = "runtime/python/python.3.13.6.nupkg"
      extractPath = "runtime/python"
      # Official x64 package: https://www.nuget.org/packages/python/3.13.6
      # CPython documents the installation in tools/: https://docs.python.org/3.13/using/windows.html#the-nuget-org-packages
      bytes = 14170995
      sha256 = "cc1d4850a31f18a5c5d52007c248a99f1c360c96886f6fd2e324a55dc1d1967b"
      urls = @{
        official = "https://api.nuget.org/v3-flatcontainer/python/3.13.6/python.3.13.6.nupkg"
      }
    }
  )
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destination "runtime-manifest.json") -Encoding utf8

$signingKey = $env:COWORKANY_RUNTIME_SIGNING_KEY
if (-not [string]::IsNullOrWhiteSpace($signingKey)) {
  if (-not (Test-Path -LiteralPath $signingKey -PathType Leaf)) { throw "runtime_manifest_signing_key_missing" }
  $manifest = Join-Path $destination "runtime-manifest.json"
  $signedManifest = Join-Path $destination "runtime-manifest.signed.json"
  & node (Join-Path $root "scripts/runtime-manifest-crypto.mjs") sign $manifest $signingKey $signedManifest
  if ($LASTEXITCODE -ne 0) { throw "runtime_manifest_sign_failed" }
  Move-Item -LiteralPath $signedManifest -Destination $manifest -Force
}
