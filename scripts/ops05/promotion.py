#!/usr/bin/env python3
"""OPS-05: promote an existing, completed internal AAB; never upload binaries."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/"
MAX_CODE = 2100000000
FORBIDDEN_TRACKS = {"production", "beta", "open", "internal", "qa", "internalsharing"}
APPROVAL = "PROMOTE_VERIFIED_INTERNAL_VERSION"


class Stop(RuntimeError):
    pass


def require(test, message):
    if not test:
        raise Stop(message)


def run(command):
    try:
        result = subprocess.run(command, text=True, capture_output=True, check=False, timeout=35)
    except (OSError, subprocess.SubprocessError):
        raise Stop("Trusted source metadata is unavailable") from None
    require(result.returncode == 0, "Trusted source metadata check failed")
    return result.stdout.strip()


def release_code(value):
    require(bool(re.fullmatch(r"[1-9]\d{0,9}", str(value))) and int(value) <= MAX_CODE,
            "A positive supported versionCode is required")
    return int(value)


def parse_request(env):
    require(env.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and env.get("GITHUB_REF") == "refs/heads/main"
            and env.get("GITHUB_REPOSITORY") == env.get("EXPECTED_REPO"),
            "Exact repository, main branch and manual dispatch are mandatory")
    sha = env.get("EXPECTED_MAIN_SHA", "")
    require(bool(re.fullmatch("[a-f0-9]{40}", sha)) and env.get("GITHUB_SHA") == sha,
            "Approved main SHA does not match the selected workflow")
    require(bool(re.fullmatch(r"20\d{2}-\d{2}-\d{2}-[A-Za-z0-9-]{2,48}", env.get("BATCH_ID", ""))),
            "KST release batch ID is missing or malformed")
    package = env.get("APP_PACKAGE", "")
    require(bool(re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+", package)),
            "Untrusted Play package identifier")
    internal = env.get("INTERNAL_TRACK", "")
    closed = env.get("CLOSED_TRACK", "")
    require(internal in ("internal", "qa"), "The exact Play internal/qa track must be selected")
    require(bool(re.fullmatch(r"[a-z][a-z0-9._-]{0,49}", closed))
            and closed not in FORBIDDEN_TRACKS and closed != internal,
            "Only an existing non-production closed testing track is allowed")
    code = release_code(env.get("VERSION_CODE", ""))
    digest = env.get("AAB_SHA256", "")
    require(bool(re.fullmatch("[a-f0-9]{64}", digest)), "Exact uploaded AAB SHA-256 is required")
    mode = env.get("MODE", "")
    require(mode in ("check", "promote"), "Unknown promotion mode")
    if mode == "promote":
        require(env.get("FINAL_BATCH_APPROVED") == "true"
                and env.get("APPROVAL_PHRASE") == APPROVAL,
                "Separate promotion approval is required")
        if package == "com.hebi.homecrew":
            require(env.get("HOMECREW_FINAL_APPROVAL") == "HOMECREW_FINAL_RELEASE_APPROVED",
                    "HomeCrew full-release approval is required")
    return dict(repo=env["GITHUB_REPOSITORY"], sha=sha, package=package,
                batch=env["BATCH_ID"], internal=internal, closed=closed,
                code=code, sha256=digest, mode=mode)


def verify_main(req, env):
    require(run(["git", "rev-parse", "HEAD"]) == req["sha"], "Checked-out source is stale")
    raw = run(["gh", "api", "repos/" + req["repo"] + "/git/ref/heads/main", "--jq", ".object.sha"])
    require(raw == req["sha"], "main changed since this release was approved")


def list_value(response, key):
    require(isinstance(response, dict) and "nextPageToken" not in response, "Incomplete Play inventory")
    items = response.get(key, [])
    require(isinstance(items, list) and all(isinstance(x, dict) for x in items),
            "Invalid Play " + key + " inventory")
    return items


def make_plan(tracks, bundles, req):
    require(len({x.get("track") for x in tracks}) == len(tracks), "Duplicate Play track identifiers")
    selected = [x for x in tracks if x.get("track") == req["internal"]]
    destination = [x for x in tracks if x.get("track") == req["closed"]]
    require(len(selected) == 1 and len(destination) == 1,
            "Source internal or destination closed track does not exist")
    matching = [b for b in bundles if str(b.get("versionCode")) == str(req["code"])]
    require(len(matching) == 1, "The requested versionCode is not a unique existing AAB")
    require(str(matching[0].get("sha256", "")).lower() == req["sha256"],
            "Play AAB SHA-256 differs from the approved internal artifact")
    source_releases = selected[0].get("releases", [])
    closed_releases = destination[0].get("releases", [])
    require(isinstance(source_releases, list) and isinstance(closed_releases, list),
            "Malformed Play track releases")
    exact = [r for r in source_releases if isinstance(r, dict)
             and r.get("status") == "completed"
             and r.get("versionCodes") == [str(req["code"])]]
    require(len(exact) == 1, "Exactly one completed internal release with only this AAB code is required")
    current_codes = []
    for release in closed_releases:
        require(isinstance(release, dict) and release.get("status") == "completed",
                "Existing closed track contains a draft, halted or in-progress release")
        codes = release.get("versionCodes", [])
        require(isinstance(codes, list) and len(codes) == 1,
                "Closed track includes an ambiguous multi-version release")
        current_codes.extend(release_code(x) for x in codes)
    if req["code"] in current_codes:
        require(len(current_codes) == 1, "Closed track already has the version alongside other releases")
        state = "already_completed"
    else:
        require(not current_codes or max(current_codes) < req["code"],
                "Promotion would downgrade an existing closed release")
        state = "ready"
    original = exact[0]
    name = original.get("name", str(req["code"]))
    require(isinstance(name, str) and 0 < len(name) <= 150, "Invalid internal release name")
    new_release = {"name": name, "versionCodes": [str(req["code"])], "status": "completed"}
    notes = original.get("releaseNotes")
    if notes is not None:
        require(isinstance(notes, list) and all(
            isinstance(n, dict) and isinstance(n.get("language"), str)
            and isinstance(n.get("text"), str) and len(n["text"]) <= 500 for n in notes),
            "Invalid internal release notes")
        new_release["releaseNotes"] = notes
    return {"state": state, "release": new_release, "package": req["package"],
            "source_track": req["internal"], "closed_track": req["closed"],
            "version_code": req["code"], "aab_sha256": req["sha256"]}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class Play:
    def __init__(self, token, package, transport=None):
        require(bool(token) and not any(ch.isspace() for ch in token), "Play access token unavailable")
        self.token = token
        self.base = API + package + "/edits"
        self.transport = transport or build_opener(NoRedirect()).open

    def request(self, method, suffix, data=None):
        require(method in ("GET", "POST", "PUT", "DELETE")
                and (suffix == "" or suffix.startswith("/"))
                and ".." not in suffix and "\n" not in suffix,
                "Untrusted Google Play API request")
        raw = json.dumps(data).encode("utf-8") if data is not None else None
        url = self.base + suffix
        request = Request(url, data=raw, method=method, headers={
            "Authorization": "Bearer " + self.token,
            "Accept": "application/json",
            **({"Content-Type": "application/json; charset=utf-8"} if raw is not None else {}),
        })
        try:
            with self.transport(request, timeout=90) as response:
                content = response.read()
            result = json.loads(content) if content else {}
            require(isinstance(result, dict), "Invalid Play API response")
            return result
        except HTTPError as error:
            raise Stop("Google Play " + method + " blocked (HTTP " + str(error.code) + ")") from None
        except (URLError, OSError, ValueError):
            raise Stop("Google Play request response is uncertain; do not auto-retry") from None

    def start(self):
        edit = self.request("POST", "", {}).get("id")
        require(isinstance(edit, str) and bool(re.fullmatch("[A-Za-z0-9_-]+", edit)),
                "Play returned an invalid edit ID")
        return "/" + edit

    def inventory(self, edit):
        t = list_value(self.request("GET", edit + "/tracks"), "tracks")
        b = list_value(self.request("GET", edit + "/bundles"), "bundles")
        return t, b

    def discard(self, edit):
        self.request("DELETE", edit)


def safe_receipt(req, status):
    return {"schema": "ops05-promotion-v1", "package": req["package"],
            "source_sha": req["sha"], "batch_id": req["batch"],
            "source_track": req["internal"], "closed_track": req["closed"],
            "version_code": req["code"], "aab_sha256": req["sha256"],
            "status": status, "binary_uploaded": False, "aab_rebuilt": False}


def persist(receipt):
    target = Path("ops05-output")
    target.mkdir(parents=True, exist_ok=True)
    (target / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")


def execute(mode, req, token, env):
    client = Play(token, req["package"])
    edit = client.start()
    commit_attempted = False
    try:
        tracks, bundles = client.inventory(edit)
        plan = make_plan(tracks, bundles, req)
        if mode == "check":
            return safe_receipt(req, "verified_already_completed" if plan["state"] == "already_completed" else "verified_ready_for_manual_promotion")
        require(mode == "promote" and req["mode"] == "promote", "Explicit promote-mode approval required")
        if plan["state"] == "already_completed":
            return safe_receipt(req, "already_completed_no_change")
        verify_main(req, env)
        client.request("PUT", edit + "/tracks/" + quote(req["closed"], safe=""),
                       {"track": req["closed"], "releases": [plan["release"]]})
        client.request("POST", edit + ":validate")
        verify_main(req, env)
        commit_attempted = True
        client.request("POST", edit + ":commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW")
        receipt = safe_receipt(req, "commit_accepted_readback_pending")
        persist(receipt)
        # A fresh edit checks independently that the exact closed version is completed.
        fresh = client.start()
        try:
            new_tracks, new_bundles = client.inventory(fresh)
            renewed = make_plan(new_tracks, new_bundles, req)
            require(renewed["state"] == "already_completed",
                    "Play commit was acknowledged but closed-track readback differs")
        finally:
            client.discard(fresh)
        return safe_receipt(req, "committed_and_read_back")
    except Stop:
        if commit_attempted:
            persist(safe_receipt(req, "commit_outcome_uncertain_inspect_console_no_retry"))
        raise
    finally:
        if not commit_attempted:
            client.discard(edit)


def main():
    try:
        require(len(sys.argv) == 2 and sys.argv[1] in ("guard", "check", "promote"),
                "Expected guard, check or promote")
        env = os.environ
        req = parse_request(env)
        verify_main(req, env)
        if sys.argv[1] == "guard":
            print("Manual version-only closed-test request and exact main source verified")
            return 0
        require(sys.argv[1] == "check" or sys.argv[1] == req["mode"],
                "A check-only request cannot be promoted")
        receipt = execute(sys.argv[1], req, env.get("PLAY_ACCESS_TOKEN"), env)
        persist(receipt)
        print("OPS-05:", receipt["status"], "same existing AAB code", req["code"])
        return 0
    except (Stop, KeyError, OSError, ValueError, TypeError) as error:
        print("OPS-05 blocked: " + (str(error) if isinstance(error, Stop)
                                  else "Invalid release input or Play response"), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
