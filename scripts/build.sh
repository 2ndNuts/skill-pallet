#!/bin/bash
set -euo pipefail
mode="${1:-development}"
case "$mode" in development|release) ;; *) printf 'Usage: bash scripts/build.sh development|release\n' >&2; exit 2;; esac
project_root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "$mode" == release && -z "${SKILL_PALLET_SIGN_IDENTITY:-}" ]]; then
  printf 'SKILL_PALLET_SIGN_IDENTITY must name a Developer ID Application identity.\n' >&2; exit 1
fi
mkdir -p "$project_root/build"
stage="$(mktemp -d "$project_root/build/.stage.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
app="$stage/Skill Pallet.app"
ui="$app/Contents/Resources/UI"
mkdir -p "$app/Contents/MacOS" "$ui/interactive" "$ui/motion/assets" "$ui/audio/ui" "$ui/brand/assets" "$ui/licenses"
npm run build --prefix "$project_root/ui/interactive"
cp "$project_root/native/Info.plist" "$app/Contents/Info.plist"
cp "$project_root/ui/brand/assets/app-icon.icns" "$app/Contents/Resources/AppIcon.icns"
cp "$project_root/ui/brand/assets/status-icon.pdf" "$app/Contents/Resources/StatusIcon.pdf"
cp "$project_root/ui/brand/assets/wordmark.png" "$app/Contents/Resources/Wordmark.png"
cp "$project_root/THIRD_PARTY_NOTICES.md" "$app/Contents/Resources/THIRD_PARTY_NOTICES.md"
cp "$project_root/LICENSE" "$app/Contents/Resources/LICENSE"
for name in index.html style.css bundle.js; do cp "$project_root/ui/interactive/$name" "$ui/interactive/"; done
for name in wood-diff.jpg wood-nor_gl.jpg wood-rough.jpg; do cp "$project_root/ui/motion/assets/$name" "$ui/motion/assets/"; done
cp "$project_root/ui/audio/success-click.wav" "$ui/audio/"
cp "$project_root/ui/audio/ui/"*.wav "$ui/audio/ui/"
cp "$project_root/ui/audio/ui/CREDITS.md" "$project_root/ui/audio/ui/source-manifest.json" "$ui/audio/ui/"
for name in lockup.svg wordmark-small.svg mark-mono.svg app-icon.png; do cp "$project_root/ui/brand/assets/$name" "$ui/brand/assets/"; done
cp "$project_root/ui/motion/licenses/three-MIT.txt" "$ui/licenses/"
cp "$project_root/ui/motion/assets/sources.json" "$ui/licenses/wood-sources.json"
native="$project_root/native"
xcrun swiftc -swift-version 5 -O -target arm64-apple-macosx14.0 \
  -framework AppKit -framework SwiftUI -framework ApplicationServices -framework WebKit \
  "$native/main.swift" "$native/RecentUsage.swift" "$native/ExternalCatalog.swift" \
  "$native/CatalogSelfTests.swift" "$native/NativePaletteContent.swift" \
  "$native/NativePaletteToolbar.swift" "$native/PaletteSoundPlayer.swift" \
  "$native/WindowMotion.swift" -o "$app/Contents/MacOS/SkillPalette"
if [[ "$mode" == release ]]; then
  codesign --force --options runtime --timestamp --sign "$SKILL_PALLET_SIGN_IDENTITY" "$app"
  bash "$project_root/scripts/verify-release.sh" "$app" signed
else
  codesign --force --sign - "$app"
fi
codesign --verify --deep --strict "$app"
"$app/Contents/MacOS/SkillPalette" --self-test
if [[ -d "$project_root/build/Skill Pallet.app" ]]; then
  mv "$project_root/build/Skill Pallet.app" "$stage/previous.app"
fi
mv "$app" "$project_root/build/Skill Pallet.app"
printf '%s\n' "$project_root/build/Skill Pallet.app"

