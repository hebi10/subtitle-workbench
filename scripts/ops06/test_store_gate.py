"""OPS-06 offline source, event and store-approval regression tests."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/ops06/store_gate.py"
spec = importlib.util.spec_from_file_location("store_gate", SCRIPT)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class FakeResult:
    def __init__(self, value):
        self.returncode = 0
        self.stdout = value


class StorePolicyTests(unittest.TestCase):
    def request(self):
        return {
            "GITHUB_REPOSITORY": gate.REPOSITORY, "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": "a"*40,
            "OPS06_STORE_APPROVED": "true",
            "OPS06_CONFIRMATION": gate.PHRASE,
            "OPS06_EXPECTED_MAIN_SHA": "a"*40,
            "OPS06_BATCH_ID": "2026-11-13-" + gate.APP_SLUG,
        }

    @staticmethod
    def runner(command, **kwargs):
        return FakeResult("a"*40 + "\n")

    def test_approved_exact_source(self):
        self.assertEqual(gate.verify(self.request(), self.runner)["status"],
                         "preflight_verified_no_play_mutation")

    def test_unauthorized_events_never_reach_github(self):
        for value in ["push", "workflow_run", "issue_comment", "pull_request", "schedule"]:
            with self.subTest(value=value):
                env = self.request()
                env["GITHUB_EVENT_NAME"] = value
                with patch.object(gate, "command_output") as command:
                    with self.assertRaises(gate.StoreApprovalError):
                        gate.verify(env)
                    command.assert_not_called()

    def test_separate_approval_required(self):
        env = self.request()
        env["OPS06_STORE_APPROVED"] = "false"
        with self.assertRaises(gate.StoreApprovalError):
            gate.verify(env)
        env = self.request()
        env["OPS06_CONFIRMATION"] = "APPLY"
        with self.assertRaises(gate.StoreApprovalError):
            gate.verify(env)

    def test_wrong_repo_or_branch_rejected(self):
        for key, value in (("GITHUB_REPOSITORY", "someone/else"),
                           ("GITHUB_REF", "refs/heads/feature"),
                           ("OPS06_EXPECTED_MAIN_SHA", "b"*40)):
            with self.subTest(key=key):
                env = self.request()
                env[key] = value
                with self.assertRaises(gate.StoreApprovalError):
                    gate.verify(env)

    def test_invalid_batch_date_and_wrong_app_rejected(self):
        for batch in ["2026-13-13-" + gate.APP_SLUG, "2026-11-13-other", "", "2026-11-13"]:
            with self.subTest(batch=batch):
                env = self.request()
                env["OPS06_BATCH_ID"] = batch
                with self.assertRaises(gate.StoreApprovalError):
                    gate.verify(env)

    def test_race_with_new_main_blocks(self):
        def stale(command, **kwargs):
            return FakeResult(("b" if command[0] == "gh" else "a")*40)
        with self.assertRaises(gate.StoreApprovalError):
            gate.verify(self.request(), stale)

    def test_approved_publisher_workflows_are_manual_and_gated(self):
        for path in ["play-listing.yml"]:
            with self.subTest(path=path):
                text = (ROOT / ".github/workflows" / path).read_text(encoding="utf-8")
                self.assertIn("  workflow_dispatch:", text)
                self.assertNotRegex(text, r"(?m)^  (workflow_run|issue_comment|schedule|push):")
                self.assertIn("OPS06_STORE_APPROVED", text)
                self.assertIn("OPS06_CONFIRMATION", text)
                self.assertIn("scripts/ops06/store_gate.py apply", text)
                self.assertIn("github.event_name == 'workflow_dispatch'", text)


if __name__ == "__main__":
    unittest.main()
