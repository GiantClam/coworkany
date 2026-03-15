param(
    [string]$Owner = "anthropics",
    [string]$Repo = "skills",
    [string]$RepoPath = "skills/skill-creator",
    [string]$Ref = "main",
    [string]$TargetPath = ".agent/skills/skill-creator"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-GitHubContents {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ApiPath
    )

    $url = "https://api.github.com/repos/$Owner/$Repo/contents/$ApiPath" + "?ref=$Ref"
    $json = & curl.exe -sSL $url -H "User-Agent: CoworkAny"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to fetch $url"
    }

    return $json | ConvertFrom-Json
}

function Sync-GitHubDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RemotePath,
        [Parameter(Mandatory = $true)]
        [string]$LocalPath
    )

    New-Item -ItemType Directory -Force -Path $LocalPath | Out-Null

    $entries = Get-GitHubContents -ApiPath $RemotePath
    foreach ($entry in $entries) {
        $destination = Join-Path $LocalPath $entry.name
        if ($entry.type -eq "dir") {
            Sync-GitHubDirectory -RemotePath $entry.path -LocalPath $destination
            continue
        }

        if ($entry.type -eq "file" -and $entry.download_url) {
            & curl.exe -sSL $entry.download_url -H "User-Agent: CoworkAny" -o $destination
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to download $($entry.download_url)"
            }
        }
    }
}

$targetRoot = Resolve-Path "." | Select-Object -ExpandProperty Path
$targetDir = Join-Path $targetRoot $TargetPath
$parentDir = Split-Path -Parent $targetDir

New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
if (Test-Path $targetDir) {
    Remove-Item -Recurse -Force $targetDir
}

Sync-GitHubDirectory -RemotePath $RepoPath -LocalPath $targetDir
Write-Host "Synced official skill-creator to $targetDir"
