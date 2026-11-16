# Home Ledger Free server — Linux, Windows and macOS

The Free app connects to a Home Ledger server running on a trusted home network.
The computer must stay awake and the server terminal must remain open. Do not
expose the server port to the public internet or configure router port forwarding.
The recommended web-page setup downloads one OS-specific launcher. Run the
launcher to download the fixed tagged source ZIP and its checksum, verify the
ZIP, extract it, and create a desktop shortcut. It does not start the server or
change firewall settings.

## Recommended web setup

Choose the operating system of the computer that will host the server:

- **Windows:** download `home-ledger-free-server-setup-windows.ps1`, then run
  `powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\Downloads\home-ledger-free-server-setup-windows.ps1"`
  from PowerShell.
- **macOS:** download `home-ledger-free-server-setup-macos.sh`, then run
  `bash ~/Downloads/home-ledger-free-server-setup-macos.sh` from Terminal.
- **Linux:** download `home-ledger-free-server-setup-linux.sh`, then run
  `bash ~/Downloads/home-ledger-free-server-setup-linux.sh` from Terminal.

The launcher downloads the archive and `.sha256` file from the same exact
`free-v<version>` GitHub Release. It verifies the ZIP before extraction; a
mismatch stops setup. Node.js 24.16 or newer is required. If it is missing or
too old, the launcher offers the official Node.js download page and asks you to
rerun setup after updating Node.

If pnpm 10.26.1 is missing or a different version, the setup asks before
downloading the pinned version into the server folder. It does not install pnpm
globally. It does not make firewall changes. Keep any existing shortcut with
custom database settings. When updating an installation created by this setup,
stop its server first; the existing shortcut is left unchanged if it points to
the same managed folder. An unrelated shortcut or unmanaged folder is never
overwritten.

Use the manual installation instructions below if you prefer to download and
verify the ZIP yourself.

## Requirements

- Node.js 24.16 or newer on Node 24 LTS; the launcher offers the official download page if needed
- pnpm 10.26.1; the launcher can download this version into the server folder after confirmation
- Internet access for the first dependency installation
- No Android Studio or JDK is needed to run the server

To check an existing Node.js and pnpm installation in Terminal or PowerShell:

```text
node --version
pnpm --version
```

The launcher never installs pnpm globally. The manual installer asks before it
downloads pnpm locally when the pinned version is not available.

## Install and start

Download the ZIP and its `.sha256` file from the **same tagged GitHub Release**.
Check that the release tag matches the edition and version you intend to install.
Verify the ZIP checksum **before extracting**; do not continue if it does not match.

Use the actual ZIP asset name from that release in these examples.

Linux:

```bash
sha256sum -c SERVER-ZIP-NAME.zip.sha256
```

macOS:

```bash
shasum -a 256 -c SERVER-ZIP-NAME.zip.sha256
```

Windows PowerShell:

```powershell
$zip = ".\SERVER-ZIP-NAME.zip"
$checksum = "$zip.sha256"
$expected = ((Get-Content $checksum -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "Checksum mismatch. Do not extract this ZIP." }
"Checksum verified."
```

Replace the sample filename with the exact release asset name. After successful
verification, extract the ZIP to a project folder. The root `package.json`,
`pnpm-workspace.yaml`, `artifacts/`, and `scripts/` must be directly inside it.
Open Terminal (Linux/macOS) or PowerShell (Windows) in that folder and run the
matching setup script:

| System | Setup command |
| --- | --- |
| Ubuntu / GNOME Linux | `bash scripts/install-home-ledger-server-linux.sh` |
| Windows PowerShell | `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-home-ledger-server-windows.ps1` |
| macOS Terminal | `bash scripts/install-home-ledger-server-macos.sh` |

