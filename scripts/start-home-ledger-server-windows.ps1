$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Install Node.js 24.16 or newer on Node 24 LTS, then reopen PowerShell."
}
& node (Join-Path $PSScriptRoot "start-home-ledger-server.mjs")
if ($LASTEXITCODE -ne 0) { throw "Home Ledger exited with code $LASTEXITCODE." }
