# Running Home Ledger on Linux

Home Ledger is designed to stay on your trusted local network. Do not expose its API port to the public internet.

## Start the server

From the project root:

```bash
pnpm run server:linux
```

The launcher builds the API, starts it on `0.0.0.0:5000`, and uses stable Linux data directories. It does not print a generic household invitation.

The first launch creates the database. In the app, the first person chooses **Set up household** to create the household and become its Master. Keep the terminal open while using the server. Stop it with `Ctrl+C`.

To add people or devices after setup, the Master opens **Household** and creates a single-use, 10-minute invitation for a new member name or an existing account. The code is shown once; share it privately. The invitee enters the server address and code, not a name or role. Names are not authentication. The Master can review invitation status and revoke a pending invitation. To add another device to the Master’s own account, explicitly confirm that invitation.

The `pnpm run server:linux` command defaults to port `5000` and uses real time.

If upgrading from an older server ZIP, stop the old server, extract the updated server source **directly into the existing project folder** (its `package.json` and `artifacts/` should appear at the top level), then run `pnpm install --frozen-lockfile` from that folder. Restart the normal server afterward. The ledger remains in its XDG data directory outside the project folder; do not copy or overwrite database files during the upgrade.

New shared expenses use the server's current member quotes when they sync. Previously saved expense shares are preserved.

Every production start uses the same XDG database location by default, including a direct API start. Restart the server as the same Linux user so `$HOME` and the stored device sessions remain unchanged. When the server reopens this database, connected apps reconnect automatically; do not log out or create new invitations after a normal restart.

The destructive demo-reset endpoint is disabled by default and is always disabled in production. It can only be enabled by setting both `NODE_ENV=development` and `ALLOW_DEMO_RESET=true`; never enable it on a server containing real data.

## Stable data and encrypted recovery

For a step-by-step household backup and replacement-server guide, see [Back up and recover a Home Ledger household](backup-recovery-user-guide.md).

The launcher follows the Linux XDG data convention:

- Database: `${XDG_DATA_HOME:-$HOME/.local/share}/home-ledger/home-ledger.sqlite`

The data directory is created with mode `700`. The SQLite database uses WAL mode. **Do not copy only the live `.sqlite` file** while the server is running. Backups are complete SQLite snapshots sealed into encrypted `.hlbackup` files; raw SQLite copies are no longer made automatically.

The live database itself is **not encrypted at rest**. Encrypted exports and
archive previews use in-memory SQLite snapshots and fail closed if the Node.js
runtime lacks SQLite serialize/deserialize support; no plaintext snapshot-file
fallback is used. Offline restore briefly stages plaintext on the target
database filesystem before installing it. For protection if the PC or disk is
stolen, enable full-disk encryption on the server.

At startup, the server prints the resolved database path and non-sensitive counts for households, active users, and transactions. If those counts are unexpectedly zero or show demo data, stop the server and verify that it is running as the same Linux user and that `BUDGET_DB_PATH` has not been changed.

### Enroll the recovery phrase

After creating the household, run this command on the server PC as the same Linux user:

```bash
pnpm --filter @workspace/api-server run backup:enroll
```

Write down the recovery phrase shown once in the terminal and keep it **away from the PC and its backup drive**. It is needed to restore after a crash and cannot be recovered from the server. Do not photograph it or send it to anyone. Enrollment creates a private local key file so the running server can make scheduled encrypted copies without storing the phrase.

The household master can then use **Settings → Data → Save encrypted backup** in the app and save the `.hlbackup` file to another device. Merely opening the share sheet is not a saved backup: confirm that the file is in a safe location off the server PC.

### Schedule an off-PC copy

Mount a USB drive or NAS share at a dedicated directory, for example `/mnt/home-ledger-backups`. Point the launcher to the **mount point itself**, not a subdirectory inside it:

```bash
BUDGET_RECOVERY_DIR=/mnt/home-ledger-backups pnpm run server:linux
```

After enrollment, the server writes an encrypted copy when it starts and every 24 hours while running. It retains completed encrypted copies for 30 days by default. The destination must be an existing, writable mount point on a different filesystem from the database; it is never created automatically. This mount check prevents accidental writes to an ordinary local folder or to the mount point after the drive disappears. It **cannot tell** whether a mounted filesystem is an external USB/NAS or another internal disk: verify that yourself. If the mount disappears or is unsuitable, the server does **not** fall back to its own disk. The master can see backup readiness and the last successful copy in Settings. Check this regularly. Without an off-PC copy, a PC/disk failure can destroy the ledger and its local data.

