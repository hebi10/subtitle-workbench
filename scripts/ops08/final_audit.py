#!/usr/bin/env python3
"""OPS-08: offline final repository release-policy verification. No Play credentials."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = "hebi10/subtitle-workbench"
REQUIRED = (
    "AGENTS.md",
    ".github/workflows/ops07-safety.yml",
    ".github/workflows/ops08-final-policy.yml",
    ".github/workflows/release-build.yml",
    ".github/workflows/play-internal-release.yml",
    ".github/workflows/play-closed-release.yml",
    ".github/workflows/ops06-store-safety.yml",
    "scripts/ops07/audit.py",
    "scripts/ops07/test_hardening.py",
    "scripts/ops07/test_store_wiring.py",
    "scripts/ops07/test_advanced.py",
    "scripts/ops04/internal.py",
    "scripts/ops05/promotion.py",
    "scripts/ops06/store_gate.py",
)


def ops07():
    path = ROOT / "scripts/ops07/audit.py"
    spec = importlib.util.spec_from_file_location("ops08_dep_ops07", path)
    if not path.is_file() or spec is None or spec.loader is None:
        raise RuntimeError("OPS-07 audit source missing")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def verified_head():
    p = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, check=False,
                       capture_output=True, text=True, timeout=20)
    if p.returncode != 0:
        raise RuntimeError("Cannot identify source revision")
    sha = p.stdout.strip()
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("Invalid checked-out source SHA")
    supplied = os.getenv("GITHUB_SHA")
    if supplied and supplied != sha:
        raise RuntimeError("GitHub Actions source SHA differs from checkout")
    return sha


def audit():
    issues = []
    files = sorted((ROOT / ".github/workflows").glob("*.yml"))
    files += sorted((ROOT / ".github/workflows").glob("*.yaml"))
    if not files:
        issues.append("No GitHub Actions workflows to inspect")
    for file in REQUIRED:
        if not (ROOT / file).is_file():
            issues.append("Missing required policy file: " + file)
    policy = ROOT / ".github/workflows/ops07-safety.yml"
    if policy.is_file():
        text = policy.read_text(encoding="utf-8")
        # OPS-07 must run for every PR; changes to legacy publishers cannot bypass it.
        if not re.search(r"(?m)^  pull_request:\s*$", text) or re.search(
                r"(?m)^  pull_request:\s*\n\s+paths\s*:", text):
            issues.append("OPS-07 PR audit has an unsafe path filter")
    native = ROOT / ".github/workflows/ops08-final-policy.yml"
    if native.is_file():
        text = native.read_text(encoding="utf-8")
        if "id-token: write" in text or "androidpublisher.googleapis.com" in text:
            issues.append("OPS-08 workflow must never access Play publishing credentials")
        if "  push:" not in text or "branches: [main]" not in text:
            issues.append("OPS-08 must independently verify merged main")
    if os.getenv("GITHUB_REPOSITORY") and os.environ["GITHUB_REPOSITORY"] != REPOSITORY:
        issues.append("Repository identity mismatch")
    if (ROOT / "scripts/ops07/audit.py").is_file():
        try:
            issues.extend(ops07().findings())
        except (ImportError, AttributeError, ValueError, OSError, SyntaxError) as exc:
            issues.append("OPS-07 verification unavailable: " + type(exc).__name__)
    manifest = {}
    for file in REQUIRED:
        path = ROOT / file
        if path.is_file():
            manifest[file] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {"schema": "ops08-final-main-policy-v1",
            "repository": REPOSITORY, "source_sha": verified_head(),
            "main_verified": os.getenv("GITHUB_REF") == "refs/heads/main",
            "event": os.getenv("GITHUB_EVENT_NAME", "local"),
            "workflow_count": len(files), "policy_hashes_sha256": manifest,
            "issues": issues, "status": "pass" if not issues else "blocked",
            "play_api_called": False, "play_uploaded": False,
            "store_changed": False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", default="ops08-output/report.json")
    args = parser.parse_args()
    try:
        result = audit()
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as exc:
        print("OPS-08 blocked: " + str(exc), file=sys.stderr)
        return 1
    path = ROOT / args.report
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("OPS-08:", result["status"], "issues:", len(result["issues"]),
          "source:", result["source_sha"], "main:", result["main_verified"])
    for issue in result["issues"]:
        print(" - " + issue)
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
