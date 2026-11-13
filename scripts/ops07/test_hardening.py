"""Negative fixtures for OPS-07 release authorization and publishing detection."""
import importlib.util
from pathlib import Path
import unittest

AUDIT_PATH = Path(__file__).with_name("audit.py")
spec = importlib.util.spec_from_file_location("ops07_hardened_audit", AUDIT_PATH)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

MANUAL = "github.event_name == 'workflow_dispatch'"


def publisher(condition, job="deliver", command="python3 scripts/release/play_publish.py deploy"):
    return ("on:\n  push:\n  workflow_dispatch:\n"
            "jobs:\n  " + job + ":\n"
            "    if: " + condition + "\n"
            "    runs-on: ubuntu-latest\n"
            "    steps:\n      - run: " + command + "\n")


class HardeningTests(unittest.TestCase):
    def test_top_level_or_cannot_bypass_manual_dispatch(self):
        for condition in (
            MANUAL + " && inputs.approved == true || github.ref == 'refs/heads/main'",
            MANUAL + " || true",
            "false && " + MANUAL + " || success()",
            "!(true && " + MANUAL + ")",
            "not (" + MANUAL + ")",
        ):
            with self.subTest(condition=condition):
                self.assertTrue(audit.automatic_mutations("play-release.yml", publisher(condition)))

    def test_nested_or_is_safe_only_with_mandatory_manual_event(self):
        self.assertEqual(
            audit.automatic_mutations(
                "play-release.yml", publisher(
                    MANUAL + " && (inputs.approved == true || inputs.admin == true)"
                )
            ), [],
        )

    def test_disabled_job_is_not_publisher(self):
        self.assertEqual(
            audit.automatic_mutations("play-release.yml", publisher("false && inputs.approved == true")), [],
        )

    def test_renaming_publisher_does_not_hide_mutation(self):
        for job in ("deliver", "recover", "reconcile", "r09-final"):
            with self.subTest(job=job):
                self.assertTrue(audit.automatic_mutations(
                    "play-release.yml", publisher("true", job=job)))

    def test_api_mutation_detected_even_without_publisher_job_name(self):
        self.assertTrue(audit.automatic_mutations(
            "misc.yml", publisher("true", job="closed",
                                  command="curl -X POST https://androidpublisher.googleapis.com/androidpublisher/v3/applications/example")))

    def test_unsigned_smoke_is_not_play_publication(self):
        smoke = publisher("true", job="release-smoke", command="./gradlew assembleDebug")
        self.assertEqual(audit.automatic_mutations("play-preflight.yml", smoke), [])

    def test_read_only_publisher_test_is_not_play_publication(self):
        check = publisher("true", job="verify",
                          command="python3 scripts/publish-play-store-images.py --check-only")
        self.assertEqual(audit.automatic_mutations("play-listing-images.yml", check), [])


if __name__ == "__main__":
    unittest.main()
