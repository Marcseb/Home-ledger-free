#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v gnome-terminal >/dev/null || { echo "This shortcut requires GNOME Terminal."; exit 1; }
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || printf '%s/Desktop' "$HOME")"
TARGET="$DESKTOP_DIR/Home Ledger Server.desktop"
if [[ -e "$TARGET" ]]; then
  echo "A shortcut already exists. Keep it if it contains custom database settings; otherwise rename it before running this installer." >&2
  exit 1
fi
mkdir -p "$DESKTOP_DIR"
LAUNCHER="$ROOT_DIR/scripts/run-home-ledger-server-in-terminal.sh"
LAUNCHER="${LAUNCHER//\\/\\\\}"
LAUNCHER="${LAUNCHER//\"/\\\"}"
LAUNCHER="${LAUNCHER//\`/\\\`}"
LAUNCHER="${LAUNCHER//\$/\\\$}"
LAUNCHER="${LAUNCHER//%/%%}"
cat > "$TARGET" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Home Ledger Server
Comment=Start the normal-time Home Ledger household server
Exec=gnome-terminal --wait -- bash -i "$LAUNCHER"
Path=$ROOT_DIR
Icon=$ROOT_DIR/artifacts/home-ledger-mobile/assets/images/icon.png
Terminal=false
Categories=Utility;
StartupNotify=true
EOF
chmod +x "$TARGET"
gio set "$TARGET" metadata::trusted true 2>/dev/null || true
printf 'Created %s\nRight-click it and choose Allow Launching if Ubuntu asks.\n' "$TARGET"
echo "This shortcut uses standard data locations. Keep your existing launcher if your household uses custom paths."
