"""OPS-04 offline tests. No Google Play or GitHub mutations."""
import importlib.util
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "ops04" / "internal.py"
spec = importlib.util.spec_from_file_location("ops04_internal", SCRIPT)
internal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(internal)

class Ops04SafetyTests(unittest.TestCase):
    def environment(self, mode="publish"):
        return {
            "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_SHA": "a" * 40,
            "EXPECTED_MAIN_SHA": "a" * 40,
            "GITHUB_REPOSITORY": "hebi10/fixture",
            "BATCH_ID": "2026-11-13-fixture",
            "BUILD_RUN_ID": "12345",
            "ARTIFACT_NAME": "verified-signed-aab-123",
            "VERSION_CODE": "123",
            "VERSION_NAME": "1.0.0",
            "AAB_SHA256": "b" * 64,
            "DEPLOY_MODE": mode,
            "FINAL_RELEASE_APPROVED": "false",
            "APPROVAL_PHRASE": "",
        }

    def test_publish_requires_separate_approval_before_network(self):
        with patch.dict(os.environ, self.environment(), clear=True):
            with patch.object(internal, "github") as api:
                with self.assertRaises(internal.GateError):
                    internal.guard()
                api.assert_not_called()

    def test_bad_main_sha_rejected_before_network(self):
        data = self.environment(mode="check")
        data["EXPECTED_MAIN_SHA"] = "c" * 40
        with patch.dict(os.environ, data, clear=True):
            with patch.object(internal, "github") as api:
                with self.assertRaises(internal.GateError):
                    internal.guard()
                api.assert_not_called()

    def test_invalid_artifact_name_rejected(self):
        data = self.environment(mode="check")
        data["ARTIFACT_NAME"] = "../other-run"
        with patch.dict(os.environ, data, clear=True):
            with patch.object(internal, "github") as api:
                with self.assertRaises(internal.GateError):
                    internal.guard()
                api.assert_not_called()

    def test_missing_bundle_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(internal, "BUNDLE_PATH", Path(folder)):
                with self.assertRaises(internal.GateError):
                    internal.verify()

    def test_sha256_streaming_matches_reference(self):
        with tempfile.TemporaryDirectory() as folder:
            bundle = Path(folder) / "x.aab"
            bundle.write_bytes(b"ops04-immutable-byte-fixture")
            import hashlib
            self.assertEqual(internal.digest(bundle), hashlib.sha256(bundle.read_bytes()).hexdigest())

    def test_workflow_never_builds_or_starts_on_push(self):
        source = (ROOT / ".github" / "workflows" / "play-internal-release.yml").read_text(encoding="utf-8")
        self.assertIn("  workflow_dispatch:", source)
        self.assertNotRegex(source, r"(?m)^  (push|workflow_run|issue_comment|schedule|pull_request):")
        self.assertIn("inputs.mode == 'publish'", source)
        self.assertIn("PUBLISH_VERIFIED_INTERNAL_AAB", source)
        self.assertIn("scripts/ops04/internal.py verify", source)
        self.assertNotIn("bundleRelease", source)
        self.assertNotIn("assembleRelease", source)
        self.assertNotIn("gh release create", source)
        self.assertIn("androidpublisher", source)

if __name__ == "__main__":
    unittest.main()
