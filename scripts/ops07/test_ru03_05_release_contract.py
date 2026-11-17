"""RU-03/04/05: enforce the three-stage release contract without Play access."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"


class ReleaseStageContractTests(unittest.TestCase):
    def test_ops03_is_manual_build_only(self):
        workflow = (WORKFLOWS / "release-build.yml").read_text(encoding="utf-8")
        for field in ("workflow_dispatch:", "expected_main_sha:", "batch_id:",
                      "final_batch_approved:"):
            self.assertIn(field, workflow)
        for forbidden in ("google-github-actions/auth@", "androidpublisher.googleapis.com",
                          "inputs[mode]=deploy", "inputs[deploy]=true"):
            self.assertNotIn(forbidden, workflow)

    def test_ops04_consumes_exact_existing_aab(self):
        workflow = (WORKFLOWS / "play-internal-release.yml").read_text(encoding="utf-8")
        verifier = (ROOT / "scripts/ops04/internal.py").read_text(encoding="utf-8")
        for field in ("expected_main_sha:", "build_run_id:", "artifact_name:",
                      "aab_sha256:", "version_code:", "version_name:"):
            self.assertIn(field, workflow)
        self.assertIn("actions/download-artifact@", workflow)
        self.assertIn("run-id: ${{ inputs.build_run_id }}", workflow)
        self.assertIn("python3 scripts/ops04/internal.py verify", workflow)
        self.assertIn("inputs.mode == 'publish'", workflow)
        for required in ("AAB_SHA256", "Expected exactly one AAB",
                         "Downloaded AAB SHA-256 differs",
                         "AAB applicationId, versionCode or versionName mismatch",
                         'play_uploaded": False'):
            self.assertIn(required, verifier)

    def test_ops05_promotes_without_binary_upload(self):
        workflow = (WORKFLOWS / "play-closed-release.yml").read_text(encoding="utf-8")
        promoter = (ROOT / "scripts/ops05/promotion.py").read_text(encoding="utf-8")
        for field in ("expected_main_sha:", "version_code:", "aab_sha256:",
                      "closed_track:", "final_batch_approved:", "approval_phrase:"):
            self.assertIn(field, workflow)
        self.assertIn("inputs.mode == 'promote'", workflow)
        self.assertIn("PROMOTE_VERIFIED_INTERNAL_VERSION", promoter)
        self.assertIn('aab_rebuilt": False', promoter)
        for forbidden in ("bundleRelease", "/bundles:upload", "assembleRelease"):
            self.assertNotIn(forbidden, promoter)


if __name__ == "__main__":
    unittest.main()
