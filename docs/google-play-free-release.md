# Home Ledger Free: Google Play checklist

This guide applies only to the Free edition. It does not publish or upload the
app.

## Build the bundle

Build a signed Android App Bundle (`.aab`) using the
[Home Ledger Free Android build guide](android-free-build.md). The current
source identity is `app.homeledger.free`, version `1.0.10`, Android version
code `3`. Check Play Console and increase the code before every subsequent
upload.

## Prepare the listing and declarations

- Confirm `app.homeledger.free` is available and registered to the correct
  Play developer account.
- Publish a privacy policy that accurately describes the app's local phone
  storage and sync to a household-operated server.
- Complete the Data safety form based on the actual device-to-server data flow;
  do not assume that household-hosted data is automatically exempt.
- Complete the financial-features declaration accurately for household
  budgeting and expense tracking.
- Complete App access, ads, target audience, content rating, and other required
  App content declarations.
- Prepare the app name, description, support contact, screenshots, icon, and
  feature graphic.
- Verify the required target SDK and all Console checks on the day of upload.
- Check whether the developer account is subject to Play's closed-testing
  requirement before requesting production access.
- Install the signed Free build on a clean Android test phone and verify its
  pairing, offline queue, local app lock, and backup flows.

## Reviewer access is a release blocker

The app connects to a server chosen by the household. Play reviewers cannot
reach a server running only on a home Wi-Fi network. The existing invitation is
single-use and expires after 10 minutes, so it is not reliable for a review
that may begin days after submission.

Before submitting, prepare a separate staging server with a stable public HTTPS
address, synthetic household data only, and a review-specific access flow that
remains usable throughout the review. Add those instructions to Play Console's
App access section and rehearse them on a clean device.

Do not expose a personal household server, use real financial records, or
enable the development-only demo reset on a public server.

The reviewer demo service must use synthetic data and a review-specific access
flow. Keep its deployment and access details out of the self-hosted household
server configuration. Rehearse the signed Free candidate on a clean device
before submission.

## Official references

- [Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en)
- [Android App Bundle](https://developer.android.com/guide/app-bundle)
- [App signing](https://developer.android.com/studio/publish/app-signing)
- [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [App access for review](https://support.google.com/googleplay/android-developer/answer/15748846?hl=en)
- [Financial features declaration](https://support.google.com/googleplay/android-developer/answer/13849271?hl=en)
- [Closed testing and production access](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