The script installs dependencies and creates the **Home Ledger Server** desktop
shortcut. It does not start the server. Open that shortcut when ready; its
terminal remains open while the normal-time server runs on port 5000. Press
Ctrl+C to stop. The Linux shortcut uses GNOME Terminal. The Windows execution
policy override applies only to this command and does not change machine policy.
Linux users may also use `pnpm run server:linux`.

If Node.js 24.16 or newer is missing, install it from the
[official Node.js download page](https://nodejs.org/en/download), reopen the
terminal, and rerun setup. If pnpm 10.26.1 is missing or mismatched, setup asks
before installing it locally under `.tools/pnpm`; it never changes global pnpm.
The setup does not change the system firewall or machine-wide PowerShell policy.

To check prerequisites without installing dependencies or creating the shortcut,
append `--check-only` to either Bash command or add `-CheckOnly` to the
PowerShell command.

Check the computer in a browser at `http://localhost:5000/api/healthz`; it
should return `"status":"ok"`.

## Desktop shortcut

The setup script creates the shortcut. To recreate it after moving the project
folder, run the appropriate command from the extracted project folder:

| System | Command |
| --- | --- |
| Ubuntu / GNOME | `bash scripts/create-home-ledger-shortcut-linux.sh` |
| Windows PowerShell | `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\create-home-ledger-shortcut-windows.ps1` |
| macOS Terminal | `bash scripts/create-home-ledger-shortcut-macos.sh` |

The shortcut opens a visible terminal and uses the Home Ledger icon. Ubuntu may
require **Allow Launching**; Windows may ask to allow the app on a private
network; macOS may ask for permission to control Terminal. Do not enable public
network access.

If you move the project folder, recreate the shortcut after checking for custom
database settings. Moving the program files does not move the household
database. The scripts keep a shortcut already pointing to the same managed
folder, and refuse to replace an unrelated shortcut.

## Household data locations

| System | Database | Recovery keyring |
| --- | --- | --- |
| Linux | `${XDG_DATA_HOME:-$HOME/.local/share}/home-ledger/home-ledger.sqlite` | `${XDG_CONFIG_HOME:-$HOME/.config}/home-ledger/recovery-keyring.json` |
| Windows | `%LOCALAPPDATA%\Home Ledger\home-ledger.sqlite` | `%LOCALAPPDATA%\Home Ledger\home-ledger\recovery-keyring.json` |
| macOS | `~/Library/Application Support/Home Ledger/home-ledger.sqlite` | `~/Library/Application Support/Home Ledger/home-ledger/recovery-keyring.json` |

Linux keeps its existing XDG paths. Absolute `BUDGET_DB_PATH`,
`XDG_DATA_HOME`, and `XDG_CONFIG_HOME` overrides remain supported. Keep the same
path settings when restarting or restoring a household. The live SQLite file
is plaintext at rest; enable full-disk encryption and use a protected desktop
account.

## Connect phones

Connect the phone to the same trusted Wi-Fi network. In Home Ledger, choose
**Find server** or enter the computer's private LAN address, for example
`http://192.168.1.25:5000`. Replace the sample address with the computer's
actual address. Allow Node.js through the firewall on the private/home network
only. Do not use router port forwarding.

The first person sets up the household and becomes Master. The Master creates
single-use invitations for other people or devices. To create a local Master
recovery invitation, stop the server, run `pnpm run invite-master`, then restart
it with `pnpm run server`.

## Backups and platform support

Manual encrypted backup export and restore require Node.js 24.16 or newer and
are supported on Linux, Windows, and macOS. Restore refuses to overwrite an
existing database; Windows restore requires an NTFS destination.

Scheduled encrypted backup copies to a separate mounted drive are currently
supported by this Free server package on Linux and macOS. Scheduled external
drive copies are not enabled on Windows in this edition. Keep a current manual
encrypted backup off the server computer. Never copy the live `.sqlite` file
while the server is running.

For backup and recovery steps, see
[Back up and recover a Home Ledger household](backup-recovery-user-guide.md).
