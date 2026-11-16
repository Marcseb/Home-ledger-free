# Home Ledger Free release identity

| Field | Value |
| --- | --- |
| Android application ID | `app.homeledger.free` |
| Current version | `1.0.10` |
| Android version code | `3` |
| Release tag format | `free-v<version>` |

Create a release tag only after that exact Free build has passed release checks.
Pushing a matching `free-v<version>` tag runs the server-source release workflow.
It validates and attaches the Free server ZIP, its SHA-256 checksum, and
Windows/macOS/Linux setup launchers to that exact GitHub Release. The web page
should link directly to the versioned OS launcher, never to a moving branch or a
generic latest-download URL.
Increase the Android version code for every Google Play upload.
