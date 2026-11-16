#!/usr/bin/env bash
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 1
LOCAL_PNPM_BIN="$ROOT_DIR/.tools/pnpm/node_modules/.bin"
if [[ -d "$LOCAL_PNPM_BIN" ]]; then
  export PATH="$LOCAL_PNPM_BIN:$PATH"
fi
node scripts/start-home-ledger-server.mjs
status=$?
printf '\nServer exited with code %s.\nPress Enter to close...' "$status"
read -r _
exit "$status"
