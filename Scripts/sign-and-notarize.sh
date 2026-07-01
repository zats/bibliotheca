#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/version.env"
source "$ROOT/Scripts/release_artifacts.sh"

APP_NAME="Bibliotheca"
APP_BUNDLE="$ROOT/.build/release/${APP_NAME}.app"
ARCHES_VALUE="${ARCHES:-arm64 x86_64}"
ZIP_NAME="$(bibliotheca_app_zip_name "$MARKETING_VERSION" "$ARCHES_VALUE")"
APP_IDENTITY="${APP_IDENTITY:-}"
DITTO_BIN="${DITTO_BIN:-/usr/bin/ditto}"

if [[ -z "$APP_IDENTITY" ]]; then
  echo "ERROR: Set APP_IDENTITY to a Developer ID Application signing identity." >&2
  exit 1
fi

CONFIGURATION=release \
ARCHES="$ARCHES_VALUE" \
CODESIGN_IDENTITY="$APP_IDENTITY" \
"$ROOT/Scripts/package_app.sh" >/dev/null

if [[ -z "${APP_STORE_CONNECT_API_KEY_P8:-}" || -z "${APP_STORE_CONNECT_KEY_ID:-}" || -z "${APP_STORE_CONNECT_ISSUER_ID:-}" ]]; then
  echo "ERROR: Missing APP_STORE_CONNECT_* env vars." >&2
  exit 1
fi

NOTARY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bibliotheca-notary.XXXXXX")"
trap 'trash "$NOTARY_DIR" >/dev/null 2>&1 || true' EXIT
KEY_PATH="$NOTARY_DIR/key.p8"
NOTARY_ZIP="$NOTARY_DIR/${APP_NAME}-notary.zip"

(
  umask 077
  printf "%s" "$APP_STORE_CONNECT_API_KEY_P8" | sed "s/\\\\n/\\n/g" > "$KEY_PATH"
)

"$DITTO_BIN" --norsrc -c -k --keepParent "$APP_BUNDLE" "$NOTARY_ZIP"
xcrun notarytool submit "$NOTARY_ZIP" \
  --key "$KEY_PATH" \
  --key-id "$APP_STORE_CONNECT_KEY_ID" \
  --issuer "$APP_STORE_CONNECT_ISSUER_ID" \
  --wait
xcrun stapler staple "$APP_BUNDLE"
xattr -cr "$APP_BUNDLE"
"$DITTO_BIN" --norsrc -c -k --keepParent "$APP_BUNDLE" "$ROOT/$ZIP_NAME"
spctl -a -t exec -vv "$APP_BUNDLE"
stapler validate "$APP_BUNDLE"
echo "$ROOT/$ZIP_NAME"
