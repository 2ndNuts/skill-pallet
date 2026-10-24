#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
app="${1:-$project_root/build/Skill Pallet.app}"
phase="${2:-notarized}"
case "$phase" in signed|notarized) ;; *) printf 'Expected signed or notarized.\n' >&2; exit 2;; esac
codesign --verify --deep --strict "$app"
python3 - "$app" <<'PY'
import plistlib, subprocess, sys
from pathlib import Path
app = Path(sys.argv[1])
info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
if info.get('CFBundleIdentifier') != 'com.kaido.skillpalette':
    raise SystemExit('Unexpected app identifier')
result = subprocess.run(['codesign','-d','--verbose=4',str(app)],capture_output=True,text=True,check=True)
details = result.stdout + result.stderr
if 'Authority=Developer ID Application:' not in details:
    raise SystemExit('A Developer ID Application signature is required for release')
team = next((line.split('=',1)[1] for line in details.splitlines() if line.startswith('TeamIdentifier=')), '')
if not team or team == 'not set':
    raise SystemExit('Missing Developer ID team')
if '(runtime)' not in details or 'Timestamp=' not in details:
    raise SystemExit('Hardened Runtime and a secure timestamp are required')
ui = app / 'Contents/Resources/UI'
for unwanted in ['catalog.json','catalog.py','usage-v1.json','.catalog-last-valid.json','skills-data.js']:
    if any(p.name == unwanted for p in app.rglob('*')):
        raise SystemExit(f'Personal or preview data was bundled: {unwanted}')
for path in ['audio/ui/CREDITS.md','licenses/three-MIT.txt','licenses/wood-sources.json']:
    if not (ui/path).is_file():
        raise SystemExit(f'Missing third-party notice: {path}')
print(f'PASS: Developer ID {team}, Hardened Runtime, timestamp and resource boundaries')
PY
if [[ "$phase" == notarized ]]; then
  xcrun stapler validate "$app"
  spctl --assess --type execute --verbose=2 "$app"
fi

