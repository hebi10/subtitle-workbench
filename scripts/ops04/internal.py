#!/usr/bin/env python3
"""OPS-04. Verify a same-main, signed AAB from an existing successful build run."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

ANDROID = "{http://schemas.android.com/apk/res/android}"
BUNDLE_PATH = Path("ops04-input")
OUT = Path("ops04-verified")

class GateError(Exception):
    pass

def require(ok, message):
    if not ok:
        raise GateError(message)

def full_sha(value):
    return bool(re.fullmatch(r"[0-9a-f]{40}", value or ""))

def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as file:
        for part in iter(lambda: file.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()

def invoke(args):
    try:
        result = subprocess.run(args, text=True, capture_output=True, timeout=180, check=False)
    except (OSError, subprocess.SubprocessError):
        raise GateError("Verification tool unavailable") from None
    require(result.returncode == 0, "Verification tool rejected the artifact")
    return result.stdout

def github(path):
    result = subprocess.run(["gh", "api", path], capture_output=True, text=True, check=False, timeout=30)
    require(result.returncode == 0, "GitHub source/build evidence cannot be read")
    try:
        data = json.loads(result.stdout)
        require(isinstance(data, dict), "Malformed GitHub evidence")
        return data
    except ValueError:
        raise GateError("Malformed GitHub evidence") from None

def guard():
    env = os.environ
    source = env.get("EXPECTED_MAIN_SHA", "")
    run_id = env.get("BUILD_RUN_ID", "")
    batch = env.get("BATCH_ID", "")
    artifact = env.get("ARTIFACT_NAME", "")
    version = env.get("VERSION_CODE", "")
    release_name = env.get("VERSION_NAME", "")
    mode = env.get("DEPLOY_MODE", "")
    require(env.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and env.get("GITHUB_REF") == "refs/heads/main", "Manual main-only dispatch required")
    require(full_sha(source) and source == env.get("GITHUB_SHA"), "Approved source SHA differs from workflow SHA")
    require(bool(re.fullmatch(r"20\d{2}-\d{2}-\d{2}-[a-z0-9-]{2,48}", batch)), "Invalid release batch")
    require(bool(re.fullmatch("[1-9][0-9]{0,9}", run_id)), "Invalid source run ID")
    require(bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{1,160}", artifact)), "Invalid artifact name")
    require(bool(re.fullmatch(r"[1-9][0-9]{0,9}", version)) and int(version) <= 2100000000, "Invalid version code")
    require(bool(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-.][A-Za-z0-9]+)*", release_name)), "Invalid version name")
    require(bool(re.fullmatch("[0-9a-f]{64}", env.get("AAB_SHA256", ""))), "Expected AAB SHA-256 required")
    require(mode in {"check", "publish"}, "Unsupported operation")
    if mode == "publish":
        require(env.get("FINAL_RELEASE_APPROVED") == "true"
                and env.get("APPROVAL_PHRASE") == "PUBLISH_VERIFIED_INTERNAL_AAB",
                "Separate explicit internal-test approval required")
    repo = env["GITHUB_REPOSITORY"]
    require(github("repos/" + repo + "/git/ref/heads/main")["object"]["sha"] == source, "Main advanced")
    run = github("repos/" + repo + "/actions/runs/" + run_id)
    require(run.get("head_sha") == source and run.get("head_branch") == "main"
            and run.get("event") == "workflow_dispatch"
            and run.get("status") == "completed" and run.get("conclusion") == "success"
            and run.get("repository", {}).get("full_name") == repo, "Build run source or status differs")
    path = run.get("path", "")
    target = env.get("BUILD_WORKFLOW_FILE", "")
    require(path.split("@")[0].endswith("/" + target) or path.split("@")[0] == target,
            "Build run is not the approved signing workflow")
    records = github("repos/" + repo + "/actions/runs/" + run_id + "/artifacts?per_page=100")
    artifacts = records.get("artifacts", [])
    matches = [a for a in artifacts if a.get("name") == artifact and a.get("expired") is False]
    require(len(matches) == 1 and records.get("total_count", 0) <= 100
            and matches[0].get("size_in_bytes", 0) > 0, "Unique, unexpired signed-build artifact required")
    print("Trusted build run and exact unexpired artifact verified", run_id, artifact)

def verify():
    env = os.environ
    matches = [p for p in BUNDLE_PATH.rglob("*.aab") if p.is_file()]
    require(len(matches) == 1, "Expected exactly one AAB in the signed build artifact")
    aab = matches[0]
    require(not aab.is_symlink() and 0 < aab.stat().st_size < 2_000_000_000,
            "Missing, unsafe or oversized bundle")
    require(all(not p.is_symlink() for p in aab.parents if p != Path(".")), "Unsafe AAB path")
    actual = digest(aab)
    require(actual == env["AAB_SHA256"], "Downloaded AAB SHA-256 differs from approved bytes")
    signer = re.sub(r"[:\s]", "", env.get("PINNED_UPLOAD_CERT", "")).lower()
    require(bool(re.fullmatch(r"[a-f0-9]{64}", signer)), "Existing upload certificate pin unavailable")
    # Reuse this repository's established strict signing preflight.
    invoke(["python3", "scripts/release/preflight.py", "verify-bundle", "--bundle", str(aab)])
    tool = Path(os.environ["BUNDLETOOL_JAR"])
    require(tool.is_file() and digest(tool) == "a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29",
            "Bundletool is not the fixed approved release")
    invoke(["java", "-jar", str(tool), "validate", "--bundle=" + str(aab)])
    xml = invoke(["java", "-jar", str(tool), "dump", "manifest", "--bundle=" + str(aab), "--module=base"])
    try:
        manifest = ET.fromstring(xml)
        identity = (manifest.attrib["package"], manifest.attrib[ANDROID + "versionCode"],
                    manifest.attrib[ANDROID + "versionName"])
    except (ET.ParseError, KeyError):
        raise GateError("Cannot read AAB package/version manifest") from None
    require(identity == (env["APP_PACKAGE"], env["VERSION_CODE"], env["VERSION_NAME"]),
            "AAB applicationId, versionCode or versionName mismatch")
    OUT.mkdir(exist_ok=True)
    evidence = {"schema": "ops04-verified-aab-v1", "source_sha": env["EXPECTED_MAIN_SHA"],
                "batch_id": env["BATCH_ID"], "build_run_id": env["BUILD_RUN_ID"],
                "source_artifact": env["ARTIFACT_NAME"], "aab_sha256": actual,
                "certificate_sha256": signer, "application_id": identity[0],
                "version_code": int(identity[1]), "version_name": identity[2],
                "aab_path": str(aab), "play_uploaded": False}
    (OUT / "verified.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    with Path(env["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
        output.write("aab=" + str(aab) + "\n")
    print("Verified preexisting signed AAB", actual, identity)

def main():
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in ("guard", "verify"):
            raise GateError("Expected guard or verify")
        (guard if sys.argv[1] == "guard" else verify)()
    except (GateError, KeyError, OSError, ValueError) as exc:
        print("OPS-04 fail closed: " + str(exc), file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
