$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath("DesktopDirectory")
$target = Join-Path $desktop "Home Ledger Server.lnk"
if (Test-Path -LiteralPath $target) {
    throw "A Home Ledger Server shortcut already exists. Keep it if it contains custom database settings; otherwise rename it before running this installer."
}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($target)
$shortcut.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$launcher = Join-Path $PSScriptRoot "start-home-ledger-server-windows.ps1"
$shortcut.Arguments = "-NoLogo -NoProfile -NoExit -ExecutionPolicy Bypass -File `"$launcher`""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = (Join-Path $root "artifacts\home-ledger-mobile\assets\images\home-ledger.ico") + ",0"
$shortcut.Description = "Start the normal-time Home Ledger household server"
$shortcut.Save()
Write-Host "Created $target"
Write-Host "The shortcut uses the standard data location. Keep existing custom database/recovery settings when updating an existing household."
