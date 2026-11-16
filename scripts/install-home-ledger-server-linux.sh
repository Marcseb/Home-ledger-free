#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == "Linux" ]] || { echo "Run this installer on Linux." >&2; exit 2; }
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v node >/dev/null 2>&1 || {
  echo "Install Node.js 24.16 or newer (Node 24 LTS recommended), then run this script again." >&2
  exit 1
}
exec node "$ROOT_DIR/scripts/install-home-ledger-server.mjs" linux "$@"
