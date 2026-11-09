# Home Ledger Free — offline entries and renewed access

The Android application ID remains `app.homeledger.free`. These are mobile-client
protections; no database migration or server update is required.

## What happens to an offline entry?

- During ordinary reconnection, pending entries sync automatically. A server
  refresh must not remove an entry saved while that refresh is still running.
- Signing out or renewing household access first retains unsynced entries for
  review. If that save fails, the access change stops.
- Acknowledging **Pending changes need review** marks entries as reviewed; it
  does not post or delete them. After pairing, open **Settings → Saved changes →
  Show saved changes** to consult the original note, amount and transaction date.
- Compare retained entries with Activity before re-entering only what is missing.
  They are not automatically reposted under a new authorization.
- The update cannot reconstruct entries deleted by an older app.

## Safe checks on a test household

Back up first. Install a new signed APK as an update using the same Free signing
key; do not uninstall or clear app data. Keep the server's database path,
configuration path, PC user and launch command unchanged.

1. **Ordinary offline save:** Disable phone connectivity. Save a small expense
   with a unique note, such as `FREE-OFFLINE-CHECK`. Reopen the app while offline;
   the entry and pending count must remain. Reconnect and sync both phones. The
   entry must appear once on each phone and affect the balance only once.
2. **Server restart:** Stop the server. Save a different, clearly labelled
   expense on each phone, restart the same server and sync. Both entries must
   appear once. Unexpired device access should remain recognized.
3. **Renewed access:** On a separate test household or spare test device, save an
   offline expense and revoke only that test device from another authorized
   Master device. Reconnect; sign out if necessary to reach pairing. Acknowledge
   any review and authorize the same existing user again. The retained entry must
   remain available in Settings after acknowledgement, pairing and app restart.
   It must not be posted merely because it was acknowledged.

Do not revoke the real household's only working Master device. If an ordinary
server restart requires new invitations, check database selection, session
expiry/revocation and system time separately; do not create a new household or
restore a backup as a workaround.

After testing, cancel test expenses through Activity to preserve the audit trail.
If a check fails, retain the app version, note, amount, transaction date, pending
count and screenshots. Hide invitation codes and credentials.

## Source checks

From the Free source root:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck:libs
pnpm --filter @workspace/home-ledger-mobile run typecheck
pnpm --filter @workspace/home-ledger-mobile run test:offline-sync
```

The tests cover delayed refreshes, restart persistence, failed storage writes,
reauthorization, non-destructive acknowledgement and Free-edition boundaries.
