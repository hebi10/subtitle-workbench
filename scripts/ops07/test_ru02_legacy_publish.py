"""RU-02: run the deprecated-release guard as a real Bash subprocess."""
import os
from pathlib import Path
import subprocess
import unittest

WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/play-internal.yml"
MARKER = "      - name: RU-02 reject legacy Play publishing"


def script():
    lines = WORKFLOW.read_text(encoding="utf-8").splitlines()
    index = next(i for i, line in enumerate(lines) if line.startswith(MARKER))
    start = next(i + 1 for i in range(index, len(lines)) if lines[i] == "        run: |")
    body = []
    for line in lines[start:]:
        if line and not line.startswith("          "):
            break
        body.append(line[10:] if line else "")
    return "\n".join(body)


class LegacyPublishGuardTests(unittest.TestCase):
    def test_guard_exists_early(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(MARKER, text)
        self.assertIn("exit 1", script())
        self.assertLess(text.index(MARKER), text.index("google-github-actions/auth") if "google-github-actions/auth" in text else len(text))

    def test_allowed_modes(self):
        for value in ["check","build","audit"]:
            with self.subTest(mode=value):
                result = subprocess.run(["bash", "-c", script()], text=True,
                    env={**os.environ, "LEGACY_MODE": value}, capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_legacy_publish_is_rejected(self):
        for value in ["deploy","promote"]:
            with self.subTest(mode=value):
                result = subprocess.run(["bash", "-c", script()], text=True,
                    env={**os.environ, "LEGACY_MODE": value}, capture_output=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
