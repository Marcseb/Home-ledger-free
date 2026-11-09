#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-server}"

if [[ "$#" -gt 1 || ( "$MODE" != "server" && "$MODE" != "--invite-master" ) ]]; then
  printf 'Usage: %s [--invite-master]\n' "$0" >&2
  exit 2
fi

require_absolute_path() {
  local variable_name="$1"
  local value="$2"
  if [[ -z "${value//[[:space:]]/}" || "$value" != /* ]]; then
    printf '%s must be set to an absolute path\n' "$variable_name" >&2
    exit 1
  fi
}

if [[ -n "${XDG_DATA_HOME:-}" ]]; then
  require_absolute_path "XDG_DATA_HOME" "$XDG_DATA_HOME"
  DATA_HOME="$XDG_DATA_HOME"
else
  require_absolute_path "HOME" "${HOME:-}"
  DATA_HOME="$HOME/.local/share"
fi

export APP_VARIANT="${APP_VARIANT:-production}"
export NODE_ENV="${NODE_ENV:-production}"
export HOST="${HOST:-0.0.0.0}"
export BACKUP_INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
export BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
export PAIRING_CODE_TTL_MINUTES="${PAIRING_CODE_TTL_MINUTES:-10}"
export SESSION_TTL_DAYS="${SESSION_TTL_DAYS:-30}"

if [[ "$APP_VARIANT" != "production" && "$APP_VARIANT" != "accelerated-test" ]]; then
  printf 'APP_VARIANT must be production or accelerated-test\n' >&2
  exit 1
fi

if [[ "$APP_VARIANT" == "accelerated-test" ]]; then
  DEFAULT_PORT="5001"
  DEFAULT_DATA_DIR="$DATA_HOME/home-ledger-accelerated-test"
else
  DEFAULT_PORT="5000"
  DEFAULT_DATA_DIR="$DATA_HOME/home-ledger"
fi

if [[ "$APP_VARIANT" == "accelerated-test" && "${PORT:-$DEFAULT_PORT}" == "5000" ]]; then
  printf 'Accelerated-test mode cannot use the production port 5000\n' >&2
  exit 1
fi
if [[ "$APP_VARIANT" == "accelerated-test" && -n "${BUDGET_DB_PATH:-}" && "$BUDGET_DB_PATH" != "$DEFAULT_DATA_DIR/"* ]]; then
  printf 'Accelerated-test mode requires BUDGET_DB_PATH under %s\n' "$DEFAULT_DATA_DIR" >&2
  exit 1
fi
export PORT="${PORT:-$DEFAULT_PORT}"
export BUDGET_DB_PATH="${BUDGET_DB_PATH:-$DEFAULT_DATA_DIR/home-ledger.sqlite}"

require_absolute_path "BUDGET_DB_PATH" "$BUDGET_DB_PATH"
if [[ -n "${BUDGET_RECOVERY_DIR:-}" ]]; then
  require_absolute_path "BUDGET_RECOVERY_DIR" "$BUDGET_RECOVERY_DIR"
  if [[ ! -d "$BUDGET_RECOVERY_DIR" ]]; then
    printf 'Warning: BUDGET_RECOVERY_DIR is unavailable; scheduled encrypted backups will not succeed until it is mounted.\n' >&2
  fi
fi

mkdir -p "$(dirname "$BUDGET_DB_PATH")"
chmod 700 "$(dirname "$BUDGET_DB_PATH")"

printf 'Home Ledger database: %s\n' "$BUDGET_DB_PATH"
printf 'Configured recovery destination: %s\n' "${BUDGET_RECOVERY_DIR:-not configured (manual export only)}"
if [[ -n "${BUDGET_BACKUP_DIR:-}" ]]; then
  printf 'Warning: BUDGET_BACKUP_DIR is obsolete; historical plaintext snapshots remain untouched. Set BUDGET_RECOVERY_DIR for encrypted copies.\n' >&2
fi
printf 'Home Ledger variant:   %s\n' "$APP_VARIANT"

cd "$ROOT_DIR"
if [[ "$MODE" == "--invite-master" && ! -f "$ROOT_DIR/artifacts/api-server/build.mjs" ]]; then
  if [[ ! -f "$ROOT_DIR/artifacts/api-server/dist/index.mjs" ]]; then
    printf 'Bundled API entrypoint is missing: %s\n' "$ROOT_DIR/artifacts/api-server/dist/index.mjs" >&2
    exit 1
  fi
else
  pnpm --filter @workspace/api-server run build
fi
if [[ "$MODE" == "--invite-master" ]]; then
  exec node --enable-source-maps ./artifacts/api-server/dist/index.mjs --invite-master
fi
exec pnpm --filter @workspace/api-server run start