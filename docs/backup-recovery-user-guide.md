# Back up and recover a Home Ledger household

This guide covers the Master’s backup steps and how to move a household to a replacement server. Backup and restore commands run on the Linux server; they do not run on a phone.

## Before a problem occurs

### 1. Enroll once and protect the recovery phrase

After creating your household, open a terminal on the server PC and run this from the Home Ledger project folder, as the same Linux user that runs the server:

```bash
pnpm --filter @workspace/api-server run backup:enroll
```

The command displays a recovery phrase once. Write it down and keep it somewhere secure **away from the server PC and its backup drive**. Anyone with both a backup archive and the phrase can restore the household. If the phrase is lost, Home Ledger cannot recover it for you.

Enrollment saves a private key on the server. It does not change household transactions. Do not delete that key while the server is still in use.

### 2. Set up automatic copies on a USB drive or NAS

Mount the USB drive or NAS share at its own directory. Use that **mount point itself**, not an ordinary folder on the server disk or a subfolder inside the mount:

```bash
BUDGET_RECOVERY_DIR=/mnt/home-ledger-backups pnpm run server:linux
```

Replace `/mnt/home-ledger-backups` with the mount point on your PC. The mount must already exist and be writable. Home Ledger checks that it is a separate mounted filesystem from the database, but cannot tell whether it is physically off the PC; confirm that it is actually a USB drive or NAS.

Once enrolled and configured, the server makes an encrypted copy at startup and every 24 hours, retaining completed copies for 30 days by default. It will not save to the PC’s local disk if the mount is missing. You must provide `BUDGET_RECOVERY_DIR` each time the server starts, or add it to the launcher you already use.

In the app, the Master can check **Home** or **Settings → Data** for warnings and the last successful automatic backup. A missing or stale copy means recovery protection may be incomplete.

### 3. Save a manual copy

1. On the Master’s phone or browser, open **Settings → Data**.
2. Tap **Save encrypted backup**.
3. On Android, choose a local folder in the system picker (for example, a folder under internal storage). On iPhone, choose **Save to Files** in the share sheet. A USB drive plugged into the server PC will not appear on the phone; transfer the `.hlbackup` file from the phone to that drive afterward. In a browser on the PC, check Downloads and then move the file to the mounted USB drive.
4. Confirm that the `.hlbackup` file is actually at the final destination. Opening or closing a share sheet does not prove it was saved.

Manual export creates a consistent, encrypted snapshot and does not change the household ledger. The recovery phrase is not sent to the app or included as plain text in the archive.

## If the server PC fails

Use the newest `.hlbackup` file you can find. A scheduled daily copy may be up to about 24 hours behind; a more recent manual export can reduce that gap.

1. On the replacement PC, install the updated Home Ledger server files. **Do not start the API yet**: the first server start creates a database, and restore is designed for a new, empty target.
2. Run the restore command from the project folder:

   ```bash
   pnpm --filter @workspace/api-server run backup:restore
   ```

3. Enter the path to the `.hlbackup` file and the recovery phrase when prompted. The phrase input is hidden. Review the household name, archive date, and record counts; type `RESTORE` only if they are the archive you intend to install.
4. Start Home Ledger as the same Linux user and with the same database-path settings you used for restore. Configure `BUDGET_RECOVERY_DIR` again if you have a mounted backup destination.
5. Restore revokes every device session and pending household invitation. When the restored household has no active Master device, server startup prints a one-use, 10-minute invitation targeted to the household’s current Master. On the Master’s phone, enter the server address and that invitation code to reconnect. Names are not used to authenticate.
6. If you need to create a fresh targeted Master invitation, run this on the trusted server PC:

   ```bash
   pnpm --filter @workspace/api-server invite-master
   ```

   From inside `artifacts/api-server`, use `pnpm invite-master`. The code appears only in that local terminal, expires after 10 minutes, and can be redeemed once. Creating it does not revoke existing devices; there is no HTTP Master-recovery endpoint. Keep local PC access trusted and share the code only privately.
7. After the Master reconnects, use **Household** to create new invitations for existing members. Each invitation is bound to the selected account and is single-use; members enter only the server address and invitation code.
8. Review any pending changes displayed on the phones. They are held for manual review and are **not** replayed automatically against the restored household. Compare with the restored ledger and re-enter only the changes that are still needed.

Restore validates the archive before installing it and refuses to overwrite an existing database or SQLite sidecar files. If it refuses, do not delete files just to make the command proceed; choose a genuinely new, empty database path or ask for help.

## Safe testing

The recovery tests use temporary databases and temporary keyrings. Do not test restore against your live household. Exporting a backup is read-only; restoring is the operation that installs data, and it must target a new, empty server.

## Quick reference

| Action | Who/where | What it does |
| --- | --- | --- |
| Enroll | Master/server PC, once | Creates a private server key and shows the recovery phrase |
| Automatic backup | Server PC, after enrollment and mount configuration | Writes encrypted copies at startup and every 24 hours |
| Manual export | Master, **Settings → Data** | Downloads/shares an encrypted `.hlbackup` file |
| Restore | Server terminal on a new PC | Validates and installs a backup into a new, empty database |