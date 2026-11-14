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
    """Interpret standard and quoted workflow event keys; unknown syntax fails closed."""
    if source is None:
        return {"unparsed"}
    lines = source.splitlines()
    position, inline = -1, ""
    for index, line in enumerate(lines):
        match = re.match(r"^(?:on|'on'|\"on\")\s*:\s*(.*?)\s*$", line)
        if match:
            position, inline = index, match.group(1)
            break
    if position < 0:
        return {"unparsed"}
    if inline and not inline.startswith("#"):
        inline = inline.split(" #", 1)[0].strip()
        if inline.startswith("["):
            values = [v.strip().strip("'\"") for v in inline.strip("[] ").split(",")]
        elif inline.startswith("{"):
            values = re.findall(r"['\"]?([A-Za-z][\w-]*)['\"]?\s*:", inline)
        else:
            values = [inline.split("#", 1)[0].strip().strip("'\"")]
        return set(values) if values and all(re.fullmatch(r"[A-Za-z][\w-]*", v) for v in values) else {"unparsed"}
    body = []
    for line in lines[position + 1:]:
        if line.strip() and not line.lstrip().startswith("#") and not line[0].isspace():
            break
        if line.strip() and not line.lstrip().startswith("#"):
            body.append(line)
    if not body:
        return {"unparsed"}
    indent = min(len(line) - len(line.lstrip()) for line in body)
    values = []
    for line in body:
        if len(line) - len(line.lstrip()) != indent:
            continue
        match = re.match(r"^(?:[A-Za-z][\w-]*|'[A-Za-z][\w-]*'|\"[A-Za-z][\w-]*\")\s*:", line.strip())
        if not match:
            return {"unparsed"}
        values.append(match.group(0).split(":", 1)[0].strip("'\" "))
    return set(values) if values else {"unparsed"}


def jobs(source):
    if source is None:
        return {}
    lines = source.splitlines()
    start = next((i for i, line in enumerate(lines) if re.match(r"^(?:jobs|'jobs'|\x22jobs\x22)\s*:\s*(?:#.*)?$", line)), -1)
    if start < 0:
        return {"__unparsed_jobs__": source} if re.search(r"(?m)^(?:jobs|'jobs'|\x22jobs\x22)\s*:", source) else {}
    children = []
    for line in lines[start + 1:]:
        if line.strip() and not line[0].isspace() and not line.lstrip().startswith("#"):
            break
        children.append(line)
    candidates = [(len(line) - len(line.lstrip()), re.match(
        r"^(?:[A-Za-z][\w-]*|'[A-Za-z][\w-]*'|\"[A-Za-z][\w-]*\")\s*:\s*(?:#.*)?$", line.strip()))
        for line in children if line.strip() and not line.lstrip().startswith("#")]
    indentation = min((depth for depth, match in candidates if match is not None), default=None)
    if indentation is None:
        return {"__unparsed_jobs__": source}
    # Mixed block and flow job mappings must be rejected, not attached to prior jobs.
    for line in children:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        depth = len(line) - len(line.lstrip())
        if depth == indentation and not re.fullmatch(
                r"""(['"]?)[A-Za-z][\w-]*\1\s*:\s*(?:#.*)?""", line.strip()):
            return {"__unparsed_jobs__": source}
    result, name, buffer = {}, None, []
    for line in children:
        depth = len(line) - len(line.lstrip())
        match = (re.match(r"^(['\"]?)([A-Za-z][\w-]*)\1\s*:\s*(?:#.*)?$", line.strip())
                 if depth == indentation else None)
        if match:
            if name is not None:
                result[name] = "\n".join(buffer)
            name, buffer = match.group(2), [line]
        elif name is not None:
            buffer.append(line)
    if name is not None:
        result[name] = "\n".join(buffer)
    return result if result else {"__unparsed_jobs__": source}


