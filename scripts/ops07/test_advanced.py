"""Additional fail-closed cases for GitHub Actions Play publishing boundaries."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("ops07_audit_advanced", Path(__file__).with_name("audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def workflow(event, command, *, job="sync", indent="  ", quoted=False):
    on = '"on":' if quoted else "on:"
    return (on + "\n" + indent + event + ":\njobs:\n"
            + indent + job + ":\n"
            + indent * 2 + "runs-on: ubuntu-latest\n"
            + indent * 2 + "steps:\n"
            + indent * 3 + "- run: " + command + "\n")


class AdvancedAuditTests(unittest.TestCase):
    def test_quoted_on_and_unusual_indentation(self):
        value = workflow("push", "python3 scripts/release/publisher.py deploy",
                         indent="    ", quoted=True)
        self.assertTrue(audit.automatic_mutations("custom.yml", value))

    def test_unknown_automatic_events_not_ignored(self):
        for event in ("deployment", "merge_group", "workflow_run"):
            with self.subTest(event=event):
                value = workflow(event, "python3 scripts/release/publisher.py deploy")
                self.assertTrue(audit.automatic_mutations("custom.yml", value))

    def test_multiline_listing_mode_and_repo_specific_publishers(self):
        for script in ("scripts/play/listing_ko.py", "scripts/play/listing_images.py",
                       "scripts/release/play_internal.py", "scripts/release/play_closed.py"):
            command = "python3 " + script + " \\\n          --mode apply"
            with self.subTest(script=script):
                self.assertTrue(audit.automatic_mutations("custom.yml",
                                                            workflow("push", command)))

    def test_build_only_rejects_initialize_mode(self):
        code = ("on:\n  workflow_dispatch:\njobs:\n  build:\n    runs-on: ubuntu-latest\n"
                "    steps:\n      - run: gh api --method POST foo "
                "'inputs[mode]=initialize'\n")
        def read(path):
            if path == ".github/workflows/release-build.yml":
                return code
            return None
        with patch.object(audit, "read", side_effect=read):
            problems = audit.findings()
        self.assertTrue(any(item.startswith("BUILD:") for item in problems), problems)

    def test_build_only_rejects_direct_publisher(self):
        code = ("on:\n  workflow_dispatch:\njobs:\n  build:\n"
                "    runs-on: ubuntu-latest\n    steps:\n"
                "      - run: python3 scripts/release/publisher.py deploy --bundle app.aab\n")
        with patch.object(audit, "read", side_effect=lambda path: code if path.endswith("release-build.yml") else None):
            problems = audit.findings()
        self.assertTrue(any("direct Play mutation" in item for item in problems), problems)

    def test_disabled_store_approval_step_is_rejected(self):
        code = ("on:\n  workflow_dispatch:\njobs:\n  upload:\n"
                "    if: github.event_name == 'workflow_dispatch'\n"
                "    runs-on: ubuntu-latest\n    steps:\n"
                "      - name: approval\n"
                "        if: false\n"
                "        run: python3 scripts/ops06/store_gate.py apply\n"
                "      - uses: google-github-actions/auth@v3\n"
                "      - run: python3 scripts/play/listing_images.py --mode upload\n")
        with patch.object(audit, "read", side_effect=lambda path: code if path.endswith("play-listing-images.yml") else None):
            problems = audit.store_guard_findings()
        self.assertTrue(any("STORE_OPTIONAL" in item for item in problems), problems)


if __name__ == "__main__":
    unittest.main()
