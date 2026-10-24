#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
app="$project_root/build/Skill Pallet.app"
if [[ -z "${SKILL_PALLET_NOTARY_PROFILE:-}" ]]; then
  printf 'Set SKILL_PALLET_NOTARY_PROFILE to a notarytool keychain profile.\n' >&2; exit 1
fi
bash "$project_root/scripts/verify-release.sh" "$app" signed
mkdir -p "$project_root/dist"
stage="$(mktemp -d "$project_root/dist/.notary.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
ditto -c -k --sequesterRsrc --keepParent "$app" "$stage/Skill-Pallet-submit.zip"
xcrun notarytool submit "$stage/Skill-Pallet-submit.zip" \
  --keychain-profile "$SKILL_PALLET_NOTARY_PROFILE" --wait --output-format json > "$stage/result.json"
python3 - "$stage/result.json" <<'PY'
import json, sys
result = json.load(open(sys.argv[1]))
if result.get('status') != 'Accepted':
    raise SystemExit(f"Notarization was not accepted: {result.get('status', 'unknown')}")
print('PASS: Apple notarization accepted')
PY
xcrun stapler staple "$app"
bash "$project_root/scripts/verify-release.sh" "$app" notarized
cp "$stage/result.json" "$project_root/dist/notarization-result.json"

