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


    def billing_manifest(self):
        import xml.etree.ElementTree as ET
        return ET.fromstring(
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android">'
            '<application><meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" '
            'android:value="ca-app-pub-3239289311207399~7319957827" /></application></manifest>'
        )

    def billing_resources(self, values):
        def dump(args):
            name = args[-2].split("/")[-1]
            if name not in values:
                return ""
            return f'0x7F120001 - string/{name}\n    (default) - [STR] "{values[name]}"'
        return dump

    def billing_values(self):
        return {
            "subtitle_banner_ad_unit_id": "ca-app-pub-3239289311207399/5992057572",
            "subtitle_billing_verifier_url": "https://billing.example.com",
            "subtitle_billing_cloud_project": "1234567890",
        }

    def test_configured_monetization_is_accepted_from_embedded_aab_values(self):
        with patch.object(internal, "invoke", side_effect=self.billing_resources(self.billing_values())):
            internal.verify_release_monetization(Path("signed.aab"), Path("bundletool.jar"), self.billing_manifest())

    def test_missing_billing_origin_or_project_fails_closed(self):
        for key, bad in (("subtitle_billing_verifier_url", ""),
                         ("subtitle_billing_verifier_url", "http://billing.example.com"),
                         ("subtitle_billing_cloud_project", "0"),
                         ("subtitle_billing_cloud_project", "99999999999999999999")):
            with self.subTest(key=key, bad=bad):
                values = self.billing_values()
                values[key] = bad
                with patch.object(internal, "invoke", side_effect=self.billing_resources(values)):
                    with self.assertRaises(internal.GateError):
                        internal.verify_release_monetization(Path("signed.aab"), Path("bundletool.jar"),
                                                            self.billing_manifest())

    def test_test_ad_unit_or_missing_compiled_resource_fails_closed(self):
        values = self.billing_values()
        values["subtitle_banner_ad_unit_id"] = "ca-app-pub-3940256099942544/9214589741"
        with patch.object(internal, "invoke", side_effect=self.billing_resources(values)):
            with self.assertRaises(internal.GateError):
                internal.verify_release_monetization(Path("signed.aab"), Path("bundletool.jar"),
                                                    self.billing_manifest())
        values = self.billing_values()
        del values["subtitle_billing_cloud_project"]
        with patch.object(internal, "invoke", side_effect=self.billing_resources(values)):
            with self.assertRaises(internal.GateError):
                internal.verify_release_monetization(Path("signed.aab"), Path("bundletool.jar"),
                                                    self.billing_manifest())

    def test_verified_aab_upload_path_calls_monetization_gate(self):
        source = (ROOT / "scripts" / "ops04" / "internal.py").read_text(encoding="utf-8")
        self.assertIn("verify_release_monetization(aab, tool, manifest)", source)

if __name__ == "__main__":
    unittest.main()
