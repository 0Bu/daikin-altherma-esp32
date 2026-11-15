#!/usr/bin/env python3
"""Verify the local pre-push phase ordering and propagation of failures."""

import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import push_checks


class PushChecksTests(unittest.TestCase):
    def run_candidate(self, fail_phase=None):
        build_started = threading.Event()
        host_started = threading.Event()
        runtime_started = threading.Event()
        host_failed = threading.Event()
        build_finished = threading.Event()
        host_finished = threading.Event()
        phases = []
        with tempfile.TemporaryDirectory(prefix="daikin-push-check-fixture-") as scratch:
            host = Path(scratch) / "host"
            firmware = Path(scratch) / "firmware"
            runtime = Path(scratch) / "runtime"
            host.mkdir()
            firmware.mkdir()
            runtime.mkdir()

            def run(command, *, cwd, env, check, **kwargs):
                if command[0] == "scripts/idf-docker.sh":
                    self.assertEqual(cwd, firmware)
                    build_started.set()
                    if fail_phase != "receipt":
                        self.assertTrue(host_started.wait(5), "host must run while the compiler is active")
                    self.assertTrue(runtime_started.wait(5), "runtime must overlap compilation")
                    if fail_phase in ("receipt", "audits", "runtime"):
                        self.assertTrue(host_failed.wait(5), "failure must precede completion of compilation")
                    build_finished.set()
                    phase = "firmware"
                elif command[0] == "scripts/check-nonflashable-artifacts.sh":
                    self.assertEqual(cwd, firmware)
                    self.assertTrue(build_finished.is_set())
                    phase = "artifacts"
                else:
                    phase = command[2]
                    self.assertEqual(cwd, {"runtime": runtime, "docker": firmware}.get(phase, host))
                    if phase == "audits":
                        self.assertTrue(build_started.wait(5), "compile must overlap host checks")
                        host_started.set()
                        host_finished.set()
                    elif phase == "runtime":
                        self.assertTrue(build_started.wait(5), "runtime must overlap compilation")
                        runtime_started.set()
                    elif phase == "docker":
                        self.assertIn("artifacts", phases)
                    elif phase == "browser":
                        self.assertTrue(build_finished.is_set() and host_finished.is_set())
                        self.assertCountEqual(phases, ["firmware", "artifacts", "runtime", "docker", "audits"])
                phases.append(phase)
                if phase == fail_phase:
                    raise subprocess.CalledProcessError(1, command)

            def verify_receipt(*args, **kwargs):
                if fail_phase == "receipt":
                    self.assertTrue(build_started.wait(5), "receipt checks must overlap compilation")
                    raise push_checks.local.CheckError("receipt checks failed")

            with patch.object(push_checks.subprocess, "run", side_effect=run), \
                    patch.object(push_checks, "run_phase",
                                 side_effect=lambda _, command, cwd, env, **kwargs: run(
                                     command, cwd=cwd, env=env, check=True, **kwargs)), \
                    patch.object(push_checks, "Event", return_value=host_failed), \
                    patch.object(push_checks.local, "verify", side_effect=verify_receipt) as verify:
                args = (host, {}, firmware, {}, runtime, {}, "a" * 40, "b" * 40, "c" * 40)
                if fail_phase:
                    error = push_checks.local.CheckError if fail_phase == "receipt" else subprocess.CalledProcessError
                    with self.assertRaises(error):
                        push_checks.check_candidate(*args)
                else:
                    push_checks.check_candidate(*args)
                verify.assert_called_once_with(host, expected_head=args[6], require_receipt=True, fresh=True)
        self.assertTrue(build_finished.is_set())
        self.assertEqual(host_finished.is_set(), fail_phase != "receipt")
        return phases

    def test_host_and_firmware_overlap_and_browser_runs_last(self):
        self.assertEqual(self.run_candidate()[-1], "browser")

    def test_failure_in_either_worker_prevents_browser(self):
        for phase in ("firmware", "receipt", "audits", "runtime", "docker", "artifacts"):
            with self.subTest(phase=phase):
                phases = self.run_candidate(phase)
                self.assertNotIn("browser", phases)
                if phase != "docker":
                    self.assertNotIn("docker", phases)

    def test_phase_deadline_terminates_subprocess_group(self):
        with patch.object(push_checks.subprocess, "Popen") as popen, \
                patch.object(push_checks.os, "killpg") as kill:
            process = popen.return_value.__enter__.return_value
            process.wait.side_effect = [subprocess.TimeoutExpired("worker", 1), 0]
            with self.assertRaises(subprocess.TimeoutExpired):
                push_checks.run_phase("test", ["worker"], Path("."), {}, timeout=1)
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        self.assertEqual([call.args for call in kill.call_args_list],
                         [(process.pid, push_checks.signal.SIGTERM),
                          (process.pid, push_checks.signal.SIGKILL)])


if __name__ == "__main__":
    unittest.main()
