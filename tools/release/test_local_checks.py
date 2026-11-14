#!/usr/bin/env python3
"""Exercise release check reuse against real Git trees and private files, without devices."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

import local_checks


class LocalReleaseChecksTests(unittest.TestCase):
    def setUp(self):
        fixture = tempfile.TemporaryDirectory(prefix="daikin-release-checks-")
        self.addCleanup(fixture.cleanup)
        self.home = Path(fixture.name).resolve()
        self.root = self.home / "repository"
        self.root.mkdir()
        self.cache = self.home / ".cache" / "daikin-altherma-esp32" / "release-checks"
        for override in (patch.object(local_checks, "account_home", return_value=self.home),
                         patch.dict(os.environ, {"FIXTURE_STATE": str(self.home)}, clear=False)):
            override.start()
            self.addCleanup(override.stop)
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "user.name", "Fixture")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "core.hooksPath", str(self.home / "empty-hooks"))
        self.git("branch", "-M", "main")
        (self.root / "scripts").mkdir()
        for command in local_checks.COMMANDS:
            script = self.root / command[0]
            verification = '\n[ "$1" = "--coverage" ] || exit 8' if len(command) == 2 else ""
            script.write_text(f"""#!/bin/sh
set -eu{verification}
echo "{script.name}" >> "$FIXTURE_STATE/runs"
if [ -f ignored-input ]; then
    echo "an ignored input leaked into the check checkout"
    exit 9
fi
git cat-file -e HEAD^1:tools/coverage/branch_baseline.json
if [ -f "$FIXTURE_STATE/race-checkout" ]; then
    echo other-checkout-contents > "$FIXTURE_STATE/repository/source.txt"
    [ "$(cat source.txt)" = candidate ] || exit 10
    echo candidate > "$FIXTURE_STATE/repository/source.txt"
fi
if [ -f "$FIXTURE_STATE/mutate-{script.name}" ]; then
    echo changed > source.txt
fi
if [ -f "$FIXTURE_STATE/fail-{script.name}" ]; then
    echo controlled failure
    exit 7
