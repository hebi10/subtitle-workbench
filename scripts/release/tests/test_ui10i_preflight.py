import importlib.util
import json
import shutil
import tempfile
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "scripts/release/ui10i_preflight.py"
SPEC = importlib.util.spec_from_file_location("ui10i_preflight", SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class Ui10iPreflightTests(unittest.TestCase):
    def test_without_latest_capture_evidence_blocks(self):
        result = MODULE.audit(ROOT)
        self.assertEqual(result["status"], "blocked")
        self.assertFalse(result["releaseActionsPerformed"])
        self.assertTrue(any("Missing verified latest" in b for b in result["blockers"]))

    def test_historic_images_must_not_be_approved_as_latest(self):
        result = MODULE.audit(ROOT, "f" * 40)
        self.assertEqual(result["status"], "blocked")
        self.assertTrue(any("older Android code" in b for b in result["blockers"]))
        self.assertEqual(result["listingTitle"], "자막라인")
        self.assertEqual(result["assetCount"], 10)

    def test_even_old_matching_sha_has_outdated_brand_provenance(self):
        result = MODULE.audit(ROOT, "ede57b4d0c7c6b63d1a0c6e0a679fab1ce13c917")
        self.assertEqual(result["status"], "blocked")
        self.assertTrue(any(("older Android code" in b or "old brand" in b) for b in result["blockers"]))

    def test_new_android_capture_accepts_actual_source_or_equivalent_main_sha(self):
        original = "b57afccc2850f35cb675a837ff0d5437edad0936"
        equivalent = "63cf896d60dbda377174c6c323a6c8ce5ef1b4a9"
        for source_sha in [original, equivalent]:
            with self.subTest(source_sha=source_sha):
                result = MODULE.audit(ROOT, source_sha)
                self.assertEqual(result["status"], "assets-technically-verified")
                self.assertEqual(result["validImageCount"], 10)
                self.assertEqual(result["blockers"], [])

    def test_isolated_review_assets_reject_mismatched_run_or_record(self):
        original = "b57afccc2850f35cb675a837ff0d5437edad0936"
        with tempfile.TemporaryDirectory() as directory:
            assets = Path(directory) / "review"
            shutil.copytree(ROOT / "assets/play-store/ko-KR", assets)
            self.assertEqual(MODULE.audit(ROOT, original, assets)["status"], "assets-technically-verified")
            evidence_path = assets / "capture-provenance-ui10.json"
            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
            evidence["emulatorRunId"] = 1
            evidence["sourceScreenshots"][0]["source"]["sourceSHA256"] = "0" * 64
            evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
            result = MODULE.audit(ROOT, original, assets)
            self.assertEqual(result["status"], "blocked")
            self.assertTrue(any("evidence run" in b for b in result["blockers"]))
            self.assertTrue(any("provenance records differ" in b for b in result["blockers"]))

    def test_read_only_checker_does_not_include_play_api_mutations(self):
        source = SOURCE.read_text(encoding="utf-8")
        for forbidden in ["edits.commit", "androidpublisher", "PLAY_SERVICE_ACCOUNT_JSON",
                          "requests.post", "urllib.request", "subprocess.run"]:
            self.assertNotIn(forbidden, source)
        self.assertFalse(MODULE.audit(ROOT)["releaseActionsPerformed"])

    def test_reject_non_png(self):
        with self.assertRaises(ValueError):
            MODULE.png_dimensions(b"invalid")


if __name__ == "__main__":
    unittest.main()