def job_condition(body):
    lines = body.splitlines()
    if not lines:
        return ""
    header_indent = len(lines[0]) - len(lines[0].lstrip())
    key_indent = header_indent + 2
    for index, line in enumerate(lines):
        if len(line) - len(line.lstrip()) != key_indent:
            continue
        match = re.match(r"^\s+if\s*:\s*(.*)$", line)
        if match is None:
            continue
        value = match.group(1).strip()
        if value in (">-", ">", "|", "|-"):
            parts = []
            for nxt in lines[index + 1:]:
                if nxt.strip() and len(nxt) - len(nxt.lstrip()) <= key_indent:
                    break
                if nxt.strip():
                    parts.append(nxt.strip())
            value = " ".join(parts)
        return re.sub(r"\s+#.*$", "", value).strip()
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
    commands = re.sub(r"\\\s*\n\s*", " ", commands)
    commands = re.sub(r"\s*(?:&&|\|\||;|\|)\s*", "\n", commands)
    if re.search(r"(?i)\bgh\s+release\s+create\b|softprops/action-gh-release|upload-google-play@", commands):
        return True
    if "androidpublisher.googleapis.com" in commands and re.search(
            r"(?i)\b(?:POST|PUT|PATCH)\b|:commit", commands):
        return True
    if re.search(r"(?i)\bgh\s+workflow\s+run\s+[^\s]*(?:play|closed|store|publish|release)[^\s]*", commands):
        return True
    dispatched = re.findall(r"(?i)actions/workflows/([A-Za-z0-9_.-]+)/dispatches", commands)
    if any(re.search(r"(?i)play|closed|store|publish|release", name) for name in dispatched):
        return True
    if "/dispatches" in commands and not dispatched:
        return True
    script_names = (r"publish[-_]?play|play[-_]?publish|play_publish|publisher\.py"
                    r"|listing(?:_images|_ko)?\.py|store[_-]?refresh|promotion\.py"
                    r"|play[-_]?release|publish-play|play[-_]?store"
                    r"|play_internal\.py|play_closed\.py|promote_internal\.py"
                    r"|play_images\.py|store_icon\.py")
    for line in commands.splitlines():
        match = re.search(r"\b(?:python(?:3(?:\.\d+)?)?|node|bash|sh)\s+(?:(?:-[uBIESOqv]+|--unbuffered)\s+)*([^\s;|]+)([^\n]*)", line)
        if not match:
            continue
        script, args = match.group(1).lower(), match.group(2).lower()
        # Existing publishers mutate even without an explicit operation flag.
        if re.search(r"(?:^|/)(?:store_icon|images_only|publish-mobile-play|publish_mobile_play)[.]py$", script):
            return True
        if not re.search(script_names, script):
            continue
        mutating = re.search(r"--(?:publish|apply|upload|r09-final)\b"
                             r"|\b(?:publish|deploy|promote|upload|apply|initialize|reconcile-alpha-draft)\b"
                             r"|--mode\s*(?:=|\s)\s*(?:apply|upload|initialize|deploy|publish)\b", args)
        if mutating:
            return True
        if re.search(r"publish[_-]?play[_-]?store[_-]?refresh", script) and not args.strip():
            return True
    return False


def automatic_mutations(filename, source):
    events = triggers(source) - {"workflow_dispatch"}
    if not events:
        return []
    relevant_file = (re.search(r"play|store|closed|promote|alpha|listing|publisher", filename, re.I)
                     or filename in {"release.yml", "mobile-release.yml", "android-release.yml",
                                     "public-release.yml", "ui-r09-full-release.yml"})
    issues = []
    workflow_jobs = jobs(source)
    if "__unparsed_jobs__" in workflow_jobs:
        return [filename + ": unsupported job mapping may contain Play publisher"]
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


def _store_mutating_command(body):
    normalized = re.sub(r"\\\s*\n\s*", " ", body)
    normalized = re.sub(r"\s*(?:&&|\|\||;)\s*", "\n", normalized)
    for line in normalized.splitlines():
        if line.lstrip().startswith(("- name:", "name:", "#")):
            continue
        if re.search(r"(?i)androidpublisher\.googleapis\.com", line) and re.search(
                r"(?i)(?:/images|/listings/|:commit)\b", line) and re.search(
                r"(?i)\b(?:POST|PUT|PATCH|DELETE)\b", line):
            return True
        match = re.search(r"\b(?:python(?:3(?:\.\d+)?)?|node)\s+(?:(?:-[uBIESOqv]+|--unbuffered)\s+)*([^\s;|]+)([^\n]*)", line)
        if not match:
            continue
        script, args = match.group(1).lower(), match.group(2).lower()
        if script.endswith("/ops06/store_gate.py"):
            continue
        if re.search(r"(?:^|/)(?:store_icon|images_only)[.]py$", script):
            return True
        if "publish_play_store_refresh" in script:
            return True
        if not re.search(r"listing|store|screenshot|play_images\.py|sync-play-store-icon|play-icon", script):
            continue
        if re.search(r"--(?:apply|publish|upload|r09-final)\b"
                     r"|--mode\s*(?:=|\s)\s*(?:apply|upload|publish)\b"
                     r"|\b(?:apply|publish|upload)\b", args):
            return True
    return False


