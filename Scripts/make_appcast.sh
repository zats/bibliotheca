#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/version.env"
source "$ROOT/Scripts/release_artifacts.sh"
source "$ROOT/Scripts/sparkle_tools.sh"

ARCHES_VALUE="${ARCHES:-arm64 x86_64}"
ZIP_NAME="$(bibliotheca_app_zip_name "$MARKETING_VERSION" "$ARCHES_VALUE")"
ZIP_PATH="$ROOT/$ZIP_NAME"
WORK_DIR="$ROOT/.release/appcast"
DOWNLOAD_URL_PREFIX="${DOWNLOAD_URL_PREFIX:-https://github.com/zats/bibliotheca/releases/download/v${MARKETING_VERSION}/}"
GENERATE_APPCAST="$(bibliotheca_sparkle_tool generate_appcast "$ROOT")"

if [[ ! -f "$ZIP_PATH" ]]; then
  echo "ERROR: Missing release zip: $ZIP_PATH" >&2
  exit 1
fi

if [[ -d "$WORK_DIR" ]]; then
  trash "$WORK_DIR"
fi
mkdir -p "$WORK_DIR"
ditto "$ZIP_PATH" "$WORK_DIR/$ZIP_NAME"
ditto "$ROOT/appcast.xml" "$WORK_DIR/appcast.xml"

"$GENERATE_APPCAST" \
  --download-url-prefix "$DOWNLOAD_URL_PREFIX" \
  --embed-release-notes \
  --maximum-deltas 0 \
  -o "$ROOT/appcast.xml" \
  "$WORK_DIR"

echo "$ROOT/appcast.xml"
