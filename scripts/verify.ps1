$ErrorActionPreference = "Stop"

# Refresh PATH for shells started before rustup/WinLibs installation.
$taskUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$taskMachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$env:Path = "$taskUserPath;$taskMachinePath"

$taskCargo = (Get-Command cargo.exe -ErrorAction Stop).Source

& $taskCargo fmt --all --check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $taskCargo clippy --workspace --all-targets -- -D warnings
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $taskCargo test --workspace
exit $LASTEXITCODE