def _workflow_steps(body):
    found = list(re.finditer(r"(?m)^( +)- [A-Za-z][\w-]*:", body))
    if not found:
        return []
    depth = min(len(item.group(1)) for item in found)
    roots = [item for item in found if len(item.group(1)) == depth]
    return [body[item.start(): (roots[i + 1].start() if i + 1 < len(roots) else len(body))]
            for i, item in enumerate(roots)]


def _step_condition(body):
    match = re.search(r"(?m)^([ \t]+)(-[ \t]+)?if:[ \t]*([^\n]+)", body)
    if not match:
        return ""
    condition = match.group(3).strip().split(" #", 1)[0].strip()
    if condition not in (">", ">-", ">+", "|", "|-", "|+"):
        return condition
    indent = len(match.group(1)) + len(match.group(2) or "")
    parts = []
    for line in body[match.end():].splitlines():
        if not line.strip():
            continue
        if len(line) - len(line.lstrip()) <= indent:
            break
        parts.append(line.strip())
    return " ".join(parts) if parts else "__unparsed_condition__"


def _safe_store_step(guard_step, mutation_steps, body, filename):
    if re.search(r"(?m)^[ \t]+(?:-[ \t]+)?continue-on-error[ \t]*:[ \t]*(?!false[ \t]*(?:#.*)?$)[^\n]+", guard_step):
        return False
    guard_command = r"(?m)^[ \t]*(?:-[ \t]+)?(?:run:[ \t]*)?python(?:3)?\s+scripts/ops06/store_gate\.py\s+apply"
    if not re.search(guard_command + r"(?:\s|$)", guard_step):
        return False
    if re.search(guard_command + r"[^\n]*(?:\|\||;[ \t]*true\b|\|(?!\|))", guard_step):
        return False
    if re.search(r"(?m)^[ \t]*(?:run:[ \t]*)?set[ \t]+\+e\b", guard_step):
        return False
    guard_cond = _step_condition(guard_step)
    if not guard_cond:
        return True
    if all(_step_condition(step) == guard_cond for step in mutation_steps):
        return True
    # One mandatory guard may cover exactly the union of separate listing branches.
    alternatives = _split_boolean(_unwrap(guard_cond), "||")
    if (len(alternatives) > 1 and all(_step_condition(step) in alternatives
                                      for step in mutation_steps)):
        return True
    if (filename == "store-icon-sync.yml" and guard_cond == "inputs.apply == true"
            and "APPLY_MANUAL:" in body and "inputs.apply" in body
            and re.search(r'if \[\[ "\$APPLY_MANUAL" == "true" \]\]; then', body)):
        return True
    return False


