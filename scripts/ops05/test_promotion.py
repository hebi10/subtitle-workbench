"""OPS-05 offline regression tests — never contact Google Play."""
import importlib.util
import os
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "ops05" / "promotion.py"
spec = importlib.util.spec_from_file_location("ops05", SCRIPT)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class PromotionTests(unittest.TestCase):
    def env(self, mode="promote"):
        return {"GITHUB_EVENT_NAME":"workflow_dispatch","GITHUB_REF":"refs/heads/main",
                "GITHUB_REPOSITORY":"hebi10/fixture","EXPECTED_REPO":"hebi10/fixture",
                "GITHUB_SHA":"a"*40,"EXPECTED_MAIN_SHA":"a"*40,
                "BATCH_ID":"2026-11-13-fixture","APP_PACKAGE":"com.example.fixture",
                "INTERNAL_TRACK":"internal","CLOSED_TRACK":"alpha",
                "VERSION_CODE":"19","AAB_SHA256":"b"*64,"MODE":mode,
                "FINAL_BATCH_APPROVED":"true","APPROVAL_PHRASE":p.APPROVAL}

    def snapshot(self, source_status="completed", closed=None, bundle_hash=None):
        return ([{"track":"internal","releases":[{"status":source_status,"versionCodes":["19"],"name":"1.0 (19)"}]},
                 {"track":"alpha","releases":closed if closed is not None else []}],
                [{"versionCode":19,"sha256":bundle_hash or "b"*64}])

    def test_unapproved_mutation_rejected(self):
        env = self.env()
        env["FINAL_BATCH_APPROVED"] = "false"
        with self.assertRaises(p.Stop):
            p.parse_request(env)

    def test_wrong_source_sha_rejected(self):
        env = self.env()
        env["EXPECTED_MAIN_SHA"] = "c"*40
        with self.assertRaises(p.Stop):
            p.parse_request(env)

    def test_check_is_allowed_without_promotion_approval(self):
        env = self.env("check")
        env["FINAL_BATCH_APPROVED"] = "false"
        env["APPROVAL_PHRASE"] = ""
        self.assertEqual(p.parse_request(env)["mode"], "check")

    def test_promote_request_can_run_readonly_check_first(self):
        source = Path(SCRIPT).read_text(encoding="utf-8")
        self.assertIn('sys.argv[1] == "check" or sys.argv[1] == req["mode"]', source)

    def test_forbidden_destination_rejected(self):
        for track in ("production","beta","internal","qa","open","internalsharing"):
            with self.subTest(track=track):
                env = self.env()
                env["CLOSED_TRACK"] = track
                with self.assertRaises(p.Stop):
                    p.parse_request(env)

    def test_valid_exact_bundle_and_completed_internal(self):
        req = p.parse_request(self.env())
        tracks, bundles = self.snapshot()
        self.assertEqual(p.make_plan(tracks,bundles,req)["state"],"ready")

    def test_internal_draft_rejected(self):
        req = p.parse_request(self.env())
        tracks,bundles=self.snapshot(source_status="draft")
        with self.assertRaises(p.Stop):
            p.make_plan(tracks,bundles,req)

    def test_wrong_aab_sha256_rejected(self):
        req=p.parse_request(self.env())
        tracks,bundles=self.snapshot(bundle_hash="f"*64)
        with self.assertRaises(p.Stop):
            p.make_plan(tracks,bundles,req)

    def test_missing_existing_closed_track_rejected(self):
        req=p.parse_request(self.env())
        tracks,bundles=self.snapshot()
        with self.assertRaises(p.Stop):
            p.make_plan(tracks[:1],bundles,req)

    def test_closed_pending_review_rejected(self):
        req=p.parse_request(self.env())
        tracks,bundles=self.snapshot(closed=[{"status":"draft","versionCodes":[]}])
        with self.assertRaises(p.Stop):
            p.make_plan(tracks,bundles,req)

    def test_closed_downgrade_rejected(self):
        req=p.parse_request(self.env())
        tracks,bundles=self.snapshot(closed=[{"status":"completed","versionCodes":["20"]}])
        with self.assertRaises(p.Stop):
            p.make_plan(tracks,bundles,req)

    def test_existing_identical_closed_version_no_change(self):
        req=p.parse_request(self.env())
        tracks,bundles=self.snapshot(closed=[{"status":"completed","versionCodes":["19"]}])
        self.assertEqual(p.make_plan(tracks,bundles,req)["state"],"already_completed")

    def test_duplicate_bundle_rejected(self):
        req=p.parse_request(self.env())
        tracks,bundles=self.snapshot()
        with self.assertRaises(p.Stop):
            p.make_plan(tracks,bundles+bundles,req)

    def test_check_mode_never_writes_or_commits_a_play_track(self):
        from unittest.mock import patch
        env = self.env("check")
        req = p.parse_request(env)
        tracks, bundles = self.snapshot()
        calls = []
        class FakePlay:
            def __init__(self, token, package):
                self.package = package
            def start(self):
                calls.append("start")
                return "/temporary"
            def inventory(self, edit):
                calls.append("inventory")
                return tracks, bundles
            def discard(self, edit):
                calls.append("discard")
            def request(self, method, suffix, data=None):
                raise AssertionError("check must not PUT or commit")
        with patch.object(p, "Play", FakePlay):
            receipt = p.execute("check", req, "redacted-fixture", env)
        self.assertEqual(receipt["status"], "verified_ready_for_manual_promotion")
        self.assertEqual(calls, ["start", "inventory", "discard"])

    def test_promote_updates_only_closed_track_with_same_code_and_review_protection(self):
        from unittest.mock import patch
        env = self.env("promote")
        req = p.parse_request(env)
        before_tracks, bundles = self.snapshot()
        after_tracks, _ = self.snapshot(closed=[{"status":"completed","versionCodes":["19"]}])
        calls = []
        class FakePlay:
            def __init__(self, token, package):
                self.starts = 0
            def start(self):
                self.starts += 1
                return "/temporary" + str(self.starts)
            def inventory(self, edit):
                return (before_tracks, bundles) if self.starts == 1 else (after_tracks, bundles)
            def discard(self, edit):
                calls.append(("DELETE",edit))
            def request(self, method, suffix, data=None):
                calls.append((method,suffix))
                if method == "PUT":
                    self.assert_only_closed = suffix.endswith("/tracks/alpha")
                    if not self.assert_only_closed:
                        raise AssertionError("attempt to write non-closed track")
                    if data["releases"][0]["versionCodes"] != ["19"]:
                        raise AssertionError("different AAB version")
                return {}
        with patch.object(p, "Play", FakePlay), patch.object(p,"verify_main"), patch.object(p,"persist"):
            result=p.execute("promote",req,"redacted-fixture",env)
        self.assertEqual(result["status"],"committed_and_read_back")
        self.assertEqual([v[0] for v in calls].count("PUT"),1)
        self.assertIn(("POST","/temporary1:commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW"),calls)
        self.assertNotIn(("POST","/temporary1/bundles"),calls)

    def test_homecrew_requires_existing_special_final_approval(self):
        env=self.env()
        env["APP_PACKAGE"]="com.hebi.homecrew"
        with self.assertRaises(p.Stop):
            p.parse_request(env)
        env["HOMECREW_FINAL_APPROVAL"]="HOMECREW_FINAL_RELEASE_APPROVED"
        self.assertEqual(p.parse_request(env)["package"],"com.hebi.homecrew")

    def test_workflow_is_manual_only_and_never_uploads_aab(self):
        workflow=(ROOT/".github/workflows/play-closed-release.yml").read_text(encoding="utf-8")
        self.assertIn("  workflow_dispatch:",workflow)
        self.assertNotRegex(workflow,r"(?m)^  (push|workflow_run|issue_comment|schedule|pull_request):")
        self.assertIn("inputs.mode == 'promote'",workflow)
        self.assertIn(p.APPROVAL,workflow)
        self.assertNotIn("bundleRelease",workflow)
        self.assertNotIn("bundletool",workflow)
        self.assertNotIn("uploadType",workflow)
        self.assertNotIn("gh release create",workflow)
        self.assertNotIn("actions/download-artifact",workflow)


if __name__ == "__main__":
    unittest.main()
