#!/usr/bin/env python3
"""Isolated launcher checks: no native model turn, persistent settings or repository writes."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tempfile
import tomllib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("codex_review", Path(__file__).with_name("review.py"))
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)

BASE = "1" * 40
HEAD = "2" * 40


class ReviewChecks(unittest.TestCase):
    def launch(self, *, agents_enabled=True, metadata_error=False, actual_head=HEAD,
               paths=None, servers=None, malformed_metadata=False, extra_files=(), intent="Review fixture documentation changes"):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            (root / "docs").mkdir()
            source = root / "docs/review.md"
            source.write_text("unchanged fixture\n")
            for value in extra_files:
                fixture = root / value
                fixture.parent.mkdir(parents=True, exist_ok=True)
                fixture.write_text("SYNTHETIC_SENSITIVE_FIXTURE")
            before = source.read_bytes()
            before_paths = sorted(path.relative_to(root).as_posix() for path in root.rglob("*"))
            calls, methods, notifications = [], [], []
            metadata = {"config": {"agents": {"enabled": agents_enabled}, "mcp_servers": servers if servers is not None else {
                "context7": {"command": "PRIVATE_CONFIGURATION_VALUE"},
                'private.server"name': {"env": {"TOKEN": "PRIVATE_ENVIRONMENT_VALUE"}},
            }}}

            class FixtureRpc:
                def __init__(self, executable):
                    self.executable = executable

                def request(self, method, params):
                    methods.append((method, params))
                    if method == "initialize":
                        return {}
                    if method == "config/read":
                        if metadata_error:
                            raise ValueError("PRIVATE_SERVER_ERROR_DATA")
                        return {} if malformed_metadata else metadata
                    raise AssertionError("non-metadata RPC attempted")

                def send(self, value):
                    notifications.append(value)

                def close(self):
                    notifications.append("closed")

            def command(arguments, **kwargs):
                calls.append((arguments, kwargs))
                if arguments[0] == "git":
                    self.assertEqual(arguments[5:7], ["rev-parse", "--verify"])
                    value = arguments[-1]
                    output = actual_head if value == "HEAD" else value.removesuffix("^{commit}")
                    return subprocess.CompletedProcess(arguments, 0, stdout=output + "\n")
                self.assertEqual(arguments[0], "fixture-codex")
                return subprocess.CompletedProcess(arguments, 0)

            output = io.StringIO()
            arguments = ["review.py", "doc_drift_checker", BASE, HEAD, *(paths or ["docs"]), "--intent", intent]
            with patch.object(review, "ROOT", root), patch.object(review, "ReadOnlyRpc", FixtureRpc), patch.object(review.shutil, "which", return_value="fixture-codex"), patch.object(review.subprocess, "run", side_effect=command), patch.object(review.sys, "argv", arguments), patch.object(review.Path, "open", side_effect=AssertionError("launcher must not read file contents")), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                result = review.main()
            self.assertEqual(source.read_bytes(), before)
            self.assertEqual(sorted(path.relative_to(root).as_posix() for path in root.rglob("*")), before_paths)
            return result, output.getvalue(), calls, methods, notifications

    def test_launch_forces_read_only_never_ephemeral_and_disables_all_mcp_and_web(self):
        result, output, calls, methods, notifications = self.launch()
        self.assertEqual(result, 0)
        arguments, options = calls[-1]
        self.assertEqual(arguments[:8], ["fixture-codex", "--ask-for-approval", "never", "exec", "--ephemeral", "--sandbox", "read-only", "-C"])
        overrides = tomllib.loads("\n".join(arguments[index + 1] for index, value in enumerate(arguments) if value == "-c"))
        self.assertEqual(overrides["approval_policy"], "never")
        self.assertEqual(overrides["web_search"], "disabled")
        self.assertEqual(overrides["features"], {"apps": False, "plugins": False})
        disabled = overrides["mcp_servers"]
        self.assertEqual(disabled, {"context7": {"enabled": False}, 'private.server"name': {"enabled": False}})
        self.assertEqual(arguments[-1], "-")
        self.assertIn("agent_type=doc_drift_checker, fork_context=false", options["input"])
        self.assertIn("close the agent", options["input"])
        self.assertIn("approval_policy and approvals_reviewer separately", options["input"])
        self.assertIn("report it as unobserved", options["input"])
        self.assertIn('"base_sha": "' + BASE + '"', options["input"])
        self.assertIn('"head_sha": "' + HEAD + '"', options["input"])
        self.assertIn('"intended_changes": "Review fixture documentation changes"', options["input"])
        self.assertIn("separately inspect scoped staged and unstaged", options["input"])
        self.assertIn("Do not run", options["input"])
        self.assertNotIn("PRIVATE_CONFIGURATION_VALUE", options["input"])
        self.assertNotIn("PRIVATE_ENVIRONMENT_VALUE", options["input"])
        self.assertNotIn("PRIVATE_", output)
        self.assertEqual([method for method, _ in methods], ["initialize", "config/read"])
        self.assertFalse(methods[1][1]["includeLayers"])
        self.assertEqual(notifications, [{"method": "initialized"}, "closed"])
        for forbidden in ("--model", "--approve-for-me", "--worktree", "--add-dir", "--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust", "--output-last-message", "--ignore-user-config"):
            self.assertNotIn(forbidden, arguments)

    def test_head_mismatch_never_starts_metadata_or_review(self):
        result, _, calls, methods, _ = self.launch(actual_head=BASE)
        self.assertEqual(result, 2)
        self.assertTrue(all(arguments[0] == "git" for arguments, _ in calls))
        self.assertEqual(methods, [])

    def test_missing_or_unbounded_intent_cannot_start_metadata_or_review(self):
        for intent in ("", "   ", "x" * 4097, "review\ncommand", "review\x7fcommand", "review\u0085command"):
            with self.subTest(intent_length=len(intent)):
                result, _, calls, methods, _ = self.launch(intent=intent)
                self.assertEqual(result, 2)
                self.assertEqual(calls, [])
                self.assertEqual(methods, [])

    def test_disabled_agents_fail_closed_before_native_turn(self):
        result, output, calls, methods, notifications = self.launch(agents_enabled=False)
        self.assertEqual(result, 2)
        self.assertEqual(len(methods), 2)
        self.assertTrue(all(arguments[0] == "git" for arguments, _ in calls))
        self.assertIn("read-only configuration metadata", output)
        self.assertEqual(notifications[-1], "closed")

    def test_native_null_agents_setting_uses_enabled_default(self):
        result, _, calls, methods, _ = self.launch(agents_enabled=None)
        self.assertEqual(result, 0)
        self.assertEqual(calls[-1][0][0], "fixture-codex")
        self.assertEqual([method for method, _ in methods], ["initialize", "config/read"])

    def test_malformed_agents_setting_fails_closed_before_native_turn(self):
        result, _, calls, _, _ = self.launch(agents_enabled="true")
        self.assertEqual(result, 2)
        self.assertTrue(all(arguments[0] == "git" for arguments, _ in calls))

    def test_unavailable_metadata_fails_closed_without_disclosing_error_data(self):
        result, output, calls, _, notifications = self.launch(metadata_error=True)
        self.assertEqual(result, 2)
        self.assertNotIn("PRIVATE_SERVER_ERROR_DATA", output)
        self.assertTrue(all(arguments[0] == "git" for arguments, _ in calls))
        self.assertEqual(notifications[-1], "closed")

    def test_missing_config_metadata_fails_closed(self):
        result, _, calls, _, _ = self.launch(malformed_metadata=True)
        self.assertEqual(result, 2)
        self.assertTrue(all(arguments[0] == "git" for arguments, _ in calls))

    def test_invalid_mcp_inventory_fails_closed(self):
        for servers in (["PRIVATE_CONFIGURATION_VALUE"], {"x" * 257: {}}, {str(i): {} for i in range(129)}):
            with self.subTest(inventory_type=type(servers).__name__):
                result, output, calls, _, _ = self.launch(servers=servers)
                self.assertEqual(result, 2)
                self.assertNotIn("PRIVATE_", output)
                self.assertTrue(all(arguments[0] == "git" for arguments, _ in calls))

    def test_empty_mcp_inventory_still_has_explicit_empty_override(self):
        result, _, calls, _, _ = self.launch(servers={})
        self.assertEqual(result, 0)
        self.assertIn("mcp_servers={}", calls[-1][0])

    def test_unsafe_scope_rejected_before_git_metadata_or_native_turn(self):
        for value in ("../outside", "/etc/passwd", "docs/../outside", "private.pem", "private.KEY", ".env", ".env.local", ".git", ".aws", "raw.bin", "docs\ncommand", "docs\x7fcommand", "docs\u0085command", "docs\\outside"):
            with self.subTest(scope=value):
                result, _, calls, methods, _ = self.launch(paths=[value])
                self.assertEqual(result, 2)
                self.assertEqual(calls, [])
                self.assertEqual(methods, [])

    def test_existing_credential_files_rejected_without_read_rpc_or_native_turn(self):
        for value in (".git-credentials", ".netrc", ".npmrc", ".pypirc", "sdkconfig.local",
                      "credentials.json", "credentials.yml", "credentials.yaml", "secrets.env", ".codex/auth.json"):
            with self.subTest(scope=value):
                result, output, calls, methods, _ = self.launch(paths=[value], extra_files=[value])
                self.assertEqual(result, 2)
                self.assertEqual(calls, [])
                self.assertEqual(methods, [])
                self.assertNotIn("SYNTHETIC_SENSITIVE_FIXTURE", output)

    def test_scope_rejects_symlinks_and_special_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            (root / "target").write_text("fixture")
            (root / "link").symlink_to(root / "target")
            os.mkfifo(root / "fifo")
            with patch.object(review, "ROOT", root):
                for value in ("link", "fifo"):
                    with self.subTest(scope=value), self.assertRaises(ValueError):
                        review.validate_scope([value])

    def test_scope_deduplicates_regular_relative_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            (root / "docs").mkdir()
            with patch.object(review, "ROOT", root):
                self.assertEqual(review.validate_scope(["docs", "./docs"]), ["docs"])

    def test_commit_validation_requires_full_hex_and_read_only_git_resolution(self):
        with patch.object(review.subprocess, "run", side_effect=AssertionError("unsafe Git call")):
            for value in ("HEAD", "1234", "--help", HEAD + ";command", "g" * 40):
                with self.subTest(sha=value), self.assertRaises(ValueError):
                    review.commit_sha(value)

    def test_role_allowlist_contains_only_native_project_reviewers(self):
        self.assertEqual(review.ROLES, ("doc_drift_checker", "heap_safety_reviewer", "x10a_decode_reviewer"))


if __name__ == "__main__":
    unittest.main()
