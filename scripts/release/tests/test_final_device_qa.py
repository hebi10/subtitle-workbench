import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "scripts/release/final_device_qa.py"
SPEC = importlib.util.spec_from_file_location("final_device_qa", SOURCE)
QA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(QA)


class FinalDeviceQATests(unittest.TestCase):
    def test_only_single_online_emulator_is_accepted(self):
        self.assertEqual(QA.select_emulator("List of devices attached\nemulator-5554\tdevice\n"), "emulator-5554")
        for invalid in ["List of devices attached\n",
                        "serial-physical\tdevice\n",
                        "emulator-5554\toffline\n",
                        "emulator-5554\tdevice\nserial-physical\tdevice\n"]:
            with self.subTest(invalid=invalid), self.assertRaises(RuntimeError):
                QA.select_emulator(invalid)

    def test_no_success_for_crash_partial_or_wrong_count(self):
        QA.check_success("Time: 1.0\nOK (12 tests)\nINSTRUMENTATION_CODE: -1\n", 12)
        for log in ["OK (11 tests)", "FAILURES!!!", "OK (12 tests)\nshortMsg=Process crashed",
                    "OK (12 tests)\nINSTRUMENTATION_FAILED"]:
            with self.subTest(log=log), self.assertRaises(RuntimeError):
                QA.check_success(log, 12)

    def test_long_media_requires_all_twenty_six_chunks_in_order(self):
        lines = [f"INSTRUMENTATION_STATUS: longMediaChunk={i}/26" for i in range(1, 27)]
        QA.check_long_media("\n".join(lines + ["OK (1 test)"]))
        for partial in [lines[:-1], lines[::-1], lines + [lines[-1]]]:
            with self.assertRaises(RuntimeError):
                QA.check_long_media("\n".join(partial + ["OK (1 test)"]))

    def test_workflow_calls_device_qa_only_in_frozen_main_manual_run(self):
        workflow = (ROOT / ".github/workflows/android-emulator-smoke.yml").read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn('refs/heads/main', workflow)
        self.assertIn("python3 ../scripts/release/final_device_qa.py", workflow)
        self.assertIn("output/final-device-qa/", workflow)
        self.assertIn("Recheck frozen main after device QA", workflow)
        self.assertNotIn("pull_request:", workflow)
        self.assertNotIn("PLAY_SERVICE_ACCOUNT", workflow)

    def test_device_qa_declared_counts_match_fixture_classes(self):
        base = ROOT / "android/app/src/androidTest/java/com/haebi/subtitle"
        import re
        for filename, count in [("JobStoreTest.java", 12), ("MediaChunksDeviceTest.java", 6),
                                ("LongMediaDeviceTest.java", 1), ("ProcessRecoveryDeviceTest.java", 1)]:
            self.assertEqual(len(re.findall(r"@Test\b", (base / filename).read_text(encoding="utf-8"))), count)
        recovery = (base / "ProcessRecoveryDeviceTest.java").read_text(encoding="utf-8")
        self.assertIn('"seed-paid"', recovery)
        self.assertIn('"verify-paid"', recovery)
        self.assertIn('assertFalse(store.claim(id))', recovery)


if __name__ == "__main__":
    unittest.main()
