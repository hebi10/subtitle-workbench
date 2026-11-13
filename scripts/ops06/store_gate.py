#!/usr/bin/env python3
"""OPS-06: fail closed before any Google Play listing/asset mutation."""
import os
from pathlib import Path
import re
import subprocess
import sys

REPOSITORY = "hebi10/subtitle-workbench"
APP_SLUG = "subtitle-workbench"
PHRASE = "APPLY_VERIFIED_PLAY_STORE_ASSETS"


class StoreApprovalError(RuntimeError):
    pass


def required(test, message):
    if not test:
        raise StoreApprovalError(message)


def command_output(command, runner=subprocess.run):
    try:
        result = runner(command, check=False, text=True, capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        raise StoreApprovalError("Source verification tool unavailable") from None
    required(result.returncode == 0, "Cannot read exact current main source")
    return result.stdout.strip()


def verify(environ, runner=subprocess.run):
    required(environ.get("GITHUB_REPOSITORY") == REPOSITORY, "Incorrect repository")
    required(environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "Manual dispatch is mandatory")
    required(environ.get("GITHUB_REF") == "refs/heads/main", "Store mutation is main-only")
    required(environ.get("OPS06_STORE_APPROVED") == "true", "Separate store-listing approval is required")
    required(environ.get("OPS06_CONFIRMATION") == PHRASE, "Explicit store-listing confirmation phrase is incorrect")
    sha = environ.get("GITHUB_SHA", "")
    wanted = environ.get("OPS06_EXPECTED_MAIN_SHA", "")
    required(bool(re.fullmatch(r"[0-9a-f]{40}", sha)) and sha == wanted, "Unapproved or stale main SHA")
    batch = environ.get("OPS06_BATCH_ID", "")
    required(bool(re.fullmatch(r"20[0-9]{2}-[0-9]{2}-[0-9]{2}-" + APP_SLUG, batch)),
             "Invalid KST batch ID; use YYYY-MM-DD-" + APP_SLUG)
    from datetime import date
    try:
        date.fromisoformat(batch[:10])
    except ValueError:
        raise StoreApprovalError("Invalid release batch calendar date") from None
    required(command_output(["git", "rev-parse", "HEAD"], runner) == sha,
             "Checked-out sources differ from approved main")
    required(command_output(["gh", "api", "repos/" + REPOSITORY + "/git/ref/heads/main",
                             "--jq", ".object.sha"], runner) == sha,
             "Main advanced after the store-listing approval")
    return {"repository": REPOSITORY, "main_sha": sha, "batch_id": batch,
            "status": "preflight_verified_no_play_mutation"}


def main():
    try:
        required(len(sys.argv) == 2 and sys.argv[1] == "apply", "Only apply preflight is supported")
        result = verify(os.environ)
        print("OPS-06 store mutation approved for exact source:", result["main_sha"])
        print("Store registration has NOT yet been changed by this guard.")
        return 0
    except StoreApprovalError as error:
        print("OPS-06 blocked: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
