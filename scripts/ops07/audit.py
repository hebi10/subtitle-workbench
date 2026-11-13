#!/usr/bin/env python3
"""OPS-07: offline audit of manual-only Google Play release flows."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = "hebi10/subtitle-workbench"
PACKAGE = "com.haebi.subtitle"
REQUIRED = {
 "AGENTS.md": "OPS-02 development policy",
 ".github/workflows/release-build.yml": "OPS-03 signed build-only request",
 ".github/workflows/play-internal-release.yml": "OPS-04 immutable AAB internal publisher",
 ".github/workflows/play-closed-release.yml": "OPS-05 existing-code closed promotion",
 ".github/workflows/ops06-store-safety.yml": "OPS-06 listing QA",
 "scripts/ops04/internal.py": "OPS-04 AAB digest and signer verification",
 "scripts/ops05/promotion.py": "OPS-05 approved existing-version promotion",
 "scripts/ops06/store_gate.py": "OPS-06 store listing approval",
}
AUTO = {"push","workflow_run","issue_comment","pull_request","pull_request_target",
        "schedule","repository_dispatch","workflow_call","release","create","delete"}
MUTATOR = re.compile(r"(?:^|[-_])(publish|release|deploy|promote|upload|apply)(?:$|[-_])"
                     r"|^(?:store-icon|internal-publish|closed-publish)$", re.I)


def read(path):
    file = ROOT / path
    return file.read_text(encoding="utf-8") if file.is_file() else None


def triggers(source):
    if source is None:
        return set()
    lines = source.splitlines()
    start = next((i for i, s in enumerate(lines) if s == "on:"), -1)
    if start < 0:
        inline = next((s for s in lines if s.startswith("on: ")), "")
        return set(re.findall(r"[a-z][a-z_-]+", inline[3:]))
    result = set()
    for line in lines[start+1:]:
        if line and not line[0].isspace():
            break
        match = re.match(r"^  ([a-zA-Z][\w-]*):", line)
        if match:
            result.add(match.group(1))
    return result


def jobs(source):
    if source is None:
        return {}
    tail = source.split("\njobs:\n", 1)
    if len(tail) != 2:
        return {}
    items = {}
    name = None
    buf = []
    for line in tail[1].splitlines():
        if line and not line[0].isspace():
            break
        match = re.match(r"^  ([A-Za-z][\w-]*):\s*$", line)
        if match:
            if name is not None:
                items[name] = "\n".join(buf)
            name = match.group(1)
            buf = [line]
        elif name is not None:
            buf.append(line)
    if name is not None:
        items[name] = "\n".join(buf)
    return items


def job_condition(body):
    lines = body.splitlines()
    for i, line in enumerate(lines):
        match = re.match(r"^    if:\s*(.*)$", line)
        if not match:
            continue
        parts = [match.group(1).strip()]
        for nxt in lines[i+1:]:
            if re.match(r"^    [A-Za-z][\w-]*:", nxt):
                break
            if nxt.startswith("      "):
                parts.append(nxt.strip())
        return " ".join(parts).lstrip(">- ").strip()
    return ""


def is_disabled(condition):
    return re.match(r"^false(?:\s*&&|\s*$)", condition.strip()) is not None


def is_manual_only(condition):
    cond = condition.replace('"', "'")
    return ("github.event_name == 'workflow_dispatch'" in cond
            and not re.search(r"(\|\||\bor\b)\s*\(?\s*github\.event_name", cond)
            and not re.search(r"github\.event_name == '(push|workflow_run|issue_comment|pull_request)'", cond))


def automatic_mutations(filename, source):
    events = triggers(source) & AUTO
    if not events:
        return []
    # Limit publish-job detection to Play/store and explicit GitHub APK release workflows.
    # Web/Firebase/privacy/compatibility QA jobs named 'deploy' or 'release' are unrelated.
    relevant_name = (re.search(r"play|store|closed|promote|alpha|listing|publisher", filename, re.I)
                     or filename in {"release.yml", "mobile-release.yml", "android-release.yml",
                                     "public-release.yml", "ui-r09-full-release.yml"})
    if not relevant_name and "androidpublisher.googleapis.com" not in source:
        return []
    issues = []
    for name, body in jobs(source).items():
        mutates = MUTATOR.search(name) is not None
        dispatches_publisher = ("/dispatches" in body and
                                re.search(r"play|closed|store|release", body, re.I))
        if not mutates and not dispatches_publisher:
            continue
        cond = job_condition(body)
        if is_disabled(cond) or is_manual_only(cond):
            continue
        issues.append(filename + ": job " + name + " may publish from automatic events "
                      + ",".join(sorted(events)))
    return issues


def findings():
    problems = []
    for path, label in REQUIRED.items():
        if read(path) is None:
            problems.append("MISSING: " + label + " (" + path + ")")
    for file in ("release-build.yml", "play-internal-release.yml", "play-closed-release.yml"):
        source = read(".github/workflows/" + file)
        if source is None:
            continue
        if triggers(source) != {"workflow_dispatch"}:
            problems.append("AUTO_TRIGGER: " + file + " must be workflow_dispatch-only")
        if "github.ref" not in source and "GITHUB_REF" not in source:
            problems.append("SOURCE: " + file + " missing main ref gate")
        if file == "release-build.yml":
            if "inputs[mode]=deploy" in source or "inputs[deploy]=true" in source:
                problems.append("BUILD: Play deployment must never run in release-build.yml")
        elif file == "play-internal-release.yml":
            if not all(k in source for k in ("PUBLISH_VERIFIED_INTERNAL_AAB",
                                             "ops04/internal.py verify", "inputs.mode == 'publish'")):
                problems.append("INTERNAL: explicit approval, SHA256 recheck or publish mode missing")
            if any(k in source for k in ("bundleRelease", "assembleRelease")):
                problems.append("INTERNAL: must use existing AAB, not rebuild it")
        elif file == "play-closed-release.yml":
            if not all(k in source for k in ("PROMOTE_VERIFIED_INTERNAL_VERSION",
                                             "inputs.mode == 'promote'")):
                problems.append("CLOSED: separate approved same-version promotion missing")
            if any(k in source for k in ("bundleRelease", "assembleRelease", "uploadType")):
                problems.append("CLOSED: no binary upload/build permitted")
    manual = read("AGENTS.md")
    if manual is not None and not all(k in manual for k in ("Release Batch", "Play")):
        problems.append("AGENTS: common release freeze and daily batch policy missing")
    contracts = [
        ("scripts/ops04/internal.py", ("AAB_SHA256",)),
        ("scripts/ops05/promotion.py",
         ("changesInReviewBehavior=ERROR_IF_IN_REVIEW", "aab_sha256", "version_code", "completed")),
        ("scripts/ops06/store_gate.py",
         ("OPS06_STORE_APPROVED", "OPS06_EXPECTED_MAIN_SHA", "APPLY_VERIFIED_PLAY_STORE_ASSETS"))
    ]
    for path, keys in contracts:
        source = read(path)
        if source is not None and not all(k in source for k in keys):
            problems.append("GATE: " + path + " has missing approval/hash/review safeguards")
    folder = ROOT / ".github/workflows"
    for file in sorted(list(folder.glob("*.yml")) + list(folder.glob("*.yaml"))):
        problems.extend(automatic_mutations(file.name, file.read_text(encoding="utf-8")))
    return problems


def report():
    issues = findings()
    return {"schema": "ops07-policy-audit-v1", "repository": REPOSITORY,
            "package_id": PACKAGE, "status": "pass" if not issues else "blocked",
            "blockers": issues, "real_play_api_called": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", default="ops07-policy-report.json")
    opt = parser.parse_args()
    data = report()
    dest = Path(opt.report)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("OPS-07:", data["status"], "blockers:", len(data["blockers"]))
    for item in data["blockers"]:
        print(" -", item)
