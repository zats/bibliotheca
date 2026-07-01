#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-/Applications/Codex.app}"
if [[ ! -d "$APP_PATH" ]]; then
  echo "Codex app not found: $APP_PATH" >&2
  exit 1
fi

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP_PATH/Contents/Info.plist")"
LOG_PATH="${TMPDIR:-/tmp}/codex-relaunch.log"

/usr/bin/nohup /bin/bash -c '
set -euo pipefail
app_path="$1"
bundle_id="$2"

for _ in $(seq 1 80); do
  if ! /usr/bin/pgrep -f "$app_path/Contents" >/dev/null 2>&1; then
    break
  fi
  /bin/sleep 0.25
done

/usr/bin/open -na "$app_path"
' _ "$APP_PATH" "$BUNDLE_ID" >"$LOG_PATH" 2>&1 &

/usr/bin/osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true

for _ in $(seq 1 40); do
  if ! /usr/bin/pgrep -f "$APP_PATH/Contents" >/dev/null 2>&1; then
    exit 0
  fi
  /bin/sleep 0.25
done

/usr/bin/pkill -f "$APP_PATH/Contents" >/dev/null 2>&1 || true
