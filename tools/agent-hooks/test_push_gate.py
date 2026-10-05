#!/usr/bin/env python3
"""Offline mutation canaries for the native Git update gate; never push or contact GitHub."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
ORIGIN = "https://github.com/example/fixture.git"
ZERO = "0" * 40


class PushGateTests(unittest.TestCase):
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(prefix="push-gate-")
        self.control = tempfile.TemporaryDirectory(prefix="push-gate-control-")
        self.addCleanup(self.fixture.cleanup)
        self.addCleanup(self.control.cleanup)
        self.root = Path(self.fixture.name).resolve()
        self.response = Path(self.control.name) / "response.json"
        self.query_log = Path(self.control.name) / "query.json"
        for relative in (
            ".githooks/pre-push",
            "tools/agent-hooks/require-pr-gates.sh",
            "tools/agent-hooks/pr-gate-lib.sh",
            "tools/agent-hooks/merge_payload.py",
            "tools/agent-hooks/run_with_timeout.py",
        ):
            destination = self.root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, destination)
        scripts = self.root / "scripts"
        scripts.mkdir()
        audit = scripts / "run-skill-audit.sh"
        audit.write_text('#!/usr/bin/env bash\nexit "${FIXTURE_AUDIT_RC:-0}"\n')
        audit.chmod(0o755)
        runner = scripts / "gh-with-git-credentials.sh"
        runner.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
pathlib.Path(os.environ["FIXTURE_QUERY_LOG"]).write_text(json.dumps(sys.argv[1:]))
if os.environ.get("FIXTURE_DISCOVERY_RC"):
    sys.exit(int(os.environ["FIXTURE_DISCOVERY_RC"]))
if sys.argv[1:6] != ["api", "--hostname", "github.com", "--method", "GET"]:
    sys.exit(2)
print(pathlib.Path(os.environ["FIXTURE_RESPONSE_FILE"]).read_text())
''')
        runner.chmod(0o755)
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "core.hooksPath", "")
        self.git("checkout", "-qb", "source")
        self.git("add", ".")
        self.git("commit", "-qm", "Fixture")
        self.git("remote", "add", "origin", ORIGIN)
        self.sha = self.git("rev-parse", "HEAD")
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith(("AGENT_", "PROJECT_DIR", "FIXTURE_"))}
        self.env.update(FIXTURE_QUERY_LOG=str(self.query_log),
                        FIXTURE_RESPONSE_FILE=str(self.response),
                        PYTHONDONTWRITEBYTECODE="1")
        self.set_pr("source")

    def git(self, *args):
        return subprocess.run(["git", "-c", "core.fsmonitor=false", "-C", str(self.root), *args],
                              check=True, capture_output=True, text=True).stdout.strip()

    def record(self, branch, body=None):
        if body is None:
            body = (f'- [x] `$skill-audit` clean — PR create/push gate @ {self.sha}\n'
                    f'- [x] `$pr-hygiene-review` clean — merge gate @ {self.sha}\n')
        return {"number": 42, "state": "open", "body": body,
                "head": {"sha": "a" * 40, "ref": branch,
                         "repo": {"full_name": "example/fixture"}}}

    def set_pr(self, branch, body=None):
        self.response.write_text(json.dumps([self.record(branch, body)]))

    def gate(self, branch="source", sha=None, url=ORIGIN, extra=None):
        env = dict(self.env, **(extra or {}))
        return subprocess.run(["bash", str(self.root / "tools/agent-hooks/require-pr-gates.sh"),
                               "--push-update", sha or self.sha, f"refs/heads/{branch}", url],
                              cwd=self.root, env=env, input="", capture_output=True,
                              text=True, timeout=15)

    def native(self, update, url=ORIGIN, extra=None):
        return subprocess.run(["bash", str(self.root / ".githooks/pre-push"), "origin", url],
                              cwd=self.root, env=dict(self.env, **(extra or {})), input=update,
                              capture_output=True, text=True, timeout=15)

    def update(self, branch="source", sha=None):
        return f"refs/heads/source {sha or self.sha} refs/heads/{branch} {ZERO}\n"

    def test_current_records_allow_the_actual_update(self):
        self.assertEqual(self.native(self.update()).returncode, 0)

    def test_destination_branch_does_not_inherit_checkout_records(self):
        self.set_pr("target", "")
        result = self.native(self.update("target"))
        self.assertEqual(result.returncode, 1)
        self.assertIn("skill-audit", result.stderr)
        self.assertIn("head=example%3Atarget", self.query_log.read_text())

    def test_distinct_destination_with_its_own_records_is_allowed(self):
        self.set_pr("target")
        self.assertEqual(self.native(self.update("target")).returncode, 0)

    def test_discovery_error_fails_closed(self):
        result = self.gate(extra={"FIXTURE_DISCOVERY_RC": "2"})
        self.assertEqual(result.returncode, 2)
        self.assertIn("cannot read", result.stderr)

    def test_successful_empty_query_allows_initial_push(self):
        self.response.write_text("[]")
        self.assertEqual(self.gate().returncode, 0)

    def test_foreign_remote_is_rejected_before_query(self):
        self.assertEqual(self.gate(url="https://github.com/example/other.git").returncode, 2)
        self.assertFalse(self.query_log.exists())

    def test_equivalent_ssh_remote_identity_is_allowed(self):
        self.assertEqual(self.gate(url="git@github.com:example/fixture.git").returncode, 0)

    def test_transferred_commit_must_be_the_audited_head(self):
        self.assertEqual(self.gate(sha="b" * 40).returncode, 2)
        self.assertFalse(self.query_log.exists())

    def test_dirty_audit_inputs_are_rejected(self):
        with (self.root / "scripts/run-skill-audit.sh").open("a") as stream:
            stream.write("# dirty\n")
        self.assertEqual(self.gate().returncode, 2)
        self.assertFalse(self.query_log.exists())

    def test_failed_audit_blocks_even_without_a_pr(self):
        self.response.write_text("[]")
        self.assertEqual(self.gate(extra={"FIXTURE_AUDIT_RC": "1"}).returncode, 2)

    def test_stale_records_cannot_clear_an_update(self):
        self.set_pr("source", self.record("source")["body"].replace(self.sha, "b" * 40))
        self.assertEqual(self.gate().returncode, 2)

    def test_ambiguous_and_malformed_queries_are_errors(self):
        for response in ({"message": "failure"}, [self.record("source"), self.record("source")],
                         [{}], [self.record("other")]):
            with self.subTest(response=response):
                self.response.write_text(json.dumps(response))
                self.assertEqual(self.gate().returncode, 2)

    def test_foreign_pr_provenance_is_rejected(self):
        record = self.record("source")
        record["head"]["repo"]["full_name"] = "fork/fixture"
        self.response.write_text(json.dumps([record]))
        self.assertEqual(self.gate().returncode, 2)

    def test_native_hook_rejects_malformed_update_records(self):
        for update in ("bad\n", self.update().rstrip() + " extra\n",
                       self.update(sha="bad"), "\n"):
            with self.subTest(update=update):
                self.assertEqual(self.native(update).returncode, 1)
        self.assertFalse(self.query_log.exists())

    def test_protected_destinations_and_deletions_remain_blocked(self):
        self.assertEqual(self.native(self.update("main")).returncode, 1)
        self.assertEqual(self.native(f"(delete) {ZERO} refs/heads/main {self.sha}\n").returncode, 1)
        self.assertEqual(self.native(f"(delete) {ZERO} refs/heads/source {self.sha}\n").returncode, 0)

    def test_all_updates_are_checked(self):
        self.assertEqual(self.native(self.update() + self.update("main")).returncode, 1)

    def test_emergency_environment_does_not_skip_a_failed_audit(self):
        self.assertEqual(self.native(self.update(), extra={"AGENT_PR_GATES_SKIP": "1",
                                                        "FIXTURE_AUDIT_RC": "1"}).returncode, 1)

    def test_shell_payload_does_not_guess_push_from_read_only_text(self):
        payload = json.dumps({"tool_name": "Bash", "cwd": str(self.root),
                              "tool_input": {"command": 'git log --grep="a git push"'}})
        result = subprocess.run(["bash", str(self.root / "tools/agent-hooks/require-pr-gates.sh")],
                                input=payload, cwd=self.root, env=dict(self.env, FIXTURE_AUDIT_RC="1"),
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0)
        self.assertFalse(self.query_log.exists())


if __name__ == "__main__":
    unittest.main()
