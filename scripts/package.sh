#!/bin/bash
set -euo pipefail
mode="${1:-release}"
case "$mode" in development|release) ;; *) printf 'Usage: bash scripts/package.sh development|release\n' >&2; exit 2;; esac
project_root="$(cd "$(dirname "$0")/.." && pwd)"
app="$project_root/build/Skill Pallet.app"
codesign --verify --deep --strict "$app"
if [[ "$mode" == release ]]; then bash "$project_root/scripts/verify-release.sh" "$app" notarized; fi
version="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app/Contents/Info.plist")"
suffix=''; if [[ "$mode" == development ]]; then suffix='-development'; fi
mkdir -p "$project_root/dist"
stage="$(mktemp -d "$project_root/dist/.package.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
ditto "$app" "$stage/Skill Pallet.app"
cp "$project_root/THIRD_PARTY_NOTICES.md" "$stage/THIRD_PARTY_NOTICES.md"
if [[ "$mode" == development ]]; then
  printf 'Skill Pallet %s — development build\n\nApple Silicon / macOS 14+.\nDeveloper ID signing and notarization are not included. This archive is for development verification.\nSee the private repository README and docs/DISTRIBUTION.md for status.\n' "$version" > "$stage/README.txt"
else
  printf 'Skill Pallet %s\n\nApple Silicon / macOS 14+.\nMove Skill Pallet.app to Applications and open it. Allow Accessibility access, then request a catalog from Codex using the refresh button.\nSee THIRD_PARTY_NOTICES.md for asset credits.\n' "$version" > "$stage/README.txt"
fi
archive="$project_root/dist/Skill-Pallet-$version-arm64$suffix.zip"
ditto -c -k --sequesterRsrc "$stage" "$archive"
(cd "$project_root/dist" && shasum -a 256 "$(basename "$archive")" > SHA256SUMS.txt)
printf '%s\n' "$archive"