def store_guard_findings():
    problems = []
    folder = ROOT / ".github/workflows"
    known = {"android-play-store-images.yml", "pushoffice-store-refresh-20261111.yml",
             "play-listing-images.yml", "play-listing.yml", "store-01-images.yml",
             "play-listing-ko-asset02.yml", "play-store-icon.yml", "store-icon-sync.yml",
             "invitation-store-screenshots.yml", "play-store-01.yml",
             "store02-latest-screenshots.yml"}
    discovered = {path.name for glob in ("*.yml", "*.yaml") for path in folder.glob(glob)}
    for filename in sorted(known | discovered):
        source = read(".github/workflows/" + filename)
        if source is None:
            continue
        for name, body in jobs(source).items():
            if is_disabled(job_condition(body)) or not _store_mutating_command(body):
                continue
            steps = _workflow_steps(body)
            mutations = [i for i, step in enumerate(steps) if _store_mutating_command(step)]
            guards = [i for i, step in enumerate(steps) if "scripts/ops06/store_gate.py apply" in step]
            if not guards:
                problems.append("STORE_GUARD: " + filename + ": job " + name
                                + " does not enforce separate store approval")
                continue
            if len(guards) != 1 or not mutations:
                problems.append("STORE_GUARD: " + filename + ": cannot identify unique approval and publishing steps")
                continue
            index = guards[0]
            guard = steps[index]
            if not _safe_store_step(guard, [steps[i] for i in mutations], body, filename):
                problems.append("STORE_OPTIONAL: " + filename + ": approval is optional, ignored or not executable")
            if index in mutations:
                problems.append("STORE_ORDER: " + filename + ": approval and publication share one step")
            if any(i < index for i in mutations):
                problems.append("STORE_ORDER: " + filename + ": publication precedes approval")
            for downstream in steps[index + 1:]:
                if not (_store_mutating_command(downstream) or "google-github-actions/auth@" in downstream):
                    continue
                if re.search(r"\b(?:always|failure|cancelled)\s*\(", _step_condition(downstream)):
                    problems.append("STORE_BYPASS: " + filename + ": publication may continue after rejected approval")
                    break
            if any("google-github-actions/auth@" in step for step in steps[:index]):
                problems.append("STORE_ORDER: " + filename + ": Play authentication precedes approval")
            if any(_publishing_command(step) and ("androidpublisher.googleapis.com" in step
                    or _store_mutating_command(step)) for step in steps[:index]):
                problems.append("STORE_ORDER: " + filename + ": Play mutation precedes approval")
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
            if re.search(r"(?i)inputs\[(?:mode|deploy)\]\s*=\s*(?:deploy|initialize|publish|promote|apply|upload|true)\b", source):
                problems.append("BUILD: Play publishing mode is forbidden in build-only dispatch")
            for body in jobs(source).values():
                steps = _workflow_steps(body)
                for step in steps:
                    if not re.search(r"(?i)\bgh\s+api\b[^\n]*/dispatches\b", step):
                        continue
                    active_lines = [line.strip() for line in step.splitlines()
                                    if line.lstrip().startswith(("args+=", "gh api", "gh workflow"))]
                    mode_fields = []
                    for line in active_lines:
                        mode_fields.extend(re.findall(
                            r"""(?:^|[\s(])(?:-f|-F|--field)\s+['"]?inputs\[mode\]=([^'"\s)]+)""",
                            line))
                    if mode_fields != ["build"]:
                        problems.append("BUILD: API dispatch must pass exactly one literal build-only mode")
                local_only = "\n".join(line for line in body.splitlines()
                                       if "/dispatches" not in line)
                if _publishing_command(local_only):
                    problems.append("BUILD: build-only workflow contains a direct Play mutation")
                    break
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
            for body in jobs(source).values():
                normalized = re.sub(r"\\\s*\n\s*", " ", body)
                if re.search(
                        r"(?im)\bpython(?:3(?:\.\d+)?)?\s+(?:(?:-[uBIESOqv]+|--unbuffered)\s+)*"
                        r"[^\s;|]*publisher\.py\b[^\n]*\b(?:deploy|upload|initialize)\b[^\n]*--bundle\b",
                        normalized):
                    problems.append("CLOSED_BINARY: closed promotion may invoke a new AAB publisher")
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
        workflow_source = file.read_text(encoding="utf-8")
        if "__unparsed_jobs__" in jobs(workflow_source):
            problems.append("UNPARSED_JOBS: " + file.name + " has unsupported job syntax")
        problems.extend(automatic_mutations(file.name, workflow_source))
    problems.extend(store_guard_findings())
    if REPOSITORY in {"hebi10/GalliPick", "hebi10/TalkSullae"}:
        approved = re.compile(r"inputs[.]ops01_release_approved\s*==\s*true")
        workflows = (("play-deploy.yml", "deploy"),) if REPOSITORY.endswith("GalliPick") else (
            ("play-internal.yml", "internal-publish"),
            ("play-promote-closed.yml", "closed-publish"),
            ("play-closed.yml", "closed-publish"),
        )
        for filename, job in workflows:
            source = read(".github/workflows/" + filename)
            body = jobs(source).get(job)
            if source is None or body is None:
                problems.append("APPROVAL: " + filename + ": publisher job missing")
                continue
            if not any(approved.fullmatch(atom) for atom in _guaranteed_atoms(job_condition(body))):
                problems.append("APPROVAL: " + filename + ": " + job + " lacks mandatory OPS-01 approval")
    if REPOSITORY == "hebi10/subtitle-workbench":
        listing = read(".github/workflows/play-listing.yml")
        apply_job = jobs(listing).get("apply") if listing else None
        steps = _workflow_steps(apply_job or "")
        approval_steps = [step for step in steps if re.search(
            r"(?m)^[ \t]*(?:-[ \t]+)?run:[ \t]*python3[ \t]+scripts/ops06/store_gate\.py[ \t]+apply[ \t]*(?:#.*)?$", step)]
        if len(approval_steps) != 1:
            problems.append("STORE_BINDING: listing publisher must run a unique OPS-06 guard")
        else:
            guard = approval_steps[0]
            for key, field in (("OPS06_STORE_APPROVED", "ops06_store_approved"),
                               ("OPS06_CONFIRMATION", "ops06_confirmation"),
                               ("OPS06_EXPECTED_MAIN_SHA", "ops06_expected_main_sha"),
                               ("OPS06_BATCH_ID", "ops06_batch_id")):
                expected = "$" + "{{ inputs." + field + " }}"
                actual = re.findall(r"(?m)^[ \t]+" + re.escape(key) + r":[ \t]*([^\n#]+)", guard)
                if len(actual) != 1 or actual[0].strip() != expected:
                    problems.append("STORE_BINDING: Subtitle Workbench " + key
                                    + " must bind to an approved dispatch input")
    if REPOSITORY == "hebi10/HomeCrew":
        source = read(".github/workflows/play-internal.yml")
        release = jobs(source).get("release") if source else None
        guard = ("Require full-project release authorization before any Play mutation")
        if not release or guard not in release or not re.search(
                r'if \[\[ "\$FINAL_RELEASE_APPROVAL" != "HOMECREW_FINAL_RELEASE_APPROVED" \]\]; then', release):
            problems.append("APPROVAL: HomeCrew final release authorization gate missing")
    internal = read(".github/workflows/play-internal-release.yml")
    if internal is not None:
        for stage in ("verify", "publish"):
            body = jobs(internal).get(stage)
            steps = _workflow_steps(body or "")
            guard_command = r"(?m)^[ \t]*(?:-[ \t]+)?(?:run:[ \t]*)?python3\s+scripts/ops04/internal\.py\s+guard\b"
            guards = [(index, step) for index, step in enumerate(steps)
                      if re.search(guard_command, step)]
            if len(guards) != 1:
                problems.append("PROVENANCE: OPS-04 " + stage + " requires an executable signed-source guard")
                continue
            index, guard = guards[0]
            if (_step_condition(guard) or re.search(r"(?m)^[ \t]+(?:-[ \t]+)?continue-on-error[ \t]*:", guard)
                    or re.search(guard_command + r"[^\n]*(?:\|\||;[ \t]*true\b|\|(?!\|))", guard)
                    or re.search(r"(?m)^[ \t]*(?:run:[ \t]*)?set[ \t]+\+e\b", guard)):
                problems.append("PROVENANCE: OPS-04 " + stage + " guard must run and stop on failure")
            if any("actions/download-artifact@" in step or "google-github-actions/auth@" in step
                   for step in steps[:index]):
                problems.append("PROVENANCE: OPS-04 " + stage + " guard must precede artifact access")
            for downstream in steps[index + 1:]:
                if (re.search(r"\b(?:always|failure|cancelled)\s*\(", _step_condition(downstream))
                        and ("google-github-actions/auth@" in downstream
                             or _publishing_command(downstream))):
                    problems.append("PROVENANCE_BYPASS: OPS-04 " + stage + " can publish after a failed guard")
                    break
    if REPOSITORY == "hebi10/TripCanvas":
        promote = jobs(read(".github/workflows/play-promote.yml")).get("promote")
        if not promote or "inputs.final_release_confirmed == true" not in _guaranteed_atoms(job_condition(promote)):
            problems.append("APPROVAL: TripCanvas legacy closed promotion lacks mandatory final approval")
    if REPOSITORY == "hebi10/PetWorld":
        closed = read(".github/workflows/play-closed-release.yml") or ""
        if re.search(r"(?i)publisher[.]py\s+deploy[^\n]*--bundle", closed):
            problems.append("CLOSED: PetWorld promotion must not upload a new binary")
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
