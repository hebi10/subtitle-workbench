#!/usr/bin/env python3
"""Read-only UI-10-I Play asset and verified Android-source readiness check."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
IMAGE_REQUIREMENTS = {
    "icon": ((512, 512), 1),
    "featureGraphic": ((1024, 500), 1),
    "phoneScreenshots": ((1080, 1920), 8),
}


def png_dimensions(data):
    if len(data) < 24 or data[:8] != PNG_SIGNATURE or data[12:16] != b"IHDR":
        raise ValueError("Not a valid PNG IHDR")
    return struct.unpack(">II", data[16:24])


def audit(repo_root, verified_android_sha=None):
    root = Path(repo_root)
    assets = root / "assets" / "play-store" / "ko-KR"
    blockers, checks = [], []
    manual_gates = [
        "E/F/G/H merged and verified on identical latest main source",
        "Actual latest Android 15 source screenshots and hashes verified",
        "Store icon, feature graphic and all screenshots visually approved",
        "Separate authorization for signed AAB build and Play internal upload",
        "Internal API readback and actual tester install/update verified",
        "Alpha edits.validate HTTP 400 investigated before separate promotion",
    ]
    try:
        manifest = json.loads((assets / "manifest.json").read_text(encoding="utf-8"))
        listing = json.loads((root / "docs/play-store/listing-ko.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as error:
        return {"stage": "UI-10-I", "status": "blocked",
                "blockers": ["Cannot load store asset manifest/listing: " + type(error).__name__],
                "assetCount": 0, "checkedImages": [], "manualGates": manual_gates,
                "releaseActionsPerformed": False}

    sha = str(verified_android_sha or "").lower()
    valid_sha = re.fullmatch("[0-9a-f]{40}", sha) is not None
    if not valid_sha:
        blockers.append("Missing verified latest Android 15 capture source SHA")
    capture = manifest.get("screenshotCapture") or {}
    recorded = str(capture.get("originalSourceCommit", "")).lower()
    if valid_sha and recorded != sha:
        blockers.append("Store captures originate from older Android code, not the verified source")
    if manifest.get("language") != "ko-KR" or listing.get("language") != "ko-KR":
        blockers.append("Both store manifest and listing must be ko-KR")
    if listing.get("title") != "자막라인":
        blockers.append("Listing title is not the current Android brand")

    records = {e.get("file"): e for e in manifest.get("assets", [])
               if isinstance(e, dict) and isinstance(e.get("file"), str)}
    used = set()
    for category, (required_size, count) in IMAGE_REQUIREMENTS.items():
        names = (manifest.get("images") or {}).get(category)
        if not isinstance(names, list) or len(names) != count:
            blockers.append(category + ": incorrect count in image manifest")
            continue
        for filename in names:
            checked = {"category": category, "file": filename, "valid": False}
            checks.append(checked)
            if (not isinstance(filename, str) or Path(filename).name != filename
                    or filename not in records or filename in used):
                blockers.append(category + ": unsafe or duplicate asset reference")
                continue
            used.add(filename)
            entry = records[filename]
            try:
                raw = (assets / filename).read_bytes()
                dimensions = png_dimensions(raw)
                actual_hash = hashlib.sha256(raw).hexdigest()
            except (OSError, ValueError):
                blockers.append(filename + ": image is missing or cannot be decoded")
                continue
            checked["width"], checked["height"] = dimensions
            if (dimensions != required_size or entry.get("width") != required_size[0]
                    or entry.get("height") != required_size[1]):
                blockers.append(filename + ": PNG dimensions do not match Play asset contract")
                continue
            if actual_hash != str(entry.get("sha256", "")).lower():
                blockers.append(filename + ": actual file SHA-256 differs from manifest")
                continue
            if category == "phoneScreenshots":
                source = entry.get("source") or {}
                if source.get("sourceCommit") != sha or not source.get("sourcePath"):
                    blockers.append(filename + ": no matching current Android capture provenance")
                    continue
            checked["valid"] = True

    evidence_filename = capture.get("provenanceFile")
    if not isinstance(evidence_filename, str) or Path(evidence_filename).name != evidence_filename:
        blockers.append("Original screenshot provenance file reference is invalid")
    else:
        try:
            evidence = json.loads((assets / evidence_filename).read_text(encoding="utf-8"))
            if evidence.get("sourceGitSha") != sha:
                blockers.append("Screenshot evidence does not match verified Android source")
            if evidence.get("app") != listing.get("title"):
                blockers.append("Screenshot evidence uses old brand instead of 자막라인")
        except (OSError, UnicodeError, ValueError):
            blockers.append("Cannot verify original Android screenshot evidence")

    return {"stage": "UI-10-I", "status": "blocked" if blockers else "assets-technically-verified",
            "listingTitle": listing.get("title"), "verifiedAndroidSourceSha": sha if valid_sha else None,
            "manifestAndroidSourceSha": recorded or None, "assetCount": len(checks),
            "validImageCount": sum(bool(x["valid"]) for x in checks),
            "checkedImages": checks, "blockers": blockers,
            "manualGates": manual_gates, "releaseActionsPerformed": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--capture-sha", help="Verified latest Android 15 screen capture source SHA")
    parser.add_argument("--require-assets-ready", action="store_true")
    args = parser.parse_args(argv)
    result = audit(args.repository, args.capture_sha)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 2 if args.require_assets_ready and result["status"] == "blocked" else 0


if __name__ == "__main__":
    raise SystemExit(main())