fi
echo controlled success
""")
            script.chmod(0o755)
        (self.root / ".gitignore").write_text("ignored-input\n")
        baseline = self.root / "tools" / "coverage" / "branch_baseline.json"
        baseline.parent.mkdir(parents=True)
        baseline.write_text('{"fixture": true}\n')
        self.content("base")
        self.commit("base")
        self.base = self.git("rev-parse", "HEAD")
        self.git("update-ref", "refs/remotes/origin/main", self.base)
        self.content("candidate")
        self.commit("review head")
        self.candidate = self.git("rev-parse", "HEAD")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, text=True,
                                       env=local_checks.check_environment()).strip()

    def content(self, value):
        (self.root / "source.txt").write_text(value + "\n")

    def commit(self, title):
        self.git("add", "-A")
        self.git("commit", "-qm", title)

    def receipt(self):
        return next(self.cache.glob("*.json"))

    def commands(self):
        return (self.home / "runs").read_text().splitlines()

    def test_promote_identical_tree_and_parent_without_running_again(self):
        self.assertFalse(local_checks.verify(self.root, premerge=True))
        original = json.loads(self.receipt().read_text())
        tree = self.git("rev-parse", "HEAD^{tree}")
        new_head = self.git("commit-tree", tree, "-p", self.base, "-m", "different squash commit")
        self.assertNotEqual(new_head, self.candidate)
        self.git("reset", "--hard", new_head)
        self.assertTrue(local_checks.verify(self.root))
        self.assertTrue(local_checks.verify(self.root))
        self.assertEqual(len(self.commands()), 2)
        self.assertEqual(original["head"], self.candidate)
        self.assertEqual(original["tree"], tree)

    def test_first_parent_is_part_of_the_identity_even_when_tree_matches(self):
        self.assertFalse(local_checks.verify(self.root, premerge=True))
        tree = self.git("rev-parse", "HEAD^{tree}")
        different_base = self.git("commit-tree", f"{self.base}^{{tree}}", "-m", "different base")
        new_head = self.git("commit-tree", tree, "-p", different_base, "-m", "different parent")
        self.git("reset", "--hard", new_head)
        with self.assertRaisesRegex(local_checks.CheckError, "first parent"):
            local_checks.verify(self.root, premerge=True)
        self.assertFalse(local_checks.verify(self.root))
        self.assertEqual(len(self.commands()), 4)

    def test_push_proof_refreshes_both_checks_before_issuing_a_new_receipt(self):
        self.assertFalse(local_checks.verify(self.root))
        self.assertTrue(local_checks.verify(self.root))
        self.assertFalse(local_checks.verify(self.root, fresh=True))
        self.assertEqual(len(self.commands()), 4)

    def test_host_gate_output_is_bounded_before_completion(self):
        command = ("scripts/overflow.sh",)
        path = self.root / command[0]
        path.write_text("#!/bin/sh\nwhile :; do printf '%s\\n' 'oversized log'; done\n")
        path.chmod(0o755)
        with patch.object(local_checks, "COMMANDS", (command,)), \
                patch.object(local_checks, "MAX_RECEIPT_BYTES", 1024):
            with self.assertRaisesRegex(local_checks.CheckError, "exceeded the check log limit"):
                local_checks.run_checks(self.root, local_checks.check_environment())

    def test_changed_tree_is_retested(self):
        self.assertFalse(local_checks.verify(self.root, premerge=True))
        self.content("different candidate")
        self.git("add", "source.txt")
        self.git("commit", "--amend", "--no-edit", "-q")
        self.assertFalse(local_checks.verify(self.root))
        self.assertEqual(len(self.commands()), 4)

    def test_bad_evidence_runs_both_checks_again(self):
        self.assertFalse(local_checks.verify(self.root, premerge=True))
        rec = self.receipt()
        trusted = json.loads(rec.read_text())
        invalid = [
            ("finished_at", int(time.time()) - local_checks.MAX_AGE_S - 1),
            ("finished_at", int(time.time()) + 30),
            ("machine", "different machine"),
            ("base", "0" * 40),
            ("tree", "1" * 40),
            ("checks", []),
            ("checks", [{**trusted["checks"][0], "exit_code": False}, trusted["checks"][1]]),
            ("checks", [{**trusted["checks"][0], "log": "modified log"}, trusted["checks"][1]]),
            ("checks", [{**trusted["checks"][0], "command": ["true"]}, trusted["checks"][1]]),
        ]
        for key, value in invalid:
            with self.subTest(key=key, value=value):
                rec.write_text(json.dumps({**trusted, key: value}))
                self.assertFalse(local_checks.verify(self.root))
        rec.write_text('{"schema_version": 2, ' + json.dumps(trusted)[1:])
        self.assertFalse(local_checks.verify(self.root))
        rec.chmod(0o644)
        self.assertFalse(local_checks.verify(self.root))
        target = self.home / "untrusted-symlink-target"
        target.write_text(json.dumps(trusted))
        target.chmod(0o600)
        rec.unlink()
        rec.symlink_to(target)
        self.assertFalse(local_checks.verify(self.root))
        self.assertEqual(json.loads(target.read_text()), trusted)
        self.assertFalse(rec.is_symlink())
        self.assertEqual(len(self.commands()), 2 * (len(invalid) + 4))

    def test_untrusted_cache_path_cannot_replace_checks(self):
        target = self.home / "untrusted-dir"
        target.mkdir(mode=0o700)
        self.cache.parent.mkdir(parents=True, mode=0o700)
        self.cache.symlink_to(target)
        with self.assertRaisesRegex(local_checks.CheckError, "could not be saved"):
            local_checks.verify(self.root, premerge=True)
        self.assertFalse(local_checks.verify(self.root))
        self.assertFalse(list(target.iterdir()))
        self.assertEqual(len(self.commands()), 4)

    def test_failed_or_mutating_run_does_not_record_success(self):
        fail = self.home / "fail-run-contract-tests.sh"
        fail.touch()
        with self.assertRaisesRegex(local_checks.CheckError, "exit code 7"):
            local_checks.verify(self.root, premerge=True)
        self.assertFalse(list(self.cache.glob("*.json")))
        fail.unlink()
        (self.home / "mutate-run-contract-tests.sh").touch()
        with self.assertRaisesRegex(local_checks.CheckError, "clean checkout"):
            local_checks.verify(self.root, premerge=True)
        self.assertFalse(list(self.cache.glob("*.json")))

    def test_dirty_checkout_and_hidden_index_paths_are_refused(self):
        self.content("dirty")
        with self.assertRaisesRegex(local_checks.CheckError, "clean checkout"):
            local_checks.verify(self.root, premerge=True)
        self.git("reset", "--hard", self.candidate)
        self.git("update-index", "--assume-unchanged", "source.txt")
        with self.assertRaisesRegex(local_checks.CheckError, "ordinary index"):
            local_checks.verify(self.root, premerge=True)
        self.assertFalse((self.home / "runs").exists())

    def test_artifact_head_mismatch_blocks_before_the_checks_start(self):
        with self.assertRaisesRegex(local_checks.CheckError, "expected source"):
            local_checks.verify(self.root, expected_head=self.base)
        self.assertFalse((self.home / "runs").exists())

    def test_isolated_checkout_ignores_caller_inputs_and_transient_edits(self):
        (self.root / "ignored-input").touch()
        (self.home / "race-checkout").touch()
        self.assertFalse(local_checks.verify(self.root, premerge=True))
        self.assertTrue(local_checks.verify(self.root))
        self.assertEqual(len(self.commands()), 2)


if __name__ == "__main__":
    unittest.main()
