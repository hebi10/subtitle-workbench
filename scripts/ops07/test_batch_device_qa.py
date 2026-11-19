from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
EXPECTED_NAME = "Android Emulator Smoke"
ENTRY = "android-emulator-smoke.yml"
TARGETS = []


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


class FinalDeviceBatchQATest(unittest.TestCase):
    def test_release_requires_manual_exact_sha_success(self):
        release = read(".github/workflows/release-build.yml")
        self.assertIn("REQUIRED_MANUAL_QA_JSON:", release)
        self.assertIn(EXPECTED_NAME, release)
        self.assertIn('r.get("head_sha")==sha', release)
        self.assertIn('r.get("head_branch")=="main"', release)
        self.assertIn('r.get("event")=="workflow_dispatch"', release)
        self.assertIn('if not matching: refuse("Missing manual final Android QA for exact main: "+name)', release)
        self.assertIn('latest.get("status")!="completed" or latest.get("conclusion")!="success"', release)
        self.assertIn('refs/heads/main', release)

    def test_device_run_requires_frozen_main_and_sha(self):
        workflow = read(".github/workflows/" + ENTRY)
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("expected_main_sha:", workflow)
        self.assertIn("refs/heads/main", workflow)
        self.assertIn('"$EXPECTED_MAIN_SHA" == "$GITHUB_SHA"', workflow)
        self.assertIn('gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main"', workflow)
        self.assertNotIn("  pull_request:", workflow.split("permissions:", 1)[0])

    def test_existing_device_coverage_is_preserved(self):
        workflow = read(".github/workflows/" + ENTRY)
        for path in TARGETS:
            with self.subTest(workflow=path):
                self.assertIn("uses: ./.github/workflows/" + path, workflow)
                nested = read(".github/workflows/" + path)
                self.assertIn("  workflow_call:", nested)
                self.assertIn("expected_main_sha:", nested)
        self.assertIn("REQUIRED_CI_JSON:", read(".github/workflows/release-build.yml"))


if __name__ == "__main__":
    unittest.main()
