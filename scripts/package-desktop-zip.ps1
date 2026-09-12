param(
  [string]$ReleaseDir = "apps/desktop/src-tauri/target/release",
  [string]$OutputDir = ".artifacts/desktop-release",
  [switch]$Portable
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$release = (Resolve-Path (Join-Path $root $ReleaseDir)).Path
$output = [IO.Path]::GetFullPath((Join-Path $root $OutputDir))
$mode = if ($Portable) { "portable" } else { "normal" }
$packageName = "CoworkAny-Windows-x64-$mode"
$stage = Join-Path ([IO.Path]::GetTempPath()) ("coworkany-package-" + [guid]::NewGuid().ToString("N"))
$packageRoot = Join-Path $stage $packageName
$zip = Join-Path $output "$packageName.zip"

function Assert-DesktopPackageArchive {
  param(
    [string]$ArchivePath,
    [string]$PackageName,
    [string]$ExecutablePath,
    [string]$RuntimePath,
    [switch]$ExpectPortable
  )

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    function Find-ArchiveEntry([System.IO.Compression.ZipArchive]$ZipArchive, [string]$EntryName) {
      $normalized = $EntryName.Replace('\', '/')
      return $ZipArchive.Entries | Where-Object { $_.FullName.Replace('\', '/') -eq $normalized } | Select-Object -First 1
    }
    $requiredEntries = @(
      "$PackageName/CoworkAny.exe",
      "$PackageName/README.txt",
      "$PackageName/_up_/dist-runtime/host.mjs",
      "$PackageName/_up_/dist-runtime/knowledge.mjs",
      "$PackageName/_up_/dist-runtime/skill-catalog.json",
      "$PackageName/_up_/dist-runtime/runtime/runtime-manifest.json",
      "$PackageName/_up_/dist-runtime/install-desktop-runtime.ps1",
      "$PackageName/_up_/dist-runtime/runtime-manifest-crypto.mjs"
    )
    if ($ExpectPortable) { $requiredEntries += "$PackageName/portable.flag" }
    foreach ($entryName in $requiredEntries) {
      if ($null -eq (Find-ArchiveEntry $archive $entryName)) { throw "package archive missing required entry: $entryName" }
    }
    if (-not $ExpectPortable -and $null -ne (Find-ArchiveEntry $archive "$PackageName/portable.flag")) { throw "normal package must not contain portable.flag" }

    $expectedLengths = @{
      "$PackageName/CoworkAny.exe" = (Get-Item -LiteralPath $ExecutablePath).Length
      "$PackageName/_up_/dist-runtime/host.mjs" = (Get-Item -LiteralPath (Join-Path $RuntimePath "host.mjs")).Length
      "$PackageName/_up_/dist-runtime/knowledge.mjs" = (Get-Item -LiteralPath (Join-Path $RuntimePath "knowledge.mjs")).Length
      "$PackageName/_up_/dist-runtime/skill-catalog.json" = (Get-Item -LiteralPath (Join-Path $RuntimePath "skill-catalog.json")).Length
      "$PackageName/_up_/dist-runtime/install-desktop-runtime.ps1" = (Get-Item -LiteralPath (Join-Path $RuntimePath "install-desktop-runtime.ps1")).Length
      "$PackageName/_up_/dist-runtime/runtime-manifest-crypto.mjs" = (Get-Item -LiteralPath (Join-Path $RuntimePath "runtime-manifest-crypto.mjs")).Length
    }
    foreach ($entryName in $expectedLengths.Keys) {
      $entry = Find-ArchiveEntry $archive $entryName
      if ($entry.Length -ne $expectedLengths[$entryName]) {
        throw "package archive has stale content: $entryName expected $($expectedLengths[$entryName]) bytes, found $($entry.Length)"
      }
    }
  } finally {
    $archive.Dispose()
  }
}

New-Item -ItemType Directory -Force -Path $packageRoot, $output | Out-Null
try {
  $executable = Join-Path $release "coworkany.exe"
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "release executable missing: $executable" }
  Copy-Item -LiteralPath $executable -Destination (Join-Path $packageRoot "CoworkAny.exe") -Force

  Get-ChildItem -LiteralPath $release -Filter "*.dll" -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $packageRoot $_.Name) -Force
  }
  $resources = Join-Path $release "_up_"
  $distRuntime = Join-Path $resources "dist-runtime"
  if (-not (Test-Path -LiteralPath $distRuntime -PathType Container)) { throw "Tauri runtime resources missing: $distRuntime" }
  New-Item -ItemType Directory -Force -Path (Join-Path $packageRoot "_up_") | Out-Null
  $packageRuntime = Join-Path $packageRoot "_up_\dist-runtime"
  New-Item -ItemType Directory -Force -Path $packageRuntime | Out-Null
  foreach ($name in @("host.mjs", "knowledge.mjs", "skill-catalog.json", "agency-agent-manifest.json", "install-desktop-runtime.ps1", "runtime-manifest-crypto.mjs")) {
    $source = Join-Path $distRuntime $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Tauri runtime control resource missing: $source" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $packageRuntime $name) -Force
  }
  foreach ($directory in @("skills", "agents")) {
    $source = Join-Path $distRuntime $directory
    if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "Tauri runtime catalog missing: $source" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $packageRuntime $directory) -Recurse -Force
  }
  $manifest = Join-Path $distRuntime "runtime\runtime-manifest.json"
  if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw "Tauri runtime manifest missing: $manifest" }
  if ($Portable) {
    # Keep the bundled runtime payload in the green package. The installer can
    # still download missing Node/Python assets, but OpenCode, media tools,
    # fonts, LanceDB, and the local embedding model must be available for the
    # post-install runtime probe to pass on an offline or restricted machine.
    $bundledRuntime = Join-Path $distRuntime "runtime"
    Copy-Item -LiteralPath $bundledRuntime -Destination (Join-Path $packageRuntime "runtime") -Recurse -Force
    Set-Content -LiteralPath (Join-Path $packageRoot "portable.flag") -Value "" -Encoding utf8
  } else {
    New-Item -ItemType Directory -Force -Path (Join-Path $packageRuntime "runtime") | Out-Null
    Copy-Item -LiteralPath $manifest -Destination (Join-Path $packageRuntime "runtime\runtime-manifest.json") -Force
  }
  Set-Content -LiteralPath (Join-Path $packageRoot "README.txt") -Encoding utf8 -Value @"
