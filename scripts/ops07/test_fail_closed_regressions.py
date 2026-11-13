"""Regression fixtures for fail-closed release-authorization parsing."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("ops07_regression_audit", Path(__file__).with_name("audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def publish_on(event, command, job="sync", quoted=False):
    header = '"jobs":' if quoted else "jobs:"
    return (event + "\n" + header + "\n  " + job + ":\n"
            "    runs-on: ubuntu-latest\n    steps:\n      - run: " + command + "\n")


def store_workflow(guard=True, guard_run=None, pre_auth="", before_guard="", failure="", guard_if=""):
    approval = ("      - name: Verify immutable approved batch\n"
                + ("        if: " + guard_if + "\n" if guard_if else "")
                + ("        continue-on-error: " + failure + "\n" if failure else "")
                + "        run: " + (guard_run or "python3 scripts/ops06/store_gate.py apply") + "\n") if guard else ""
    return ("on:\n  workflow_dispatch:\njobs:\n  upload:\n"
            "    if: github.event_name == 'workflow_dispatch'\n"
            "    runs-on: ubuntu-latest\n    steps:\n"
            + before_guard + approval + pre_auth
            + "      - uses: google-github-actions/auth@v3\n"
            + "      - run: python3 scripts/play/listing_images.py --mode upload\n")


class FailClosedRegressionTests(unittest.TestCase):
    def test_inline_comment_and_quoted_jobs_cannot_hide_push(self):
        text = publish_on('on: [push, workflow_dispatch] # release', 
                          "python3 scripts/release/publisher.py deploy", quoted=True)
        self.assertTrue(audit.automatic_mutations("play.yml", text))
        self.assertEqual(audit.triggers(text), {"push", "workflow_dispatch"})
        self.assertIn("sync", audit.jobs(text))

    def test_flow_job_mapping_fails_closed(self):
        text = ('on: push\njobs: {upload: {runs-on: ubuntu-latest,'
                ' steps: [{run: "python3 scripts/release/publisher.py deploy"}]}}\n')
        self.assertTrue(audit.automatic_mutations("play.yml", text))
        self.assertIn("__unparsed_jobs__", audit.jobs(text))

    def test_actual_mobile_and_icon_publishers_without_mode(self):
        for command in ("python3 scripts/publish-mobile-play.py --aab release.aab",
                        "python3 scripts/play/store_icon.py --file icon.png"):
            with self.subTest(command=command):
                self.assertTrue(audit.automatic_mutations("other.yml", publish_on(
                    "on:\n  push:", command)))

    def test_dynamic_store_filename_requires_approval(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / ".github/workflows"
            folder.mkdir(parents=True)
            (folder / "renamed-assets.yml").write_text(store_workflow(guard=False), encoding="utf-8")
            with patch.object(audit, "ROOT", root):
                self.assertTrue(any("STORE_GUARD" in issue for issue in audit.store_guard_findings()))

    def test_store_guard_must_execute_and_stop_on_failure(self):
        for kwargs in (
            {"guard_if": "false"},
            {"failure": "true"},
            {"failure": "$" + "{{ true }}"},
            {"guard_run": 'echo "python3 scripts/ops06/store_gate.py apply"'},
            {"guard_run": "python3 scripts/ops06/store_gate.py apply || true"},
        ):
            with self.subTest(kwargs=kwargs), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                folder = root / ".github/workflows"
                folder.mkdir(parents=True)
                (folder / "play-listing-images.yml").write_text(
                    store_workflow(**kwargs), encoding="utf-8")
                with patch.object(audit, "ROOT", root):
                    issues = audit.store_guard_findings()
                self.assertTrue(any("STORE_OPTIONAL" in item for item in issues), issues)

    def test_direct_play_edit_before_store_guard_blocks(self):
        before = ("      - run: curl -X POST "
                  "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/example/edits\n")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / ".github/workflows"
            folder.mkdir(parents=True)
            (folder / "store.yml").write_text(store_workflow(before_guard=before),
                                               encoding="utf-8")
            with patch.object(audit, "ROOT", root):
                issues = audit.store_guard_findings()
        self.assertTrue(any("STORE_ORDER" in item for item in issues), issues)

    def test_release_approval_atom_must_be_unconditionally_required(self):
        safe = "github.event_name == 'workflow_dispatch' && inputs.ops01_release_approved == true"
        unsafe = "github.event_name == 'workflow_dispatch' && (inputs.ops01_release_approved == true || true)"
        predicate = "inputs.ops01_release_approved == true"
        self.assertIn(predicate, audit._guaranteed_atoms(safe))
        self.assertNotIn(predicate, audit._guaranteed_atoms(unsafe))

    def test_chained_publish_scripts_and_image_only_upload(self):
        for script in (
            "python3 scripts/play/preflight.py auth && python3 scripts/play/publisher.py deploy",
            "python3 scripts/play/preflight.py auth; python3 scripts/release/play_closed.py deploy",
            "python3 scripts/play/images_only.py --track internal",
        ):
            with self.subTest(script=script):
                self.assertTrue(audit.automatic_mutations(
                    "custom.yml", publish_on("on:\n  push:", script)))

    def test_id_first_upload_before_approval_is_blocked(self):
        before = ("      - id: early_upload\n"
                  "        run: python3 scripts/play/listing_images.py --mode upload\n")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / ".github/workflows"
            folder.mkdir(parents=True)
            (folder / "renamed-store.yml").write_text(
                store_workflow(before_guard=before), encoding="utf-8")
            with patch.object(audit, "ROOT", root):
                issues = audit.store_guard_findings()
        self.assertTrue(any("STORE_ORDER" in issue for issue in issues), issues)

    def test_downstream_always_cannot_bypass_approval_failure(self):
        source = store_workflow().replace(
            "      - run: python3 scripts/play/listing_images.py --mode upload",
            "      - name: publish regardless\n"
            "        if: always()\n"
            "        run: python3 scripts/play/listing_images.py --mode upload")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / ".github/workflows"
            folder.mkdir(parents=True)
            (folder / "renamed-assets.yml").write_text(source, encoding="utf-8")
            with patch.object(audit, "ROOT", root):
                issues = audit.store_guard_findings()
        self.assertTrue(any("STORE_BYPASS" in issue for issue in issues), issues)

    def test_approval_is_not_itself_a_play_mutation(self):
        source = ("on:\n  workflow_dispatch:\njobs:\n  upload:\n"
                  "    if: github.event_name == 'workflow_dispatch'\n"
                  "    runs-on: ubuntu-latest\n    steps:\n"
                  "      - name: authorize either approved listing mode\n"
                  "        if: needs.source.outputs.mode == 'listing' || needs.source.outputs.mode == 'reconcile'\n"
                  "        run: python3 scripts/ops06/store_gate.py apply\n"
                  "      - name: upload listing\n"
                  "        if: needs.source.outputs.mode == 'listing'\n"
                  "        run: python3 scripts/release/listing.py apply --phone-only\n"
                  "      - name: reconcile listing\n"
                  "        if: needs.source.outputs.mode == 'reconcile'\n"
                  "        run: python3 scripts/release/listing.py apply --reconcile-brand\n")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / ".github/workflows"
            folder.mkdir(parents=True)
            (folder / "play-listing.yml").write_text(source, encoding="utf-8")
            with patch.object(audit, "ROOT", root):
                issues = audit.store_guard_findings()
        self.assertEqual(issues, [])

    def test_removing_both_internal_provenance_guards_fails(self):
        workflow = ("on:\n  workflow_dispatch:\njobs:\n"
                    "  verify:\n    runs-on: ubuntu-latest\n    steps:\n"
                    "      - run: python3 scripts/ops04/internal.py verify\n"
                    "  publish:\n    runs-on: ubuntu-latest\n    steps:\n"
                    "      - run: python3 scripts/ops04/internal.py verify\n")
        with patch.object(audit, "read", side_effect=lambda path:
                          workflow if path == ".github/workflows/play-internal-release.yml" else None):
            findings = audit.findings()
        self.assertTrue(any("PROVENANCE" in item for item in findings), findings)




if __name__ == "__main__":
    unittest.main()
