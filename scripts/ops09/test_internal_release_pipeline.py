import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from internal_release_pipeline import CONFIG, MANUAL_NAME, Orchestrator, initial_settings


SHA = "a" * 40


def settings(repo="hebi10/quickcut", **overrides):
    values = {
        "GITHUB_REPOSITORY": repo,
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_SHA": SHA,
        "GITHUB_RUN_ID": "123456",
        "GITHUB_RUN_ATTEMPT": "1",
        "EXPECTED_MAIN_SHA": SHA,
        "INTERNAL_RELEASE_APPROVED": "true",
        "VERSION_CODE": "123",
        "RELEASE_TAG": "",
        "CLOUD_PILOT": "false",
        "CLOUD_PRODUCTION": "false",
        "GH_TOKEN": "placeholder-not-real-token",
    }
    values.update(overrides)
    return values


class InternalReleaseSafetyTests(unittest.TestCase):
    def test_all_supported_apps_have_exact_final_manual_qa(self):
        self.assertEqual(len(CONFIG), 12)
        self.assertEqual(set(CONFIG), set(MANUAL_NAME))
        for repo, (qa, quick, count, needs_code) in CONFIG.items():
            self.assertTrue(qa.endswith(".yml"))
            self.assertTrue(quick)
            self.assertGreaterEqual(count, 1)
            self.assertIn(repo, MANUAL_NAME)

    def test_explicit_approval_and_main_sha_are_mandatory(self):
        changes = (
            {"INTERNAL_RELEASE_APPROVED": "false"},
            {"GITHUB_EVENT_NAME": "push"},
            {"GITHUB_REF": "refs/heads/feature"},
            {"EXPECTED_MAIN_SHA": "b" * 40},
            {"EXPECTED_MAIN_SHA": "invalid"},
            {"VERSION_CODE": "0"},
            {"VERSION_CODE": "-1"},
        )
        for change in changes:
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                initial_settings(settings(**change))

    def test_gallipick_cloud_selection_and_source_tag_must_be_explicit(self):
        for change in (
            {"RELEASE_TAG": ""},
            {"RELEASE_TAG": "0.2.5"},
            {"RELEASE_TAG": "v0.2.5", "CLOUD_PILOT": "true", "CLOUD_PRODUCTION": "true"},
        ):
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                initial_settings(settings("hebi10/GalliPick", **change))
        self.assertEqual(initial_settings(settings("hebi10/GalliPick", RELEASE_TAG="v0.2.5"))[1],
                         "gallipick")

    def test_missing_required_build_version_is_blocked(self):
        for name in ("quickcut", "focuslock", "homecrew", "tripcanvas",
                     "petworld", "subtitle-workbench"):
            with self.subTest(app=name), self.assertRaises(RuntimeError):
                initial_settings(settings("hebi10/" + name, VERSION_CODE=""))

    def test_dispatch_requires_an_exact_run_id_without_fallback_guessing(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = settings(GITHUB_STEP_SUMMARY=str(Path(tmp) / "summary"))
            with patch.dict(os.environ, env):
                pipe = Orchestrator(env)
                pipe.current_main = lambda: None
                pipe.api = lambda path, payload=None: {}
                with self.assertRaisesRegex(RuntimeError, "no exact run ID"):
                    pipe.dispatch("emulator-smoke.yml", {"expected_main_sha": SHA})

    def test_only_successful_qa_and_signed_aab_allow_publisher_dispatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = settings(GITHUB_STEP_SUMMARY=str(Path(tmp) / "summary"))
            with patch.dict(os.environ, env):
                pipe = Orchestrator(env)
                called = []
                pipe.current_main = lambda: None
                pipe.existing_basic_ci = lambda: called.append("basic_ci")
                pipe.dispatch = lambda file, inputs: (called.append((file, dict(inputs)))
                                                       or {"emulator-smoke.yml": 10,
                                                           "release-build.yml": 20,
                                                           "play-internal-release.yml": 30}[file])
                pipe.wait = lambda file, run_id: called.append(("wait", file, run_id))
                pipe.checked_device_qa = lambda run_id: called.append(("qa_checked", run_id))
                pipe.signed_artifact = lambda run_id: ("aab-signed", Path("fake.aab"))
                pipe.read_bundle_identity = lambda path: ("123", "1.0.0", "b" * 64)
                pipe.jobs = lambda run_id: [{"name": n, "status": "completed", "conclusion": "success"}
                                            for n in ("verify", "publish")]
                pipe.run()
                sequence = [x[0] for x in called if isinstance(x, tuple) and x[0].endswith(".yml")]
                self.assertEqual(sequence,
                                 ["emulator-smoke.yml", "release-build.yml",
                                  "play-internal-release.yml"])
                publish = [x[1] for x in called if isinstance(x, tuple) and x[0] ==
                           "play-internal-release.yml"][0]
                self.assertEqual(publish["mode"], "publish")
                self.assertTrue(publish["final_release_approved"])
                self.assertEqual(publish["expected_main_sha"], SHA)
                self.assertEqual(publish["aab_sha256"], "b" * 64)
                self.assertEqual(pipe.receipt["stage"], "internal_publisher_success")

    def test_any_aab_mismatch_prevents_publisher_dispatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = settings(GITHUB_STEP_SUMMARY=str(Path(tmp) / "summary"))
            with patch.dict(os.environ, env):
                pipe = Orchestrator(env)
                called = []
                pipe.current_main = lambda: None
                pipe.existing_basic_ci = lambda: None
                pipe.dispatch = lambda file, inputs: (called.append(file) or 12)
                pipe.wait = lambda file, run_id: None
                pipe.checked_device_qa = lambda run_id: None
                pipe.signed_artifact = lambda run_id: ("some-signed-aab", Path("fake.aab"))
                pipe.read_bundle_identity = lambda path: (_ for _ in ()).throw(
                    RuntimeError("Signed AAB version mismatch"))
                with self.assertRaisesRegex(RuntimeError, "mismatch"):
                    pipe.run()
                self.assertEqual(called, ["emulator-smoke.yml", "release-build.yml"])


if __name__ == "__main__":
    unittest.main()
