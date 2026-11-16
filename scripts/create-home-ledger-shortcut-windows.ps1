$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath("DesktopDirectory")
$target = Join-Path $desktop "Home Ledger Server.lnk"
if (Test-Path -LiteralPath $target) {
    $existing = (New-Object -ComObject WScript.Shell).CreateShortcut($target)
    if (($existing.WorkingDirectory -eq $root) -and
        ($existing.Arguments -like "*start-home-ledger-server-windows.ps1*")) {
        Write-Host "The Home Ledger Server shortcut already points to this installation; leaving it unchanged."
        exit 0
    }
    throw "A Home Ledger Server shortcut already exists for another folder. It was left unchanged; check its database settings before replacing it."
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
