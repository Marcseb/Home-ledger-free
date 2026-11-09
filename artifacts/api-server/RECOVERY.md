# Home Ledger Master recovery

After restoring an encrypted archive onto a new PC, start the API server. When
the restored household has no active Master device session, startup prints a
one-use, 10-minute invitation targeted to the archived household's current
Master. Enter it in an upgraded Home Ledger client to re-establish that
Master's session.

An owner at the trusted PC can also create a fresh, targeted invitation at any
time:

From a source workspace:

```sh
pnpm --filter @workspace/api-server invite-master
```

For a Linux installation using the bundled API runtime, use its data-path
aware launcher instead:

```sh
pnpm run invite-master:linux
# Or, without the workspace package manager:
bash ./scripts/start-home-ledger-server.sh --invite-master
```

The Linux launcher derives and exports the same absolute database path as the
normal server launch, then invokes `dist/index.mjs --invite-master`. If only
the bundle is installed, it uses that bundle without requiring the source
build files.

Run this command on the PC that owns the Home Ledger database. The code is
printed only to that local terminal; it is not available from an HTTP
endpoint. It remains valid for 10 minutes and can be redeemed once. Creating
an invitation does not revoke existing devices. Keep the code private and do
not send it through untrusted channels.