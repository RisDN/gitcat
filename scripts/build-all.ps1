[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipVerify,
    [switch]$NoBundle
)

$ErrorActionPreference = "Stop"

$taskUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$taskMachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$env:Path = "$taskUserPath;$taskMachinePath"

$repoRoot = Split-Path -Parent $PSScriptRoot
$desktopDir = Join-Path $repoRoot "apps\desktop"

$taskCargo = (Get-Command cargo.exe -ErrorAction Stop).Source
$taskNpm = (Get-Command npm.cmd -ErrorAction Stop).Source

$stepIndex = 0
$startedAt = Get-Date

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Exe,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$WorkingDirectory = $repoRoot
    )

    $script:stepIndex++
    Write-Host ""
    Write-Host "==> [$script:stepIndex] $Name" -ForegroundColor Cyan
    Write-Host "    $Exe $($Arguments -join ' ')  (cwd: $WorkingDirectory)" -ForegroundColor DarkGray

    Push-Location $WorkingDirectory
    try {
        & $Exe @Arguments
        $code = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    if ($code -ne 0) {
        Write-Host "FAILED: $Name (exit $code)" -ForegroundColor Red
        exit $code
    }
}

if (-not $SkipInstall) {
    $installArgs = if (Test-Path (Join-Path $desktopDir "package-lock.json")) { @("ci") } else { @("install") }
    Invoke-Step -Name "Frontend dependencies (npm $installArgs)" -Exe $taskNpm -Arguments $installArgs -WorkingDirectory $desktopDir
}

if (-not $SkipVerify) {
    Invoke-Step -Name "cargo fmt --all --check" -Exe $taskCargo -Arguments @("fmt", "--all", "--check")
    Invoke-Step -Name "cargo clippy -D warnings" -Exe $taskCargo -Arguments @("clippy", "--workspace", "--all-targets", "--", "-D", "warnings")
    Invoke-Step -Name "cargo test --workspace" -Exe $taskCargo -Arguments @("test", "--workspace")
    Invoke-Step -Name "TypeScript typecheck" -Exe $taskNpm -Arguments @("run", "typecheck") -WorkingDirectory $desktopDir
}

$tauriArgs = @("run", "tauri", "build")
if ($NoBundle) { $tauriArgs += @("--", "--no-bundle") }
Invoke-Step -Name "Tauri release build" -Exe $taskNpm -Arguments $tauriArgs -WorkingDirectory $desktopDir

$elapsed = (Get-Date) - $startedAt
Write-Host ""
Write-Host "All build steps completed in $([math]::Round($elapsed.TotalMinutes, 1)) min." -ForegroundColor Green
Write-Host "  web:      apps/desktop/dist"
Write-Host "  binary:   target/release/gitcat-desktop.exe"
if (-not $NoBundle) {
    Write-Host "  bundles:  target/release/bundle"
}
exit 0
