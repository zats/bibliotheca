#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIGURATION="${CONFIGURATION:-debug}"
case "$CONFIGURATION" in
    debug|Debug) XCODE_CONFIGURATION="Debug" ;;
    release|Release) XCODE_CONFIGURATION="Release" ;;
    *) echo "ERROR: Unsupported CONFIGURATION: $CONFIGURATION" >&2; exit 1 ;;
esac
APP_NAME="Bibliotheca"
BUNDLE_ID="${BUNDLE_ID:-com.zats.Bibliotheca}"
source "$ROOT/version.env"
VERSION="${VERSION:-$MARKETING_VERSION}"
BUILD="${BUILD:-$BUILD_NUMBER}"
FEED_URL="${FEED_URL:-https://raw.githubusercontent.com/zats/bibliotheca/main/appcast.xml}"
CODESIGN_IDENTITY="${CODESIGN_IDENTITY:--}"
ARCHES_VALUE="${ARCHES:-$(uname -m)}"
DERIVED_DATA_DIR="$ROOT/.build/xcode-derived-data/$XCODE_CONFIGURATION"
BUILT_APP="$DERIVED_DATA_DIR/Build/Products/$XCODE_CONFIGURATION/$APP_NAME.app"
APP="$ROOT/.build/$CONFIGURATION/$APP_NAME.app"

xcodegen generate --spec "$ROOT/project.yml" --project "$ROOT/Bibliotheca.xcodeproj" >/dev/null

trash "$APP" 2>/dev/null || true

xcodebuild \
    -project "$ROOT/Bibliotheca.xcodeproj" \
    -scheme "$APP_NAME" \
    -configuration "$XCODE_CONFIGURATION" \
    -derivedDataPath "$DERIVED_DATA_DIR" \
    ARCHS="$ARCHES_VALUE" \
    PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
    MARKETING_VERSION="$VERSION" \
    CURRENT_PROJECT_VERSION="$BUILD" \
    FEED_URL="$FEED_URL" \
    CODE_SIGN_IDENTITY="$CODESIGN_IDENTITY" \
    build >/dev/null

ditto "$BUILT_APP" "$APP"

echo "$APP"
