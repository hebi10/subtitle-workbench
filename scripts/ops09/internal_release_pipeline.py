#!/usr/bin/env python3
"""OPS-09: one explicitly approved internal release, fail-closed at every boundary.

No production/closed promotion and no Play credentials in this orchestration job.
The existing OPS-03 signer and OPS-04 internal publisher retain their own checks.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from zoneinfo import ZoneInfo

CONFIG = {
    "gallipick": ("device-tests.yml", "Android verification", 1, False),
    "quickcut": ("emulator-smoke.yml", "Android build", 4, True),
    "travelframe": ("body-frame-device-qa.yml", "Quality", 9, False),
    "invitation": ("mobile-captures.yml", "CI", 2, False),
    "focuslock": ("emulator-smoke.yml", "Android CI", 2, True),
    "homecrew": ("ui-r09-device-matrix.yml", "Android CI", 6, True),
    "talksullae": ("qa-2d.yml", "Android verification", 7, False),
    "tripcanvas": ("final-device-qa.yml", "TripCanvas Android CI", 7, True),
    "livetranscribe-android": ("responsive-qa.yml", "Private Android APK", 2, False),
    "pushoffice_app": ("final-device-qa.yml", "Push Office UI validation", 4, False),
    "petworld": ("final-device-qa.yml", "Android CI", 9, True),
    "subtitle-workbench": ("android-emulator-smoke.yml", "Verify web and Android", 2, True),
}
MANUAL_NAME = {
    "gallipick": "Android device tests",
    "quickcut": "Android emulator smoke",
    "travelframe": "Body Frame native device QA",
    "invitation": "Android 화면 캡처",
    "focuslock": "Android full-screen emulator QA",
    "homecrew": "UI-R09 Android device matrix",
    "talksullae": "2-D Android and Firebase multi-environment QA",
    "tripcanvas": "TripCanvas final Android QA",
    "livetranscribe-android": "Android responsive UI QA",
    "pushoffice_app": "Push Office final Android QA",
    "petworld": "PetWorld final Android QA",
    "subtitle-workbench": "Android Emulator Smoke",
}
ANDROID = "{http://schemas.android.com/apk/res/android}"
BUNDLETOOL_URI = "https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar"
BUNDLETOOL_SHA256 = "a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def initial_settings(environ):
    repo = environ["GITHUB_REPOSITORY"]
    name = repo.split("/")[-1].lower()
    require(repo.split("/")[0].lower() == "hebi10" and name in CONFIG, "Unrecognized repository")
    qa, fast, min_qa_jobs, needs_code = CONFIG[name]
    sha = environ["EXPECTED_MAIN_SHA"]
    require(environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and environ.get("GITHUB_REF") == "refs/heads/main", "Explicit main-only dispatch required")
    require(environ.get("INTERNAL_RELEASE_APPROVED") == "true", "One-time internal release approval required")
    require(re.fullmatch("[0-9a-f]{40}", sha) and sha == environ.get("GITHUB_SHA"),
            "Requested SHA is not the selected main source")
    code = environ.get("VERSION_CODE", "")
    require(not code or (re.fullmatch("[1-9][0-9]{0,9}", code) and int(code) <= 2100000000),
            "Invalid requested versionCode")
    require(not needs_code or bool(code), "This app requires the unused build-only versionCode")
    tag = environ.get("RELEASE_TAG", "")
    if name == "gallipick":
        require(re.fullmatch(r"v[0-9]+(?:\.[0-9]+){1,3}(?:[-.][A-Za-z0-9]+)*", tag),
                "GalliPick requires a matching vX.Y.Z source release tag")
    require(not (environ.get("CLOUD_PILOT") == "true" and
                 environ.get("CLOUD_PRODUCTION") == "true"), "Choose one GalliPick cloud environment")
    return repo, name, sha, qa, fast, min_qa_jobs


class Orchestrator:
    def __init__(self, environ):
        self.repo, self.name, self.sha, self.qa_file, self.fast_name, self.min_qa_jobs = initial_settings(environ)
        self.env = environ
        self.token = environ["GH_TOKEN"]
        self.report = Path("ops09/receipt.json")
        self.report.parent.mkdir(parents=True, exist_ok=True)
        self.deadline = time.monotonic() + 335 * 60
        self.receipt = {
            "schema": "ops09-internal-request-v1", "repo": self.repo,
            "source_sha": self.sha, "stage": "approved_preflight",
            "internal_release_approved": True, "play_published": False,
            "run_url": f"https://github.com/{self.repo}/actions/runs/{environ['GITHUB_RUN_ID']}",
        }
        self.write()

    def write(self, **changes):
        self.receipt.update(changes)
        self.report.write_text(json.dumps(self.receipt, ensure_ascii=False, indent=2) + "\n",
                               encoding="utf-8")
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
            if "stage" in changes:
                summary.write(f"\nOPS-09 stage: {changes['stage']}\n")
            if "url" in changes:
                summary.write(f"\nActions run: {changes['url']}\n")

    def api(self, path, payload=None):
        require(path.startswith(f"/repos/{self.repo}/"), "Cross-repository API access forbidden")
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            "https://api.github.com" + path, data=data,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": "Bearer " + self.token,
                "X-GitHub-Api-Version": "2026-03-10",
                "User-Agent": "ops09-internal-release",
                "Content-Type": "application/json",
            },
            method="POST" if payload is not None else "GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=55) as response:
                require(response.status == 200, "Expected JSON API response; refusing uncertain mutation")
                return json.load(response)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"GitHub API rejected {path.split('?')[0]} (HTTP {exc.code})") from None

    def current_main(self):
        main = self.api(f"/repos/{self.repo}/git/ref/heads/main")
        require(main["object"]["sha"] == self.sha, "main has changed: stop before publishing")

    def existing_basic_ci(self):
        response = self.api(f"/repos/{self.repo}/actions/runs?branch=main&head_sha={self.sha}&per_page=100")
        require(response.get("total_count", 101) <= 100, "Incomplete main CI result page")
        required = [self.fast_name, "OPS-08 final main source and release policy verification"]
        if self.name == "travelframe":
            required.append("Secret Scan")
        if self.name == "talksullae":
            required.append("2-D Android and Firebase multi-environment QA")
        for name in required:
            matches = [r for r in response["workflow_runs"]
                       if r.get("name") == name and r.get("head_sha") == self.sha
                       and r.get("head_branch") == "main"
                       and r.get("event") in ("push", "workflow_dispatch")]
            require(matches, "Missing current-main basic CI: " + name)
            latest = max(matches, key=lambda r: (r.get("run_number", 0),
                                                   r.get("run_attempt", 0), r.get("id", 0)))
            require(latest.get("status") == "completed" and latest.get("conclusion") == "success",
                    "Current-main basic CI not successful: " + name)

    def dispatch(self, workflow, inputs):
        self.current_main()
        response = self.api(
            f"/repos/{self.repo}/actions/workflows/{workflow}/dispatches",
            {"ref": "main", "inputs": inputs},
        )
        run_id = response.get("workflow_run_id")
        require(type(run_id) is int and run_id > 0, "Dispatch returned no exact run ID")
        return run_id

    def wait(self, workflow, run_id):
        url = f"https://github.com/{self.repo}/actions/runs/{run_id}"
        self.write(stage="running_" + workflow, url=url)
        while time.monotonic() < self.deadline:
            run = self.api(f"/repos/{self.repo}/actions/runs/{run_id}")
            expected_path = ".github/workflows/" + workflow
            require(run.get("id") == run_id and run.get("head_sha") == self.sha
                    and run.get("head_branch") == "main"
                    and run.get("event") == "workflow_dispatch"
                    and run.get("repository", {}).get("full_name", "").lower() == self.repo.lower()
                    and run.get("path", "").split("@")[0] == expected_path,
                    "Dispatched workflow provenance mismatch: " + workflow)
            if run.get("status") == "completed":
                require(run.get("conclusion") == "success", "Required child workflow failed: " + url)
                self.current_main()
                return run
            time.sleep(25)
        raise RuntimeError("Timed out waiting for child workflow: " + url)

    def jobs(self, run_id):
        data = self.api(f"/repos/{self.repo}/actions/runs/{run_id}/jobs?per_page=100")
        jobs = data.get("jobs", [])
        require(data.get("total_count", 101) <= 100 and
                len(jobs) == data.get("total_count", -1), "Incomplete child job list")
        return jobs

    def checked_device_qa(self, run_id):
        jobs = self.jobs(run_id)
        successful = [j for j in jobs if j.get("status") == "completed"
                      and j.get("conclusion") == "success"]
        require(len(successful) >= self.min_qa_jobs, "Device QA matrix is incomplete")
        if self.name == "quickcut":
            required = {"Require frozen main and exact source SHA",
                        "emulator (29)", "emulator (35)", "emulator (36)"}
        elif self.name == "travelframe":
            required = {
                "build-apk", "capture-devices", "stage13-design-captures (phone-360dp)",
                "stage13-design-captures (phone-412dp)",
                "stage13-design-captures (tablet-600dp)",
                "stage13-design-captures (tablet-750dp)", "ui-r05-visual-verify",
                "UI-R05 native MP4 export, cancellation and populated library",
                "UI-R05 independent MP4 hash, H.264/frame and native UI audit",
            }
        else:
            required = set()
        observed = {j.get("name") for j in successful}
        require(required.issubset(observed), "Required device/MP4 QA job skipped or missing")
        self.write(stage="device_qa_success", qa_run_id=run_id)

    def artifact_list(self, run_id):
        data = self.api(f"/repos/{self.repo}/actions/runs/{run_id}/artifacts?per_page=100")
        require(data.get("total_count", 101) <= 100
                and len(data.get("artifacts", [])) == data.get("total_count", -1),
                "Incomplete signed artifact inventory")
        return data["artifacts"]

    def download(self, run_id, name, folder):
        require(re.fullmatch("[A-Za-z0-9][A-Za-z0-9._-]{1,180}", name),
                "Unsafe artifact name")
        folder.mkdir(parents=True, exist_ok=True)
        subprocess.run(["gh", "run", "download", str(run_id), "-R", self.repo,
                        "-n", name, "-D", str(folder)], check=True,
                       env={**os.environ, "GH_TOKEN": self.token},
                       stdout=subprocess.DEVNULL)

    def find_builder_run_id(self, ops03_id):
        artifacts = [a for a in self.artifact_list(ops03_id) if
                     a.get("name", "").startswith("ops03-request-")
                     and a.get("expired") is False and a.get("size_in_bytes", 0) > 0]
        require(len(artifacts) == 1, "Exactly one OPS-03 dispatch receipt required")
        folder = Path("ops09/request")
        self.download(ops03_id, artifacts[0]["name"], folder)
        manifest = folder / "request.json"
        require(manifest.is_file(), "OPS-03 builder dispatch receipt missing")
        data = json.loads(manifest.read_text(encoding="utf-8"))
        require(data.get("repo", "").lower() == self.repo.lower()
                and data.get("main_sha") == self.sha
                and data.get("request_run_id") == str(ops03_id),
                "OPS-03 dispatch receipt does not match requested main source")
        builder_id = data.get("builder_run_id")
        require(type(builder_id) is int and builder_id > 0, "OPS-03 exact builder run ID missing")
        builder_file = data.get("builder_workflow")
        require(re.fullmatch(r"[a-zA-Z0-9-]+\.yml", builder_file or ""),
                "Invalid signed builder workflow")
        return builder_id, builder_file

    def signed_name(self, name):
        low = name.lower()
        if self.name == "gallipick":
            return name.startswith("GalliPick-") and name.endswith("-play-bundle")
        if self.name == "quickcut":
            return low.startswith("quickcut-ops03-signed-aab-")
        if self.name == "travelframe":
            return low.startswith("body-frame-play-") and "receipt" not in low
        if self.name == "pushoffice_app":
            return name.startswith("PushOffice-build-internal-")
        if self.name == "invitation":
            return low.startswith("invitation-") and low.endswith("-signed")
        return "signed-release-" in low or "signed-aab" in low

    def signed_artifact(self, run_id):
        candidates = [a for a in self.artifact_list(run_id)
                      if a.get("expired") is False and a.get("size_in_bytes", 0) > 0
                      and self.signed_name(a.get("name", ""))]
        require(len(candidates) == 1, "Expected one signed AAB artifact; do not select unsigned/debug data")
        name = candidates[0]["name"]
        folder = Path("ops09/signed")
        self.download(run_id, name, folder)
        aabs = [p for p in folder.rglob("*.aab") if "unsigned" not in p.name.lower()]
        require(len(aabs) == 1 and aabs[0].stat().st_size > 10000,
                "Unique nonempty signed AAB not found in trusted artifact")
        return name, aabs[0]

    def read_bundle_identity(self, aab):
        tool = Path("ops09/bundletool.jar")
        with urllib.request.urlopen(BUNDLETOOL_URI, timeout=140) as response:
            data = response.read()
        require(hashlib.sha256(data).hexdigest() == BUNDLETOOL_SHA256,
                "Pinned bundletool checksum mismatch")
        tool.write_bytes(data)
        result = subprocess.run(["java", "-jar", str(tool), "dump", "manifest",
                                 "--bundle=" + str(aab), "--module=base"],
                                capture_output=True, text=True, check=True)
        manifest = ET.fromstring(result.stdout)
        package = manifest.attrib["package"]
        code = manifest.attrib[ANDROID + "versionCode"]
        version = manifest.attrib[ANDROID + "versionName"]
        require(re.fullmatch("[1-9][0-9]{0,9}", code)
                and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-.][A-Za-z0-9]+)*", version),
                "Invalid signed AAB version")
        publisher = Path(".github/workflows/play-internal-release.yml").read_text(encoding="utf-8")
        m = re.search(r"(?m)^  APP_PACKAGE:\s*([A-Za-z0-9._]+)\s*$", publisher)
        require(m is not None and package == m.group(1),
                "Signed AAB package differs from configured OPS-04 internal publisher")
        expected_code = self.env.get("VERSION_CODE", "")
        if expected_code:
            require(code == expected_code, "Signed AAB versionCode differs from requested versionCode")
        if self.name == "gallipick":
            require(self.env["RELEASE_TAG"] == "v" + version, "Signed AAB release tag mismatch")
        return code, version, hashlib.sha256(aab.read_bytes()).hexdigest()

    def run(self):
        self.current_main()
        self.existing_basic_ci()
        self.write(stage="basic_ci_success")
        qa_inputs = {} if self.name == "gallipick" else {"expected_main_sha": self.sha}
        if self.name == "travelframe":
            qa_inputs.update(release_qa=True,
                             release_request_id=f"tf-{self.env['GITHUB_RUN_ID']}-{self.env.get('GITHUB_RUN_ATTEMPT', '1')}")
        qa_id = self.dispatch(self.qa_file, qa_inputs)
        self.wait(self.qa_file, qa_id)
        self.checked_device_qa(qa_id)
        batch = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d")
        slug = self.name.replace("_", "-")
        batch_id = batch + "-" + slug
        inputs = {"expected_main_sha": self.sha, "batch_id": batch_id,
                  "final_batch_approved": True}
        if self.env.get("VERSION_CODE"):
            inputs["version_code"] = self.env["VERSION_CODE"]
        if self.name == "gallipick":
            inputs["release_tag"] = self.env["RELEASE_TAG"]
            inputs["cloud_pilot"] = self.env.get("CLOUD_PILOT") == "true"
            inputs["cloud_production"] = self.env.get("CLOUD_PRODUCTION") == "true"
        ops03_id = self.dispatch("release-build.yml", inputs)
        self.wait("release-build.yml", ops03_id)
        if self.name == "quickcut":
            builder_id, builder_file = ops03_id, "release-build.yml"
        else:
            builder_id, builder_file = self.find_builder_run_id(ops03_id)
            self.wait(builder_file, builder_id)
        artifact_name, aab = self.signed_artifact(builder_id)
        version_code, version_name, aab_sha256 = self.read_bundle_identity(aab)
        self.write(stage="signed_aab_verified", signed_build_run_id=builder_id,
                   artifact_name=artifact_name, version_code=int(version_code),
                   version_name=version_name, aab_sha256=aab_sha256)
        inputs = {"mode": "publish", "expected_main_sha": self.sha,
                  "build_run_id": str(builder_id), "artifact_name": artifact_name,
                  "aab_sha256": aab_sha256, "version_code": version_code,
                  "version_name": version_name, "batch_id": batch_id,
                  "final_release_approved": True,
                  "approval_phrase": "PUBLISH_VERIFIED_INTERNAL_AAB"}
        if self.name == "gallipick":
            inputs["cloud_production"] = self.env.get("CLOUD_PRODUCTION") == "true"
        self.current_main()
        publish_id = self.dispatch("play-internal-release.yml", inputs)
        self.wait("play-internal-release.yml", publish_id)
        jobs = self.jobs(publish_id)
        names = {j.get("name") for j in jobs
                 if j.get("status") == "completed" and j.get("conclusion") == "success"}
        require({"verify", "publish"}.issubset(names),
                "OPS-04 publishing job was skipped or did not succeed")
        self.write(stage="internal_publisher_success", internal_publish_run_id=publish_id,
                   play_published=True,
                   internal_publish_url=f"https://github.com/{self.repo}/actions/runs/{publish_id}")


def main():
    pipeline = Orchestrator(os.environ)
    try:
        pipeline.run()
    except Exception as exc:
        pipeline.write(stage="blocked", play_published=False,
                       error_type=type(exc).__name__, error=str(exc))
        raise


if __name__ == "__main__":
    main()
