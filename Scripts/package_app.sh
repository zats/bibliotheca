#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIGURATION="${CONFIGURATION:-debug}"
APP_NAME="Bibliotheca"
BUNDLE_ID="${BUNDLE_ID:-com.zats.Bibliotheca}"
source "$ROOT/version.env"
VERSION="${VERSION:-$MARKETING_VERSION}"
BUILD="${BUILD:-$BUILD_NUMBER}"
SPARKLE_PUBLIC_KEY="${SPARKLE_PUBLIC_KEY:-Ow8SUVrNumywzYRwXp2zHI6r4cQ+QPqp2JQX+6X5AdA=}"
FEED_URL="${FEED_URL:-https://raw.githubusercontent.com/zats/bibliotheca/main/appcast.xml}"
CODESIGN_IDENTITY="${CODESIGN_IDENTITY:--}"
ARCH_LIST=( ${ARCHES:-} )
if [[ ${#ARCH_LIST[@]} -eq 0 ]]; then
    ARCH_LIST=("$(uname -m)")
fi

PRODUCT_DIR=""
BINARIES=()
for arch in "${ARCH_LIST[@]}"; do
    swift build --configuration "$CONFIGURATION" --arch "$arch" --package-path "$ROOT" >&2
    bin_dir="$(swift build --show-bin-path --configuration "$CONFIGURATION" --arch "$arch" --package-path "$ROOT" | tail -n 1)"
    PRODUCT_DIR="${PRODUCT_DIR:-$bin_dir}"
    BINARIES+=("$bin_dir/Bibliotheca")
done

APP="$ROOT/.build/$CONFIGURATION/$APP_NAME.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
FRAMEWORKS="$CONTENTS/Frameworks"
RESOURCES="$CONTENTS/Resources"
SPARKLE_FRAMEWORK="$(find "$ROOT/.build" -path '*/Sparkle.framework' -type d | head -n 1)"

trash "$APP" 2>/dev/null || true
mkdir -p "$MACOS" "$FRAMEWORKS" "$RESOURCES"
if [[ ${#BINARIES[@]} -gt 1 ]]; then
    lipo -create "${BINARIES[@]}" -output "$MACOS/Bibliotheca"
else
    cp "${BINARIES[0]}" "$MACOS/Bibliotheca"
fi
chmod +x "$MACOS/Bibliotheca"
ditto "$SPARKLE_FRAMEWORK" "$FRAMEWORKS/Sparkle.framework"
find "$PRODUCT_DIR" -maxdepth 1 -type d -name '*.bundle' -print0 |
    while IFS= read -r -d '' bundle; do
        ditto "$bundle" "$RESOURCES/$(basename "$bundle")"
    done
install_name_tool -add_rpath "@executable_path/../Frameworks" "$MACOS/Bibliotheca"
cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>Bibliotheca</string>
    <key>CFBundleIdentifier</key>
    <string>$BUNDLE_ID</string>
    <key>CFBundleName</key>
    <string>$APP_NAME</string>
    <key>CFBundleDisplayName</key>
    <string>$APP_NAME</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>$VERSION</string>
    <key>CFBundleVersion</key>
    <string>$BUILD</string>
    <key>LSMinimumSystemVersion</key>
    <string>26.2</string>
    <key>LSUIElement</key>
    <true/>
    <key>SUFeedURL</key>
    <string>$FEED_URL</string>
    <key>SUPublicEDKey</key>
    <string>$SPARKLE_PUBLIC_KEY</string>
    <key>SUEnableAutomaticChecks</key>
    <true/>
    <key>SUAutomaticallyUpdate</key>
    <false/>
</dict>
</plist>
PLIST

if [[ "$CODESIGN_IDENTITY" == "-" ]]; then
    codesign --force --deep --sign - "$APP" >/dev/null
else
    codesign --force --deep --timestamp --options runtime --sign "$CODESIGN_IDENTITY" "$APP" >/dev/null
fi

echo "$APP"
