Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SkillMappings = @(
    @{ Name = "docx"; Repo = "anthropics/skills"; RepoPath = "skills/docx"; Ref = "main" },
    @{ Name = "frontend-design"; Repo = "anthropics/skills"; RepoPath = "skills/frontend-design"; Ref = "main" },
    @{ Name = "mcp-builder"; Repo = "anthropics/skills"; RepoPath = "skills/mcp-builder"; Ref = "main" },
    @{ Name = "pdf"; Repo = "anthropics/skills"; RepoPath = "skills/pdf"; Ref = "main" },
    @{ Name = "pptx"; Repo = "anthropics/skills"; RepoPath = "skills/pptx"; Ref = "main" },
    @{ Name = "skill-creator"; Repo = "anthropics/skills"; RepoPath = "skills/skill-creator"; Ref = "main" },
    @{ Name = "theme-factory"; Repo = "anthropics/skills"; RepoPath = "skills/theme-factory"; Ref = "main" },
    @{ Name = "webapp-testing"; Repo = "anthropics/skills"; RepoPath = "skills/webapp-testing"; Ref = "main" },
    @{ Name = "xlsx"; Repo = "anthropics/skills"; RepoPath = "skills/xlsx"; Ref = "main" },
    @{ Name = "agent-sdk-dev"; Repo = "anthropics/claude-plugins-official"; RepoPath = "plugins/agent-sdk-dev"; Ref = "main" },
    @{ Name = "code-review"; Repo = "anthropics/claude-plugins-official"; RepoPath = "plugins/code-review"; Ref = "main" },
    @{ Name = "code-simplifier"; Repo = "anthropics/claude-plugins-official"; RepoPath = "plugins/code-simplifier"; Ref = "main" },
    @{ Name = "feature-dev"; Repo = "anthropics/claude-plugins-official"; RepoPath = "plugins/feature-dev"; Ref = "main" },
    @{ Name = "plugin-dev"; Repo = "anthropics/claude-plugins-official"; RepoPath = "plugins/plugin-dev"; Ref = "main" },
    @{ Name = "pr-review-toolkit"; Repo = "anthropics/claude-plugins-official"; RepoPath = "plugins/pr-review-toolkit"; Ref = "main" },
    @{ Name = "pyright-lsp"; Repo = "anthropics/claude-plugins-official"; RepoPath = "plugins/pyright-lsp"; Ref = "main" },
    @{ Name = "rust-analyzer-lsp"; Repo = "anthropics/claude-plugins-official"; RepoPath = "plugins/rust-analyzer-lsp"; Ref = "main" },
    @{ Name = "security-guidance"; Repo = "anthropics/claude-plugins-official"; RepoPath = "plugins/security-guidance"; Ref = "main" },
    @{ Name = "typescript-lsp"; Repo = "anthropics/claude-plugins-official"; RepoPath = "plugins/typescript-lsp"; Ref = "main" },
    @{ Name = "brainstorming"; Repo = "obra/superpowers"; RepoPath = "skills/brainstorming"; Ref = "main" },
    @{ Name = "dispatching-parallel-agents"; Repo = "obra/superpowers"; RepoPath = "skills/dispatching-parallel-agents"; Ref = "main" },
    @{ Name = "executing-plans"; Repo = "obra/superpowers"; RepoPath = "skills/executing-plans"; Ref = "main" },
    @{ Name = "finishing-a-development-branch"; Repo = "obra/superpowers"; RepoPath = "skills/finishing-a-development-branch"; Ref = "main" },
    @{ Name = "receiving-code-review"; Repo = "obra/superpowers"; RepoPath = "skills/receiving-code-review"; Ref = "main" },
    @{ Name = "requesting-code-review"; Repo = "obra/superpowers"; RepoPath = "skills/requesting-code-review"; Ref = "main" },
    @{ Name = "subagent-driven-development"; Repo = "obra/superpowers"; RepoPath = "skills/subagent-driven-development"; Ref = "main" },
    @{ Name = "systematic-debugging"; Repo = "obra/superpowers"; RepoPath = "skills/systematic-debugging"; Ref = "main" },
    @{ Name = "test-driven-development"; Repo = "obra/superpowers"; RepoPath = "skills/test-driven-development"; Ref = "main" },
    @{ Name = "using-git-worktrees"; Repo = "obra/superpowers"; RepoPath = "skills/using-git-worktrees"; Ref = "main" },
    @{ Name = "using-superpowers"; Repo = "obra/superpowers"; RepoPath = "skills/using-superpowers"; Ref = "main" },
    @{ Name = "verification-before-completion"; Repo = "obra/superpowers"; RepoPath = "skills/verification-before-completion"; Ref = "main" },
    @{ Name = "writing-plans"; Repo = "obra/superpowers"; RepoPath = "skills/writing-plans"; Ref = "main" },
    @{ Name = "writing-skills"; Repo = "obra/superpowers"; RepoPath = "skills/writing-skills"; Ref = "main" },
    @{ Name = "planning-with-files"; Repo = "OthmanAdi/planning-with-files"; RepoPath = "skills/planning-with-files"; Ref = "master" }
)

