#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIGURATION="${CONFIGURATION:-debug}"
APP_NAME="Codex Extension"
BUNDLE_ID="${BUNDLE_ID:-com.zats.CodexExtension}"
VERSION="${VERSION:-0.1.0}"
BUILD="${BUILD:-1}"

swift build --configuration "$CONFIGURATION" --package-path "$ROOT"

BIN="$ROOT/.build/$CONFIGURATION/CodexExtension"
PRODUCT_DIR="$(cd "$(dirname "$BIN")" && pwd -P)"
APP="$ROOT/.build/$CONFIGURATION/$APP_NAME.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
FRAMEWORKS="$CONTENTS/Frameworks"
RESOURCES="$CONTENTS/Resources"
SPARKLE_FRAMEWORK="$(find "$ROOT/.build" -path '*/Sparkle.framework' -type d | head -n 1)"

trash "$APP" 2>/dev/null || true
mkdir -p "$MACOS" "$FRAMEWORKS" "$RESOURCES"
cp "$BIN" "$MACOS/CodexExtension"
ditto "$SPARKLE_FRAMEWORK" "$FRAMEWORKS/Sparkle.framework"
find "$PRODUCT_DIR" -maxdepth 1 -type d -name '*.bundle' -print0 |
    while IFS= read -r -d '' bundle; do
        ditto "$bundle" "$RESOURCES/$(basename "$bundle")"
    done
install_name_tool -add_rpath "@executable_path/../Frameworks" "$MACOS/CodexExtension"
cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>CodexExtension</string>
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
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$APP" >/dev/null

echo "$APP"
