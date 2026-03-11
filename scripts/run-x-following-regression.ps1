$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$desktopDir = Join-Path $repoRoot 'desktop'
$sidecarDir = Join-Path $repoRoot 'sidecar'

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory
    )

    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    Push-Location $WorkingDirectory
    try {
        Invoke-Expression $Command
        if ($LASTEXITCODE -ne 0) {
            throw "$Name failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

Invoke-Step -Name 'Sidecar X following regression' -Command 'npm run test:x-following' -WorkingDirectory $sidecarDir
Invoke-Step -Name 'Desktop X following logged-in E2E' -Command 'npx playwright test tests/x-following-posts-query-e2e.test.ts' -WorkingDirectory $desktopDir
Invoke-Step -Name 'Desktop X following suspend E2E' -Command 'npx playwright test tests/x-following-posts-suspend-e2e.test.ts' -WorkingDirectory $desktopDir

Write-Host ""
Write-Host 'X following regression suite passed.' -ForegroundColor Green
