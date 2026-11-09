# Home Ledger Free

Home Ledger Free is a self-hosted household ledger for tracking everyday income,
expenses, budgets, recurring entries, and savings goals. The Android app connects
to an API server that the household runs on its own computer.

## Core features

- Personal and Shared accounts, transactions, categories, and monthly budgets.
- A one-tap estimated bank-cash view that reconciles personal balances with app-only Shared allocations and Shared purchases attributed to the paying member.
- Recurring income, expenses, and transfers.
- Personal and shared savings goals, member commitments, contributions, and
  progress on the Home screen.
- Audited corrections and reversals that preserve transaction history.
- Offline entry queue and sync when the phone reconnects to the household server.
- Unsynced entries retained for review before signing out or renewing household access. Acknowledging a review keeps the list in **Settings → Saved changes**; it does not post or delete entries. Compare with Activity before re-entering only what is missing.
- Local Wi-Fi server discovery when the computer's address changes.
- Optional app lock using device biometrics or a four-digit PIN.
- Encrypted manual backups, with optional scheduled copies to a separate drive
  on supported systems.
- CSV export of records visible to the signed-in household member.

For safe reconnection and renewed-access checks, see
[Offline entries and renewed access](docs/offline-sync-safety.md).

### Shared purchases and estimated bank cash

When you add a Shared expense, Home Ledger automatically attributes it to your
active Main personal account for the bank estimate. There is no payer field to
fill in. The expense reduces Shared once; the attribution does not create a
personal ledger debit or change either ledger balance. Update the app and local
server together to use this feature.

In the Personal view on Home, tap **Estimated bank cash** to expand the estimate.
It starts with your Home Ledger personal balance, adds app-only transfers to
Shared, and subtracts Shared expenses attributed to the selected personal
account or accounts. It is based on recorded activity, not a live bank
connection.

Older Shared expenses are not attributed retroactively. To include one, open an
expense you created in Activity and save it with the preselected Main account;
opening or cancelling the edit does not change the record. Monthly settlement
remains a separate transfer recorded by the household.

## Release identity

- Edition: **Home Ledger Free**
- Android application ID: **`app.homeledger.free`**
- Version: **1.0.10**
- Android version code: **3**
- Release tag: **`free-v1.0.10`**

See the [Free release identity](docs/release-identities.md).

## How it is organized

```text
Android app  ⇄  household computer on the private LAN  ⇄  API server  ⇄  SQLite database
```

The server is an Express API backed by SQLite in WAL mode. Shared workspace
packages contain the API contract, generated client, and database code.

| Path | Contents |
| --- | --- |
| `artifacts/home-ledger-mobile/` | Home Ledger Free mobile app |
| `artifacts/api-server/` | Express API, SQLite-backed ledger, and server tools |
| `lib/` | Shared API, database, and validation packages |
| `scripts/` | Workspace scripts and desktop server launchers |
| `docs/` | Free-edition guides and release notes |

## Requirements and checks

- Node.js 24.16 or newer on Node 24 LTS
- pnpm **10.26.1**
- Linux, Windows, or macOS for the self-hosted server setup
- Android Studio and JDK 17 for Android builds

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck:libs
pnpm --filter @workspace/home-ledger-mobile run typecheck
pnpm --filter @workspace/home-ledger-mobile run test:offline-sync
```

The offline-sync checks confirm that entries survive refresh and household-access
replacement, remain available after review, and are not posted by acknowledging.

## Run the household server

On the desktop computer that will host the household:

```bash
pnpm install --frozen-lockfile
pnpm run server
```

The server listens on port `5000` by default and stores its database outside the
project folder using the operating system's standard application-data location.
The phone and server must be on the same trusted network. The first person sets
up the household and becomes its Master; the Master creates invitations for
other members and devices.

Follow the [Linux, Windows and macOS server installation guide](docs/server-installation.md)
for desktop setup, shortcuts, and backup options by system. For the detailed
Linux backup steps, see [the Linux backup and recovery guide](docs/backup-recovery-user-guide.md).

## Build the Android app

The repository contains source code, not an installable APK. Follow the
[Home Ledger Free Android build guide](docs/android-free-build.md) to generate
the Android Studio source package, then build and sign an APK or Play bundle.

Each installation has its own on-device session and app data, even when it
connects to the same household server.

## In-app help

The app includes an offline guide opened from the Help button. It covers setup,
accounts, budgets, activity, goals, sync, app security, and backup and recovery.
The Activity and Home topics explain automatic Main-account attribution and the
estimated bank-cash breakdown.

## Data protection

- Keep the API on a trusted local network. Do **not** expose port `5000` to the
  public internet or configure router port forwarding.
- The live SQLite database is **not encrypted at rest**. Use full-disk
  encryption on the server computer.
- Encrypted `.hlbackup` archives can be exported manually on all supported
  systems. Scheduled encrypted copies require `BUDGET_RECOVERY_DIR` to point to
  an existing, separate mount; this Free server package supports scheduled
  copies on Linux and macOS, not Windows.
- Keep recovery phrases, signing keys, credentials, databases, and backup
  archives out of the repository.
- Do not copy only the live `.sqlite` file while the server is running. Use the
  supported backup and restore procedures.

## Focused checks

```bash
pnpm --filter @workspace/api-server run test:platform-paths
pnpm --filter @workspace/api-server run test:server-discovery
pnpm --filter @workspace/home-ledger-mobile run test:server-discovery
pnpm --filter @workspace/home-ledger-mobile run test:app-lock
```
