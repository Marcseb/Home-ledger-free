#!/usr/bin/env bash
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 1
node scripts/start-home-ledger-server.mjs
status=$?
printf '\nServer exited with code %s.\nPress Enter to close...' "$status"
read -r _
exit "$status"
