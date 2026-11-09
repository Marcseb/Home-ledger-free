# Saved phone access

## Android and iOS

Home Ledger stores the saved device session (including its token) using Expo
SecureStore: Android Keystore-backed encrypted storage and the iOS Keychain.
The saved session itself does not require biometrics or prompt for Face ID. The
optional app lock described below is a separate screen-access control. On iOS
the session entry is available while the device is unlocked and is device-only.
Android backup configuration excludes SecureStore entries that cannot be
decrypted after restoring to another installation.

On first launch after updating, an existing AsyncStorage session is copied into
secure storage and read back for verification before the old copy is removed.
The household cache, pending changes, cursor, and quarantined changes are not
moved or encrypted by this update. No server ledger changes are made by migration.
New pairing credentials are secured before replacing local household data.
Session operations share the existing serial storage queue and generation guards.

Household replacement uses a recoverable commit: a verified journal preserves the
previous cache, pending entries and cursor, while its rollback credential stays
in a separate secure slot (never in the journal). If any replacement write fails,
the previous snapshot is restored. If storage also prevents rollback or the app
closes midway, startup completes rollback before loading a session or syncing.
Until recovery succeeds, no mixed household snapshot can be used. One bounded
secure rollback slot is retained until the next replacement or sign-out so a
crash during journal cleanup cannot lose the recovery credential.
If journal deletion succeeds but its confirmation fails, rollback first
reestablishes and verifies the durable journal. If that cannot be done, it does
not start changing the already-consistent committed snapshot.

If native storage fails, the app reports the failure instead of silently using
plaintext. Migration leaves the usable legacy copy intact until the secure save
is verified; a failed cleanup is retried at startup. Startup offers a retry.
Sign-out only reports success after removing saved access; if removal fails, stay
on Settings and retry. Expired-session cleanup saves pending changes in quarantine
before removing active credentials and cache.

Already-built APKs must be rebuilt to include the new native module and backup
configuration. This change cannot erase tokens in historical operating-system
backups. SecureStore is not a ledger backup or a recovery mechanism: keep the
trusted-PC recovery/invitation flow. iOS Keychain data may survive uninstall on the
same device; do not treat uninstall as sign-out or server-side session revocation.

## Optional app lock

On Android and iOS, enable **Settings → App security → Lock app on open** and
choose a four-digit PIN. If device biometrics are enrolled, the app offers them
first; the app PIN is the fallback. If biometrics are unavailable or cancelled,
the app asks for the PIN. When enabled, the app locks on startup and when
returning after more than 30 seconds in the background. Repeated incorrect PINs
cause increasing delays, saved on the device, up to a 24-hour maximum.

If both biometrics and the PIN are unavailable, recovery first syncs pending
household changes. Once they are safely synced, redeem a fresh household
invitation and set a new app PIN. If the server is unreachable or a change is
rejected, recovery stays locked; rejected changes are preserved for review.
Recovery does not erase the prior session or local household data as a shortcut.

The app-lock PIN and settings are held in device SecureStore and are not part of
financial backups. This is a local screen lock, not encryption for the cached
ledger or server database, and it does not authenticate API requests. Keep device
security enabled and protect the server PC with full-disk encryption.

## Browser limitation

Expo web uses ordinary browser storage (AsyncStorage's web implementation), not
SecureStore. Browser sessions do **not** receive the native encrypted-storage
guarantee. Same-origin scripts and someone with access to the browser profile may
read saved access. Use a trusted browser/profile and sign out on shared machines.
This is an explicit web-only implementation, never a native failure fallback.

## Verification

Run isolated in-memory migration/failure/queue tests without reading device
storage, calling server APIs, or modifying a household:

```sh
node --test artifacts/home-ledger-mobile/lib/{session-storage,household-storage,storage-queue}.test.mjs
pnpm --filter @workspace/home-ledger-mobile run typecheck
```

These tests verify ordering, migration retry, native read/write/delete failures,
read-back verification, generation cancellation, serialized expired-session
cleanup/re-pairing, preservation of cache and quarantine keys, and the web
implementation. They do not emulate the operating system's Keystore or Keychain.
The provider's replacement commit is tested with injected STATE, OUTBOX and CURSOR
write failures after successful secure-session saving, failed rollback, and
restart recovery with pending operations intact.
Finalization tests also cover journal-deletion failures, failed confirmation reads
after deletion, interrupted rollback, and failed credential restoration.