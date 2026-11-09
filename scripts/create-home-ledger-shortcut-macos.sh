#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == "Darwin" ]] || { echo "Run this installer on macOS."; exit 1; }
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$HOME/Desktop/Home Ledger Server.app"
[[ ! -e "$APP" ]] || { echo "The shortcut already exists. Rename it first; preserve any custom database settings."; exit 1; }
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
ESCAPED_ROOT="${ROOT_DIR//\\/\\\\}"
ESCAPED_ROOT="${ESCAPED_ROOT//\"/\\\"}"
cat > "$TEMP_DIR/launcher.applescript" <<EOF
on run
  set projectRoot to "$ESCAPED_ROOT"
  set terminalCommand to "cd " & quoted form of projectRoot & " && node scripts/start-home-ledger-server.mjs; echo; printf 'Server stopped. Press Return to continue: '; read answer"
  tell application "Terminal"
    activate
    do script terminalCommand
  end tell
end run
EOF
mkdir -p "$HOME/Desktop"
osacompile -o "$APP" "$TEMP_DIR/launcher.applescript"
ICONSET="$TEMP_DIR/HomeLedger.iconset"
mkdir -p "$ICONSET"
SOURCE_ICON="$ROOT_DIR/artifacts/home-ledger-mobile/assets/images/icon.png"
for SIZE in 16 32 128 256 512; do
  sips -z "$SIZE" "$SIZE" "$SOURCE_ICON" --out "$ICONSET/icon_${SIZE}x${SIZE}.png" >/dev/null
  DOUBLE=$((SIZE * 2))
  sips -z "$DOUBLE" "$DOUBLE" "$SOURCE_ICON" --out "$ICONSET/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/HomeLedger.icns"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile HomeLedger.icns" "$APP/Contents/Info.plist"
touch "$APP"
printf 'Created %s\nAllow access to Terminal when macOS asks.\n' "$APP"
echo "The shortcut uses standard data locations. Preserve existing custom settings when updating a household."
