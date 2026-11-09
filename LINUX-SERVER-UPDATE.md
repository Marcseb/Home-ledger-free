# Home Ledger Linux-server update — 2026-10-11

## What this update includes

The new phone can find this server again when its LAN IP changes. `/api/ping` identifies the server without exposing household information; a challenge proves possession of the phone's existing device session before it sends credentials or pending entries. Existing accounts, device access and transaction history are preserved. Normal and accelerated servers are identified separately.

Install this server update **before** the matching version 1.0.6 normal Android update (Android version code 7). Sync all phones and verify a fresh encrypted backup before stopping the old server. Avoid entering purchases during the upgrade; update every household phone before resuming use. Keep the app installed and do not re-pair it. Once both are updated, the phone automatically searches its current IPv4 Wi-Fi subnet if the saved private address fails. Manual address editing is available in Settings → Connection.

Shared purchases now debit **Shared only**; **Paid from** is removed. Personal balances are no longer affected by individual Shared purchases. Users record intentional transfers separately for month-end settlement. Older phones must be updated: requests for new personal-funded purchases are explicitly rejected rather than saved with the wrong accounting.

On first updated-server startup, active automatic purchase funding is reversed in one audited database transaction. This restores personal ledger money and leaves the original purchase charged to Shared. Original expenses, dates and allocation shares are retained; original funding and read-only counter-entries remain in the audit history. The audit records the actual adjustment time separately from the original ledger date. Already-cancelled funding is not refunded again, and repeated restarts do not repeat the adjustment. Ordinary transfers and goal contributions are untouched. No real bank payment is made.

The Shared card restores the prominent available balance while retaining both monthly expense/budget and goal-contribution/plan bars. Activity's **Show audit entries** switch is off by default and changes visibility only, never balances or totals. Recurring Shared bills also debit Shared only.

The persistent `server-instance-id` is created beside the existing recovery configuration. Leave that configuration directory intact on future updates; this identifier is not a recovery phrase or signing key.

Current account money excludes future-dated posted income, expenses and transfers until their UTC ledger date. Both transfer legs take effect on that date, irrespective of their stored hour. Cancelled originals and reversal audit records remain excluded. The phone's current closing history and pending-balance calculations use the same rule, and Activity labels future-dated entries clearly. Original activity records are preserved.

**Install the matching phone update on every household phone and the server update together.** First sync the phones and verify a backup while the old server is still running; then stop it and update the phones and server before resuming use. Older phone history assumes the server includes future-dated posted money and can subtract it again after a server-only update. A new phone paired to an older server can still receive premature future money. Goal reservations remain separate from cash and can reveal an account shortfall.

Master-created invitations replace shared household codes and name-based identity selection. Invitations bind a new member or an existing account to the joining device, expire after 10 minutes, work once, and can be revoked. There are no biometric prompts. Legacy pairing and Master-claim routes are intentionally blocked. Previous recurring calendar-date fixes are included.

Contributors can cancel their own savings-goal contributions independently of cancelling a transfer. Cancellation removes progress from the personal and mirrored shared goals while leaving the original transfer posted and the money in Savings as unallocated funds.

This is a complete source ZIP, with workspace files at its root. It contains no household databases, device sessions, credentials, recovery keyrings, or backups. Update the server and phone app together for new pairing. Existing valid phone sessions remain usable; installing this ZIP does not update an installed Android app.

## Verify the downloaded ZIP

Download the ZIP and its matching `.zip.sha256` file into the same folder. On Ubuntu, open Terminal in that folder and run:

```bash
sha256sum -c home-ledger-linux-server-shared-only-2026-10-11-source.zip.sha256
```

The ZIP filename recorded inside the checksum file must match the downloaded ZIP exactly. A successful check prints the ZIP name followed by `OK`. If the filenames differ, keep the original names and put the matching pair in the same folder. If the command reports `FAILED` or cannot find the ZIP, do not install it; download the ZIP and its checksum again from the trusted release source. The checksum checks file integrity; it is not a substitute for trusting the source you downloaded them from.

## Update without resetting your household

1. If encrypted recovery is configured, save and verify a current encrypted backup off the PC before updating. Do not re-enroll recovery or reset the household.
2. Stop the existing server with `Ctrl+C`, or stop the service you normally use.
3. Extract this ZIP **directly into your existing project folder**, overwriting the source files. `package.json`, `pnpm-workspace.yaml`, and `artifacts/` must be immediately inside that folder, not inside a new nested folder. Do not copy, replace, or delete database or recovery files.
4. In that project folder, run:

   ```bash
   pnpm install --frozen-lockfile
   ```

5. Restart as the **same Linux user**, with the same `HOME`, `XDG_DATA_HOME`, `BUDGET_DB_PATH`, and recovery-mount settings you previously used. Keep your existing launcher or service settings. If you normally start manually, use the same variant as before:

    **Your restored protected normal copy — port 5000**

    ```bash
    APP_VARIANT=production NODE_ENV=production PORT=5000 \
    BUDGET_DB_PATH="$HOME/.local/share/home-ledger-normal-copy/home-ledger.sqlite" \
    XDG_CONFIG_HOME="$HOME/.config/home-ledger-normal-copy" \
    pnpm run server:linux
    ```

    Use this complete command if you restored into those normal-copy paths. A plain command would select another database. Do not repeat the restore or create a new household.

    **For the normal-time household using the default database path — usually port 5000**

   ```bash
   pnpm run server:linux
   ```

   Retain any previously configured `BUDGET_RECOVERY_DIR` and ensure its off-PC backup mount is available.

6. Check the printed database path and household/user counts. If they are unexpectedly empty, stop the server and check your user and path settings before pairing or setting up anything.
7. Leave the phones paired and allow them to sync. A normal code update preserves existing device sessions, unless a session has independently expired. To add another device, the Master creates an invitation in **Household**. The joining phone enters the server address and invitation code, not a name or role.

8. On the phone's browser, check `http://<current-PC-LAN-IP>:5000/api/ping`. It should return `product: "home-ledger"` and the production variant. This public response contains no household data. If the new app cannot find the server, use Settings → Connection → Edit address. Do not clear app data or delete pending entries.

LAN discovery does not bypass the Ubuntu firewall or router client isolation. Phone and PC must be on the same reachable LAN; a VPN, different subnet or non-`/24` network may require entering the address manually. No router-wide scanning or new firewall ports are added.

If all Master phones are unavailable, create a fresh Master-device invitation on the trusted server PC, using the same user and database settings:

```bash
pnpm run invite-master:linux
```

This grants Master access to the next device that redeems the code. Share it privately and use it within 10 minutes. It does not revoke existing devices.

For full operating and recovery instructions, see `docs/linux-server.md` and `docs/backup-recovery-user-guide.md`.