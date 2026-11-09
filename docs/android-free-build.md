# Home Ledger Free Android build

**Release note — 2026-11-09:** version **1.0.10**, Android version code **3**,
protects offline entries during refresh, sign-out and renewed household access.
Entries kept for review stay in Settings after acknowledgement; acknowledgement
does not send them to the server. Use Activity to check what reached the server
before re-entering only missing entries. This is a mobile-client update; no
matching server update is needed.

## Release identity

- App name: **Home Ledger Free**
- Version: **1.0.10**
- Android application ID: **`app.homeledger.free`**
- Android version code: **3**
- Release tag: **`free-v1.0.10`**

Android gives Home Ledger Free its own private app sandbox, including SecureStore
credentials and the local household cache. Pair each installation with its own
household invitation. Keep the Free signing certificate safely backed up for
future updates.

## Prepare the source archive

Use Node.js 24.16 or newer on Node 24 LTS, pnpm **10.26.1**, Android Studio,
and JDK **17**. From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck:libs
pnpm --filter @workspace/home-ledger-mobile run typecheck
pnpm --filter @workspace/home-ledger-mobile run test:offline-sync
```

Generate the safe Android Studio source package with
`pnpm run package:android-free-source`. Extract the generated ZIP and open its
`artifacts/home-ledger-mobile/android/` folder in Android Studio. Keep the
Gradle JDK set to 17 and allow Gradle to sync. The release script creates the
native project and validates the Free app identity.

## Build and sign

For a local install, use **Build → Generate Signed App Bundle or APK → APK**.
For Google Play, choose **Android App Bundle** and upload the resulting `.aab`.
Confirm the release application ID is `app.homeledger.free` and the version
code is higher than any Free-edition version already uploaded to Play.

Choose a signing key for the Free app and keep a secure backup for all future
updates. Do not put keystores or passwords in the source folder or share them in
chat.

## Connect to the household

The Free app uses the normal-time Home Ledger server on the trusted household
LAN, normally at `http://<PC-LAN-IP>:5000`. Start the server from its project
folder with:

Start the server with `pnpm run server` on Linux, Windows, or macOS. See
[the server installation guide](server-installation.md) for setup.

The Master creates a new invitation for the Free app's device. The invitation
is single-use and expires after 10 minutes. This app can connect to an existing
household; do not restore or reset the server database to install the app.

## Before each release

1. Increase `expo.version` and `expo.android.versionCode` in
   `artifacts/home-ledger-mobile/app.json`.
2. Run the type checks above and verify the generated application ID.
3. Build and test a signed release on a clean Android device.
4. For a Play submission, follow the [Free-edition Play checklist](google-play-free-release.md).
5. Tag a release only after that exact Free version passes release checks:
   `free-v<version>`, for example, `free-v1.0.10`.
