import importlib.util
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
        self.assertTrue(any("old brand" in b for b in result["blockers"]))

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
