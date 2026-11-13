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


def _split_boolean(expr, op):
    parts, depth, quote, start = [], 0, None, 0
    for i, char in enumerate(expr):
        if quote:
            if char == quote and (i == 0 or expr[i - 1] != "\\"):
                quote = None
        elif char in ("'", '"'):
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif depth == 0 and expr.startswith(op, i):
            parts.append(expr[start:i].strip())
            start = i + len(op)
    parts.append(expr[start:].strip())
    return parts


def _unwrap(expr):
    expr = expr.strip()
    while expr.startswith("(") and expr.endswith(")"):
        depth, quote, matches = 0, None, True
        for i, char in enumerate(expr):
            if quote:
                if char == quote and (i == 0 or expr[i - 1] != "\\"):
                    quote = None
            elif char in ("'", '"'):
                quote = char
            elif char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0 and i < len(expr) - 1:
                    matches = False
                    break
        if not matches or depth != 0:
            break
        expr = expr[1:-1].strip()
    return expr


def _guaranteed_atoms(condition):
    expr = _unwrap(condition.replace("$" + "{{", "").replace("}}", "").strip())
    if not expr or expr.startswith("!") or re.match(r"^not\b", expr):
        return set()
    alternatives = _split_boolean(expr, "||")
    if len(alternatives) > 1:
        return set.intersection(*(_guaranteed_atoms(part) for part in alternatives))
    conjuncts = _split_boolean(expr, "&&")
    if len(conjuncts) > 1:
        return set().union(*(_guaranteed_atoms(part) for part in conjuncts))
    return {expr.replace('"', "'").strip()}


def is_disabled(condition):
    return "false" in _guaranteed_atoms(condition)


def is_manual_only(condition):
    atoms = _guaranteed_atoms(condition)
    return any(re.fullmatch(r"github\.event_name\s*==\s*'workflow_dispatch'", atom) for atom in atoms)


def _publishing_command(body):
    commands = "\n".join(line for line in body.splitlines()
                         if not line.lstrip().startswith(("- name:", "name:", "#")))
    if re.search(r"(?i)\bgh\s+release\s+create\b|softprops/action-gh-release|upload-google-play@", commands):
        return True
    if "androidpublisher.googleapis.com" in commands and re.search(
            r"(?i)\b(?:POST|PUT|PATCH)\b|:commit", commands):
        return True
    if "/dispatches" in commands and re.search(r"(?i)play|closed|store|publish|release", commands):
        return True
    for line in commands.splitlines():
        match = re.search(r"\b(?:python(?:3(?:\.\d+)?)?|node|bash|sh)\s+([^\s;|]+)([^\n]*)", line)
        if not match:
            continue
        script, args = match.group(1).lower(), match.group(2).lower()
        if not re.search(r"publish[-_]?play|play[-_]?publish|play_publish|publisher\.py|listing_images\.py|store[_-]?refresh|promotion\.py|play[-_]?release|publish-play|play[-_]?store", script):
            continue
        if re.search(r"--check(?:-only)?\b|\b(?:check|verify|validate|download-bundled|test|dry-run)\b", args) and not re.search(
                r"--(?:publish|apply|upload|r09-final)\b|\b(?:publish|deploy|promote|reconcile-alpha-draft)\b", args):
            continue
        if re.search(r"--(?:publish|apply|upload|r09-final)\b|\b(?:publish|deploy|promote|upload|apply|reconcile-alpha-draft)\b", args):
            return True
        if re.search(r"publish[_-]?play[_-]?store[_-]?refresh", script) and not args.strip():
            return True
    return False


def automatic_mutations(filename, source):
    events = triggers(source) & AUTO
    if not events:
        return []
    relevant_file = (re.search(r"play|store|closed|promote|alpha|listing|publisher", filename, re.I)
                     or filename in {"release.yml", "mobile-release.yml", "android-release.yml",
                                     "public-release.yml", "ui-r09-full-release.yml"})
    issues = []
    workflow_jobs = jobs(source)
    for name, body in workflow_jobs.items():
        explicit = _publishing_command(body)
        possible = explicit or (relevant_file and MUTATOR.search(name) is not None
                                and not name.endswith("-smoke"))
        if not possible:
            continue
        condition = job_condition(body)
        if is_disabled(condition) or is_manual_only(condition):
            continue
        need = re.search(r"(?m)^    needs:\s*([A-Za-z][\w-]*)\s*$", body)
        if need and not re.search(r"\b(?:always|failure|cancelled)\s*\(", condition):
            predecessor = workflow_jobs.get(need.group(1))
            if predecessor is not None and is_disabled(job_condition(predecessor)):
                continue
        issues.append(filename + ": job " + name + " may publish from automatic events "
                      + ",".join(sorted(events)))
    return issues


def store_guard_findings():
    problems = []
    names = ("android-play-store-images.yml", "pushoffice-store-refresh-20261111.yml",
             "play-listing-images.yml")
    guard = "scripts/ops06/store_gate.py apply"
    for filename in names:
        source = read(".github/workflows/" + filename)
        if source is None:
            continue
        for name, body in jobs(source).items():
            if is_disabled(job_condition(body)):
                continue
            if not (_publishing_command(body) or MUTATOR.search(name)):
                continue
            if guard not in body:
                problems.append("STORE_GUARD: " + filename + ": job " + name
                                + " does not invoke separate store approval")
                continue
            guard_index = body.index(guard)
            auth_index = body.find("google-github-actions/auth@")
            if auth_index != -1 and auth_index < guard_index:
                problems.append("STORE_ORDER: " + filename + ": job " + name
                                + " authenticates Play before approval")
            for match in re.finditer(
                r"(?im)^\s*(?:-\s*)?(?:run:\s*)?(?:python(?:3)?|node)\s+\S+"
                r"[^\n]*(?:--apply\b|--publish\b|--r09-final\b|\s+publish(?:\s|$))", body
            ):
                if match.start() < guard_index:
                    problems.append("STORE_ORDER: " + filename + ": job " + name
                                    + " can mutate Play before approval")
                    break
    return problems


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
    problems.extend(store_guard_findings())
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
