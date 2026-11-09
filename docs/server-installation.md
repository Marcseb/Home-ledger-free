# Home Ledger Free server — Linux, Windows and macOS

The Free app connects to a Home Ledger server running on a trusted home network.
The computer must stay awake and the server terminal must remain open. Do not
expose the server port to the public internet or configure router port forwarding.

## Requirements

- Node.js 24.16 or newer on Node 24 LTS
- pnpm 10.26.1
- Internet access for the first dependency installation
- No Android Studio or JDK is needed to run the server

Verify Node and pnpm in Terminal or PowerShell:

```text
node --version
pnpm --version
```

If needed, install the pinned pnpm release with `npm install --global
pnpm@10.26.1`. On Windows PowerShell, use `pnpm.cmd` if the script shim is
blocked; do not change the machine-wide execution policy.

## Install and start

Extract the server source ZIP to a project folder. The root `package.json`,
`pnpm-workspace.yaml`, `artifacts/`, and `scripts/` must be directly inside it.
Open a terminal in that folder and run:

```text
pnpm install --frozen-lockfile
pnpm run server
```

The first command installs dependencies. The second builds and starts the
normal-time server on port 5000. Keep the terminal open; press Ctrl+C to stop.
Linux users may also use `pnpm run server:linux`.

Check the computer in a browser at `http://localhost:5000/api/healthz`; it
should return `"status":"ok"`.

## Desktop shortcut

Run the appropriate command from the extracted project folder:

| System | Command |
| --- | --- |
| Ubuntu / GNOME | `bash scripts/create-home-ledger-shortcut-linux.sh` |
| Windows PowerShell | `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\create-home-ledger-shortcut-windows.ps1` |
| macOS Terminal | `bash scripts/create-home-ledger-shortcut-macos.sh` |

The shortcut opens a visible terminal and uses the Home Ledger icon. Ubuntu may
require **Allow Launching**; Windows may ask to allow the app on a private
network; macOS may ask for permission to control Terminal. Do not enable public
network access.

If you move the project folder, recreate the shortcut. Moving the program files
does not move the household database. The scripts refuse to overwrite an
existing shortcut so custom database settings are not silently lost.

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
