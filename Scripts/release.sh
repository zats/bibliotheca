#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
source "$ROOT/version.env"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: Commit or stash changes before releasing." >&2
  exit 1
fi

"$ROOT/Scripts/sign-and-notarize.sh"
"$ROOT/Scripts/make_appcast.sh"
git add appcast.xml
git commit -m "Update appcast for ${MARKETING_VERSION}"
git tag -a "v${MARKETING_VERSION}" -m "Bibliotheca ${MARKETING_VERSION}"
gh release create "v${MARKETING_VERSION}" \
  "$(source "$ROOT/Scripts/release_artifacts.sh"; bibliotheca_app_zip_name "$MARKETING_VERSION" "${ARCHES:-arm64 x86_64}")" \
  --repo zats/bibliotheca \
  --title "Bibliotheca ${MARKETING_VERSION}" \
  --notes "Bibliotheca ${MARKETING_VERSION}"
git push origin main "v${MARKETING_VERSION}"
