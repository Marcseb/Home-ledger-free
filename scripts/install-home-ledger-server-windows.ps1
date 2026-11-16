param([switch]$CheckOnly)
$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Install Node.js 24.16 or newer (Node 24 LTS recommended), reopen PowerShell, and run this script again."
}

$nodeArgs = @((Join-Path $PSScriptRoot "install-home-ledger-server.mjs"), "windows")
if ($CheckOnly) { $nodeArgs += "--check-only" }
& node @nodeArgs
if ($LASTEXITCODE -ne 0) {
    throw "Home Ledger installation failed with exit code $LASTEXITCODE."
}
