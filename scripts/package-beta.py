#!/usr/bin/env python3
"""Package an unnotarized beta with the public installation guide and notices."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = (
    "README.md", "INSTALL.md", "CHANGELOG.md", "THIRD_PARTY_NOTICES.md",
    "assets/lockup.svg", "licenses/three-MIT.txt", "LICENSE",
)


def run(args):
    subprocess.run([str(arg) for arg in args], check=True)


def validate_tree(folder):
    forbidden = {"catalog.json", "catalog.py", "usage-v1.json", ".catalog-last-valid.json", "keychain-password", "skills-data.js"}
    home = str(Path.home()).encode()
    for path in folder.rglob("*"):
        if path.is_symlink():
            raise SystemExit(f"Unexpected symlink in beta payload: {path.name}")
        if not path.is_file():
            continue
        if path.name in forbidden or path.suffix in {".swift", ".py", ".p12", ".pfx", ".p8", ".pem", ".key"} or "keychain" in path.name:
            raise SystemExit(f"Private data or build source in beta payload: {path.name}")
        content = path.read_bytes()
        if home in content or re.search(rb"(?:github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY)", content):
            raise SystemExit(f"Owner home path or credential pattern in beta payload: {path.name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="Semver beta label, e.g. 0.3.6-beta.1")
    parser.add_argument("--app", type=Path, default=ROOT / "build/Skill Pallet.app")
    args = parser.parse_args()
    match = re.fullmatch(r"(\d+\.\d+\.\d+)-beta\.([1-9]\d*)", args.version)
    if not match:
        raise SystemExit("Expected a version such as 0.3.6-beta.1")
    docs = ROOT / "distribution/public"
    filename = f"Skill-Pallet-{args.version}-arm64.zip"
    for rel in ("README.md", "INSTALL.md"):
        if filename not in (docs / rel).read_text():
            raise SystemExit(f"Update {rel} to the requested beta before packaging")
    if f"## {match[1]} Beta {match[2]} " not in (docs / "CHANGELOG.md").read_text():
        raise SystemExit("Update CHANGELOG.md to the requested beta before packaging")
    app = args.app.resolve(strict=True)
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    if info.get("CFBundleIdentifier") != "com.kaido.skillpalette" or info.get("CFBundleShortVersionString") != match[1]:
        raise SystemExit("App identifier/version does not match the beta label")
    arch = subprocess.check_output(["lipo", "-archs", app / "Contents/MacOS/SkillPalette"], text=True).strip()
    if arch != "arm64":
        raise SystemExit("This beta package supports arm64 only")
    run(["codesign", "--verify", "--deep", "--strict", app])
    output = ROOT / "dist/beta" / args.version
    archive = output / f"Skill-Pallet-{args.version}-arm64.zip"
    if output.exists():
        raise SystemExit(f"Beta output already exists; do not silently replace a release: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".beta-", dir=output.parent) as temp:
        temp = Path(temp)
        payload = temp / "payload"
        payload.mkdir()
        staged_app = payload / "Skill Pallet.app"
        run(["ditto", app, staged_app])
        for rel in PUBLIC_FILES:
            target = payload / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(docs / rel, target)
        # A standalone notice works both in the ZIP and inside the app bundle.
        shutil.copy2(docs / "THIRD_PARTY_NOTICES.md", staged_app / "Contents/Resources/THIRD_PARTY_NOTICES.md")
        build = {
            "release": args.version, "channel": "beta", "appVersion": match[1],
            "build": info["CFBundleVersion"], "architecture": arch,
            "minimumMacOS": info["LSMinimumSystemVersion"],
            "signature": "ad-hoc", "notarized": False,
        }
        (payload / "BUILD-INFO.json").write_text(json.dumps(build, indent=2) + "\n")
        validate_tree(payload)
        run(["codesign", "--force", "--sign", "-", staged_app])
        run(["codesign", "--verify", "--deep", "--strict", staged_app])
        run([staged_app / "Contents/MacOS/SkillPalette", "--self-test"])
        packaged = temp / "package"
        packaged.mkdir()
        staged_archive = packaged / archive.name
        run(["ditto", "-c", "-k", "--sequesterRsrc", payload, staged_archive])
        with zipfile.ZipFile(staged_archive) as handle:
            if handle.testzip() is not None:
                raise SystemExit("ZIP integrity failed")
            for name in handle.namelist():
                if Path(name).is_absolute() or ".." in Path(name).parts:
                    raise SystemExit("Unsafe archive path")
        restored = temp / "restored"
        run(["ditto", "-x", "-k", staged_archive, restored])
        validate_tree(restored)
        run(["codesign", "--verify", "--deep", "--strict", restored / "Skill Pallet.app"])
        digest = hashlib.sha256(staged_archive.read_bytes()).hexdigest()
        (packaged / "SHA256SUMS.txt").write_text(f"{digest}  {archive.name}\n")
        (packaged / "BUILD-INFO.json").write_text(json.dumps(build, indent=2) + "\n")
        output.parent.mkdir(parents=True, exist_ok=True)
        packaged.rename(output)
    print(archive)
    print(f"SHA256 {digest}")


if __name__ == "__main__":
    main()
