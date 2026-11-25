#!/usr/bin/env python3
"""Additional final QA on the isolated CI Android emulator; never contacts Play or paid APIs."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import time

APP = "com.haebi.subtitle"
RUNNER = APP + ".test/androidx.test.runner.AndroidJUnitRunner"
MARKER = "uncommitted-transaction-ready"
SUCCESS = re.compile(r"^OK \((\d+) tests?\)\s*$", re.MULTILINE)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def select_emulator(devices_output):
    lines = [line.split() for line in devices_output.splitlines()
             if line.strip() and not line.startswith("List of devices attached")
             and not line.startswith("*")]
    require(len(lines) == 1 and len(lines[0]) >= 2
            and re.fullmatch(r"emulator-\d+", lines[0][0])
            and lines[0][1] == "device",
            "Final QA requires exactly one connected CI emulator")
    return lines[0][0]


def check_success(log, count):
    matches = SUCCESS.findall(log)
    require(matches == [str(count)] and "FAILURES!!!" not in log
            and "INSTRUMENTATION_FAILED" not in log
            and "shortMsg=Process crashed" not in log,
            f"Expected {count} successful instrumentation tests")


def check_long_media(log):
    check_success(log, 1)
    chunks = re.findall(r"^INSTRUMENTATION_STATUS: longMediaChunk=(\d+)/26\s*$",
                        log, re.MULTILINE)
    require(chunks == [str(i) for i in range(1, 27)],
            "The 180-minute fixture did not verify all 26 audio chunks")


class DeviceQA:
    def __init__(self, serial, output):
        self.adb = ["adb", "-s", serial]
        self.output = Path(output)
        self.output.mkdir(parents=True, exist_ok=True)

    def command(self, test_class, phase=None):
        args = self.adb + ["shell", "am", "instrument", "-w", "-r",
                           "-e", "class", APP + "." + test_class]
        if phase is not None:
            args += ["-e", "phase", phase]
        return args + [RUNNER]

    def force_stop(self):
        subprocess.run(self.adb + ["shell", "am", "force-stop", APP],
                       check=True, timeout=20)

    def test(self, test_class, count, *, phase=None, timeout=180, label=None):
        name = test_class + ("-" + phase if phase else "") + ("-" + label if label else "")
        path = self.output / (name + ".log")
        with path.open("wb") as stream:
            subprocess.run(self.command(test_class, phase), stdout=stream,
                           stderr=subprocess.STDOUT, timeout=timeout, check=True)
        log = path.read_text(encoding="utf-8", errors="replace")
        if test_class == "LongMediaDeviceTest":
            check_long_media(log)
        else:
            check_success(log, count)
        print(f"{name}: passed {count} test(s)", flush=True)

    def interrupt_transaction(self):
        path = self.output / "ProcessRecoveryDeviceTest-interrupt-write.log"
        with path.open("wb") as stream:
            child = subprocess.Popen(self.command("ProcessRecoveryDeviceTest", "interrupt-write"),
                                     stdout=stream, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 25
                observed = False
                while time.monotonic() < deadline:
                    if child.poll() is not None:
                        break
                    if MARKER in path.read_text(encoding="utf-8", errors="replace"):
                        observed = True
                        break
                    time.sleep(0.2)
                require(observed, "Missing live uncommitted SQLite transaction marker")
                self.force_stop()
                child.wait(timeout=15)
                # Expected crash/termination, not a passing test. A separate verify
                # invocation must prove the transaction was rolled back.
                require(not SUCCESS.search(path.read_text(encoding="utf-8", errors="replace")),
                        "Interrupt-write unexpectedly completed instead of being stopped")
            finally:
                if child.poll() is None:
                    try:
                        self.force_stop()
                    finally:
                        child.kill()
                        child.wait(timeout=10)
        print("SQLite interrupt marker observed; isolated test app stopped", flush=True)

    def run(self):
        self.force_stop()
        self.test("JobStoreTest", 12)
        self.test("MediaChunksDeviceTest", 6)
        self.test("ProcessRecoveryDeviceTest", 1, phase="seed")
        self.force_stop()
        self.test("ProcessRecoveryDeviceTest", 1, phase="verify")
        self.test("ProcessRecoveryDeviceTest", 1, phase="seed-paid")
        self.force_stop()
        self.test("ProcessRecoveryDeviceTest", 1, phase="verify-paid")
        self.interrupt_transaction()
        self.test("ProcessRecoveryDeviceTest", 1, phase="verify", label="after-interrupt")
        # Keep the first committed recovery proof and post-interruption proof separate.
        self.test("LongMediaDeviceTest", 1, timeout=1860)
        self.force_stop()
        print("Final device QA: database, recovery, codecs and all 26 chunks verified", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    require(os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("GITHUB_REPOSITORY") == "hebi10/subtitle-workbench",
            "This process-stop test is restricted to the repository CI runner")
    require(os.environ.get("GITHUB_REF") == "refs/heads/main"
            and os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch",
            "Final device QA is main-only and explicitly dispatched")
    devices = subprocess.check_output(["adb", "devices"], text=True, timeout=20)
    DeviceQA(select_emulator(devices), args.output).run()


if __name__ == "__main__":
    main()
