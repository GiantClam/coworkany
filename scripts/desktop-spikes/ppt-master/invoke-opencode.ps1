[CmdletBinding()]
param(
    [string]$Model = 'openai/gpt-6.1-sol',
    [ValidateRange(30, 3600)][int]$TimeoutSeconds = 600
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = $PSScriptRoot
$runtime = Join-Path $root '.runtime'
$upstreamCommit = '4e6ecbcb0dc079efebd3c79b775c0f02581509fe'
$upstream = Join-Path $runtime "ppt-master-$upstreamCommit"
$privatePython = Join-Path $runtime 'venv\Scripts\python.exe'
$skillDir = Join-Path $upstream 'skills\ppt-master'
$imagePath = Join-Path $root 'work\assets\private-font-evidence.png'
$openCodeShim = (Get-Command 'opencode.cmd' -CommandType Application -ErrorAction Stop).Source
$openCodeBinaryCandidate = Join-Path (Split-Path -Parent $openCodeShim) 'node_modules\opencode-ai\bin\opencode.exe'
$openCode = if (Test-Path -LiteralPath $openCodeBinaryCandidate) {
    (Resolve-Path -LiteralPath $openCodeBinaryCandidate).Path
} else {
    $openCodeShim
}

foreach ($required in @($privatePython, $skillDir, $imagePath)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Missing setup prerequisite: $required"
    }
}

$runId = "$(Get-Date -Format 'yyyyMMddHHmmss')-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$projectName = "windows-feasibility-$runId"
$projectRoot = Join-Path $upstream "projects\$projectName"
$prompt = Get-Content -LiteralPath (Join-Path $root 'prompt.zh-CN.md') -Raw -Encoding utf8
$prompt = $prompt.Replace('__PRIVATE_PYTHON__', $privatePython.Replace('\', '/'))
$prompt = $prompt.Replace('__SKILL_DIR__', $skillDir.Replace('\', '/'))
$prompt = $prompt.Replace('__IMAGE_PATH__', $imagePath.Replace('\', '/'))
$prompt = $prompt.Replace('__PROJECT_NAME__', $projectName)

$evidenceDir = Join-Path $root 'evidence'
New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null
$raw = Join-Path ([IO.Path]::GetTempPath()) "coworkany-ppt-master-$runId.raw.jsonl"
$started = [DateTimeOffset]::UtcNow
$process = $null
$timedOut = $false
$processTreeTerminated = $false
$stdout = ''
$stderr = ''
$exitCode = 1

try {
    $processInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $processInfo.FileName = $openCode
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    foreach ($argument in @(
        'run', '--auto', '--format', 'json', '--model', $Model,
        '--title', "ppt-master-windows-feasibility-$runId", '--dir', $upstream, $prompt
    )) {
        [void]$processInfo.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $processInfo
    [void]$process.Start()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
    if ($timedOut) {
        $process.Kill($true)
        $process.WaitForExit()
        $processTreeTerminated = $process.HasExited
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    $exitCode = if ($timedOut) { 124 } else { $process.ExitCode }
    [IO.File]::WriteAllText($raw, ($stdout + $stderr), [Text.UTF8Encoding]::new($false))

    $redacted = Get-Content -LiteralPath $raw -Raw -Encoding utf8
    foreach ($pair in @(
        @($env:USERPROFILE, '<USERPROFILE>'),
        @($root, '<SPIKE_ROOT>'),
        @($upstream, '<UPSTREAM_ROOT>')
    )) {
        if ($pair[0]) { $redacted = $redacted.Replace([string]$pair[0], [string]$pair[1], [StringComparison]::OrdinalIgnoreCase) }
    }
    $redacted = [regex]::Replace($redacted, '(?i)(authorization\s*[:=]\s*(?:bearer|basic)\s+)[^\s,"}]+', '$1<REDACTED>')
    $redacted = [regex]::Replace($redacted, '(?i)(["'']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["'']?\s*[:=]\s*["'']?)[^\s,"''}]+', '$1<REDACTED>')
    $redacted = [regex]::Replace($redacted, '(?i)sk-[a-z0-9_-]{12,}', '<REDACTED>')
    $redacted = $redacted.Replace('\', '/')
    [IO.File]::WriteAllText((Join-Path $evidenceDir 'opencode-events.redacted.jsonl'), $redacted, [Text.UTF8Encoding]::new($false))
} finally {
    if ($process -and -not $process.HasExited) {
        $process.Kill($true)
        $process.WaitForExit()
        $processTreeTerminated = $process.HasExited
    }
    Remove-Item -LiteralPath $raw -Force -ErrorAction SilentlyContinue
}

$finished = [DateTimeOffset]::UtcNow
$svgCount = @(Get-ChildItem -LiteralPath $projectRoot -Filter '*.svg' -File -Recurse -ErrorAction SilentlyContinue).Count
$pptxCount = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'exports') -Filter '*.pptx' -File -ErrorAction SilentlyContinue).Count
$summary = [ordered]@{
    schema_version = 1
    run_id = $runId
    project_name = $projectName
    started_utc = $started.ToString('o')
    finished_utc = $finished.ToString('o')
    duration_ms = [Math]::Round(($finished - $started).TotalMilliseconds)
    exit_code = $exitCode
    timeout_seconds = $TimeoutSeconds
    timed_out = $timedOut
    process_tree_terminated = $processTreeTerminated
    svg_count_at_finish = $svgCount
    pptx_count_at_finish = $pptxCount
    gate_pass = (-not $timedOut -and $exitCode -eq 0 -and $pptxCount -gt 0)
    model = $Model
    opencode_version = (& $openCode --version 2>&1 | Out-String).Trim()
    upstream_commit = $upstreamCommit
    railway_worker_used = $false
}
$summary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $evidenceDir 'opencode-run.json') -Encoding utf8
exit $exitCode