Historical plaintext `.sqlite` snapshots made by older versions are **not** automatically removed by this upgrade. Treat them as sensitive until you have verified that you can restore an encrypted backup, then handle their removal yourself.

### Restore on a replacement PC

Use the newest complete `.hlbackup` file. A daily schedule can lose up to roughly 24 hours of changes after a PC failure; manual exports can reduce that gap.

1. Install the updated server source on the replacement PC **without starting the API**. Use the same Linux user and intended `XDG_DATA_HOME`/`BUDGET_DB_PATH` values. The restore wizard refuses to overwrite an existing database or WAL/SHM files; if this installation already started, choose a new empty data path rather than deleting its files.
2. Run `pnpm --filter @workspace/api-server run backup:restore` from the project root. Enter the archive path and recovery phrase at the prompts. Review the household/date/count preview and type the requested confirmation.
3. Start `pnpm run server:linux` (with your off-PC backup mount configured again). The restore reconstructs a private server keyring from your archive, so the same recovery phrase protects new encrypted backups. Restore revokes every device session and pending household invitation. When there is no active Master device, startup prints a one-use, 10-minute invitation targeted to the archived household's current Master.
4. The Master enters that invitation with the server address to reconnect first. If needed, create a fresh targeted Master invitation from a trusted server PC:

   ```bash
   pnpm run invite-master:linux
   ```

   This launcher reuses the same absolute database path as server startup and works with the bundled API runtime. In a source workspace, `pnpm --filter @workspace/api-server invite-master` is also available; from a Linux installation without pnpm, run `bash ./scripts/start-home-ledger-server.sh --invite-master`. The code is printed only in that local terminal, is valid for 10 minutes and can be used once. This command does not revoke existing devices; it is not an HTTP recovery endpoint. Keep the PC and code trusted/private. After the Master reconnects, create invitations for existing members from Household.
5. Phones must not automatically replay changes queued against the pre-crash server; review any pending changes shown on the device and re-enter them deliberately if needed.

The wizard validates decryption, SQLite integrity, and household structure **before** installing the database. It is intentionally an offline, server-local operation, not a network restore endpoint.

## Connect from phones on the LAN

Find the Linux computer's LAN address:

```bash
hostname -I
```

Use the private address for the phone, for example `http://192.168.1.25:5000`. The phone and computer must be on the same trusted Wi-Fi or LAN. Guest Wi-Fi often blocks device-to-device traffic.

Allow TCP port 5000 only from your private LAN. Replace `192.168.1.0/24` with your actual subnet.

Ubuntu/Debian with UFW:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 5000 proto tcp
sudo ufw status
```

Fedora/RHEL with firewalld:

```bash
sudo firewall-cmd --permanent \
  --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" port port="5000" protocol="tcp" accept'
sudo firewall-cmd --reload
sudo firewall-cmd --list-all
```

Do not configure router port forwarding for port 5000. For access away from home, use a private VPN rather than exposing the server directly.

## Invitations and session expiry

- Household invitations are single-use and expire after 10 minutes. Each invitation is bound by the Master to a new member name or an existing account; the invitee cannot choose an identity or role by typing a name.
- The old shared pairing-code flow is disabled. Use a Master-created invitation for each new member or device. Master recovery invitations are targeted and shown at startup only when no Master device is active; the local `invite-master` command can create one on the trusted PC.
- Device sessions expire after 30 days and are actively rejected by authenticated endpoints after expiry.
- Create a new invitation to reconnect a device when its session expires.

## Configuration

Override defaults by setting environment variables before launching:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Network interface to listen on |
| `PORT` | `5000` | API TCP port |
| `BUDGET_DB_PATH` | `${XDG_DATA_HOME:-$HOME/.local/share}/home-ledger/home-ledger.sqlite` | SQLite database |
| `BUDGET_RECOVERY_DIR` | Not set | Existing dedicated USB/NAS mount point for encrypted scheduled copies |
| `BACKUP_INTERVAL_HOURS` | `24` | Encrypted-copy frequency |
| `BACKUP_RETENTION_DAYS` | `30` | Encrypted-copy retention |
| `SESSION_TTL_DAYS` | `30` | Device-session lifetime |
| `APP_VARIANT` | `production` | Normal-time household server |

`XDG_DATA_HOME`, `BUDGET_DB_PATH`, and `BUDGET_RECOVERY_DIR` must be absolute paths when set. The database uses the XDG default when its path is empty; the off-PC backup destination has **no** local default. `BUDGET_BACKUP_DIR` is obsolete and does not configure encrypted backups.

Example:

```bash
PORT=5050 BUDGET_RECOVERY_DIR=/mnt/home-ledger-backups pnpm run server:linux
```