function Get-RepoUrl {
    param([Parameter(Mandatory = $true)][string]$Repo)
    return "https://github.com/$Repo.git"
}

function Ensure-ClonedRepo {
    param(
        [Parameter(Mandatory = $true)][string]$Repo,
        [Parameter(Mandatory = $true)][string]$Ref,
        [Parameter(Mandatory = $true)][string]$CacheRoot
    )

    $safeName = $Repo.Replace("/", "__")
    $targetDir = Join-Path $CacheRoot $safeName

    if (Test-Path $targetDir) {
        return $targetDir
    }

    $repoUrl = Get-RepoUrl -Repo $Repo
    & git clone --depth 1 --branch $Ref $repoUrl $targetDir | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to clone $repoUrl@$Ref"
    }

    return $targetDir
}

function Copy-SkillDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$SourceDir,
        [Parameter(Mandatory = $true)][string]$TargetDir
    )

    if (-not (Test-Path $SourceDir)) {
        throw "Source directory not found: $SourceDir"
    }

    if (Test-Path $TargetDir) {
        Remove-Item -Recurse -Force $TargetDir
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TargetDir) | Out-Null
    Copy-Item -Recurse -Force $SourceDir $TargetDir
}

$root = Resolve-Path "." | Select-Object -ExpandProperty Path
$skillsRoot = Join-Path $root ".agent/skills"
$cacheRoot = Join-Path $root ".tmp/skill-sync-cache"

if (-not (Test-Path $skillsRoot)) {
    throw "Skills root not found: $skillsRoot"
}

if (Test-Path $cacheRoot) {
    Remove-Item -Recurse -Force $cacheRoot
}
New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null

$updated = New-Object System.Collections.Generic.List[string]
$skipped = New-Object System.Collections.Generic.List[string]

foreach ($mapping in $SkillMappings) {
    $targetDir = Join-Path $skillsRoot $mapping.Name
    if (-not (Test-Path $targetDir)) {
        $skipped.Add($mapping.Name)
        continue
    }

    $repoDir = Ensure-ClonedRepo -Repo $mapping.Repo -Ref $mapping.Ref -CacheRoot $cacheRoot
    $sourceDir = if ([string]::IsNullOrWhiteSpace($mapping.RepoPath)) {
        $repoDir
    } else {
        Join-Path $repoDir $mapping.RepoPath
    }

    Copy-SkillDirectory -SourceDir $sourceDir -TargetDir $targetDir
    $updated.Add($mapping.Name)
    Write-Host "Updated $($mapping.Name) from $($mapping.Repo)/$($mapping.RepoPath)@$($mapping.Ref)"
}

Write-Host ""
Write-Host "Updated skills ($($updated.Count)):"
$updated | Sort-Object | ForEach-Object { Write-Host " - $_" }
Write-Host ""
Write-Host "Skipped skills not present locally ($($skipped.Count)):"
$skipped | Sort-Object | ForEach-Object { Write-Host " - $_" }