CoworkAny Windows green package

Run CoworkAny.exe.
Supported targets: Windows 10 22H2 and Windows 11, x64.
Mode: $mode
Normal mode stores application data in %LOCALAPPDATA%\CoworkAny.
Portable mode stores application data in the data\ directory beside the executable.
Upgrades are manual: close CoworkAny, back up the data directory in portable mode, then replace the ZIP contents. The app never downloads or replaces itself automatically.
The portable package includes config.json and may include a plaintext API key; protect copied archives.
External Obsidian Vault folders are not copied; the configured Vault path must remain available or be relocated after copying.
The system WebView2 runtime is not copied; the first launch probes or repairs it on the target machine.
"@

if (Test-Path -LiteralPath $zip -PathType Leaf) { Remove-Item -LiteralPath $zip -Force }
$tarCommand = Get-Command tar.exe -ErrorAction SilentlyContinue
if ($null -ne $tarCommand) {
  # Windows ships bsdtar; it is materially faster and more reliable than
  # Compress-Archive for the 270 MB green package on large runtime trees.
  & $tarCommand.Source -a -c -f $zip -C $stage $packageName
  if ($LASTEXITCODE -ne 0) { throw "desktop_package_tar_failed:$LASTEXITCODE" }
} else {
  Compress-Archive -LiteralPath $packageRoot -DestinationPath $zip -CompressionLevel Optimal
}
Assert-DesktopPackageArchive -ArchivePath $zip -PackageName $packageName -ExecutablePath $executable -RuntimePath $distRuntime -ExpectPortable:$Portable
Get-Item -LiteralPath $zip | Select-Object FullName, Length, LastWriteTime
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
