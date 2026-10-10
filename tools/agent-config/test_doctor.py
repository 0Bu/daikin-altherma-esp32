#!/usr/bin/env python3
"""Metadata fixture checks: observation never claims live dispatch or grants trust."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("codex_doctor", Path(__file__).with_name("doctor.py"))
doctor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(doctor)


class DoctorChecks(unittest.TestCase):
    def observe(self, trusted: bool, pinned: bool = True, *, user_only: bool = False,
                trust_status: str | None = None, linked: bool = False,
                primary_adapter: str = "current", foreign_source: bool = False,
                context_enabled: bool | None = None, agents_enabled: bool | str | None = None,
                config_at_primary: bool = False, agents_null: bool = False) -> tuple[bool, str, list[str]]:
        with tempfile.TemporaryDirectory() as temporary:
            temporary_root = Path(temporary).resolve()
            primary = temporary_root / "primary"
            primary.mkdir()

            def git(path, *arguments):
                return subprocess.run(["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=",
                                       "-c", "commit.gpgsign=false", "-C", str(path), *arguments],
                                      check=True, capture_output=True, text=True)

            git(primary, "init", "--quiet")
            root = primary
            if linked:
                git(primary, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                    "commit", "--quiet", "--allow-empty", "-m", "fixture")
                root = temporary_root / "linked"
                git(primary, "worktree", "add", "--quiet", "--detach", str(root), "HEAD")
            (root / ".codex").mkdir()
            (root / ".mcp.json").write_text(json.dumps({"mcpServers": {"context7": {"command": "npx", "args": ["-y", "@upstash/context7-mcp@4.0.2"]}}}))
            events = {"PreToolUse": "preToolUse", "PostToolUse": "postToolUse", "Stop": "stop"}
            hooks = {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "guard", "timeout": 10}, {"type": "command", "command": "gates", "timeout": 600}]}],
                     "PostToolUse": [{"matcher": "Edit", "hooks": [{"type": "command", "command": "format", "timeout": 30}]}],
                     "Stop": [{"hooks": [{"type": "command", "command": "stop", "timeout": 600}]}]}
            adapter = json.dumps({"hooks": hooks})
            (root / ".codex/hooks.json").write_text(adapter)
            if linked and primary_adapter != "missing":
                (primary / ".codex").mkdir()
                (primary / ".codex/hooks.json").write_text(adapter if primary_adapter == "current" else adapter + "\n")
            source_path = root / ".codex/hooks.json" if foreign_source else primary / ".codex/hooks.json"
            metadata = [{"source": "project", "sourcePath": str(source_path), "eventName": events[event],
                         "handlerType": "command", "command": handler["command"], "timeoutSec": handler["timeout"],
                         "matcher": group.get("matcher"), "async": False, "additionalContextLimit": None,
                         "currentHash": "0" * 64, "displayOrder": index, "key": f"fixture-{index}",
                         "isManaged": False, "pluginId": None, "statusMessage": None, "enabled": True,
                         "trustStatus": trust_status or ("trusted" if trusted else "untrusted")}
                        for index, (event, group, handler) in enumerate(
                            (event, group, handler) for event, groups in hooks.items() for group in groups for handler in group["hooks"])]
            if user_only:
                metadata = [{**hook, "source": "user", "sourcePath": str(root / "private-user-hooks.json"),
                             "command": "PRIVATE_METADATA_COMMAND"} for hook in metadata[:2]]
            methods = []
            context_config = {"command": "npx", "args": ["-y", "@upstash/context7-mcp@4.0.2"] if pinned else ["@latest"],
                              "env": {"SHOULD_NEVER_PRINT": "PRIVATE_FIXTURE_VALUE"}}
            agents_config = {"max_concurrent_threads_per_session": 3}
            if context_enabled is not None:
                context_config["enabled"] = context_enabled
            if agents_enabled is not None or agents_null:
                agents_config["enabled"] = agents_enabled

            class FixtureRpc:
                def __init__(self, executable):
                    pass

                def request(self, method, params):
                    methods.append(method)
                    if method == "initialize":
                        return {}
                    if method == "config/read":
                        return {"config": {"agents": agents_config, "mcp_servers": {"context7": context_config}},
                            "origins": {}, "layers": [{"name": {"type": "project", "dotCodexFolder": str((primary if config_at_primary else root) / ".codex")},
                                        "config": {"agents": agents_config},
                                        "disabledReason": None, "version": "fixture-version"}]}
                    if method == "hooks/list":
                        return {"data": [{"cwd": str(root), "hooks": metadata, "errors": [], "warnings": []}]}
                    raise AssertionError("unexpected method")

                def send(self, value):
                    self.assert_notification = value == {"method": "initialized"}

                def close(self):
                    pass

            output = io.StringIO()
            with patch.object(doctor, "ROOT", root), patch.object(doctor, "ReadOnlyRpc", FixtureRpc), patch.object(doctor.shutil, "which", return_value="fixture"), contextlib.redirect_stdout(output):
                ready = doctor.observe_runtime()
            return ready, output.getvalue(), methods

    def test_untrusted_registration_stays_pending(self):
        ready, output, methods = self.observe(False)
        self.assertFalse(ready)
        self.assertIn("trust=untrusted", output)
        self.assertIn("expected-project-source=4/4", output)
        self.assertNotIn("not-discovered", output)
        self.assertEqual(methods, ["initialize", "config/read", "hooks/list"])
        self.assertNotIn("PRIVATE_FIXTURE_VALUE", output)

    def test_trusted_metadata_is_only_registration_evidence(self):
        ready, output, methods = self.observe(True)
        self.assertTrue(ready)
        self.assertEqual(len(methods), 3)
        self.assertNotIn("PRIVATE_FIXTURE_VALUE", output)
        self.assertNotIn("dispatch verified", output)
        self.assertIn("native hook source current checkout:", output)
        self.assertIn("native hook adapter matches-worktree-generated-adapter", output)

    def test_linked_worktree_uses_primary_hook_source_and_current_config(self):
        ready, output, methods = self.observe(True, linked=True)
        self.assertTrue(ready)
        self.assertIn("native hook source primary checkout (linked worktree):", output)
        self.assertIn("/primary/.codex/hooks.json", output)
        self.assertIn("native project config layer active at current worktree", output)
        self.assertIn("expected-project-source=4/4", output)
        self.assertEqual(methods, ["initialize", "config/read", "hooks/list"])

    def test_linked_worktree_missing_primary_adapter_is_discovery_failure(self):
        ready, output, methods = self.observe(True, linked=True, primary_adapter="missing", user_only=True)
        self.assertFalse(ready)
        self.assertIn("native hook adapter missing", output)
        self.assertIn("native project config layer active at current worktree", output)
        self.assertIn("expected-project-source=0/4; project=0, user=2", output)
        self.assertNotIn("trust=untrusted", output)
        self.assertNotIn("PRIVATE_METADATA_COMMAND", output)
        self.assertEqual(methods, ["initialize", "config/read", "hooks/list"])

    def test_linked_worktree_stale_or_foreign_primary_adapter_stays_incomplete(self):
        ready, output, _ = self.observe(True, linked=True, primary_adapter="stale")
        self.assertFalse(ready)
        self.assertIn("native hook adapter stale-or-foreign", output)

    def test_linked_worktree_foreign_hook_source_stays_incomplete(self):
        ready, output, _ = self.observe(True, linked=True, foreign_source=True)
        self.assertFalse(ready)
        self.assertIn("expected-project-source=0/4; project=4", output)
        self.assertIn("foreign source or unsupported handler type=4", output)

    def test_linked_worktree_primary_config_is_not_current_worktree_config(self):
        ready, output, _ = self.observe(True, linked=True, config_at_primary=True)
        self.assertFalse(ready)
        self.assertIn("native project config layer not active or not exposed at current worktree", output)

    def test_active_project_layer_with_only_user_hooks_is_not_discovered(self):
        ready, output, methods = self.observe(True, user_only=True)
        self.assertFalse(ready)
        self.assertIn("native project config layer active", output)
        self.assertIn("expected-project-source=0/4; project=0, user=2, other=0; errors=0, warnings=0", output)
        self.assertEqual(output.count("registration not-discovered; trust=not-observed"), 4)
        self.assertNotIn("trust=untrusted", output)
        self.assertNotIn("PRIVATE_METADATA_COMMAND", output)
        self.assertNotIn("PRIVATE_FIXTURE_VALUE", output)
        self.assertEqual(methods, ["initialize", "config/read", "hooks/list"])

    def test_modified_project_hooks_are_discovered_but_pending(self):
        ready, output, _ = self.observe(True, trust_status="modified")
        self.assertFalse(ready)
        self.assertIn("expected-project-source=4/4", output)
        self.assertEqual(output.count("registration pending; trust=modified"), 4)
        self.assertNotIn("not-discovered", output)

    def test_effective_mcp_override_is_detected(self):
        ready, output, _ = self.observe(True, False)
        self.assertFalse(ready)
        self.assertIn("missing or overridden", output)

    def test_effective_context7_disabled_is_detected_even_with_matching_pin(self):
        ready, output, _ = self.observe(True, context_enabled=False)
        self.assertFalse(ready)
        self.assertIn("effective Context7 registration matches pin; disabled", output)

    def test_effective_subagents_disabled_is_detected_even_with_matching_limit(self):
        ready, output, _ = self.observe(True, agents_enabled=False)
        self.assertFalse(ready)
        self.assertIn("effective three-subagent limit observed", output)
        self.assertIn("effective subagent tools disabled", output)

    def test_native_null_subagents_setting_uses_enabled_default(self):
        ready, output, _ = self.observe(True, agents_null=True)
        self.assertTrue(ready)
        self.assertIn("effective subagent tools enabled", output)

    def test_malformed_subagents_setting_stays_incomplete(self):
        ready, output, _ = self.observe(True, agents_enabled="true")
        self.assertFalse(ready)
        self.assertIn("effective subagent tools disabled", output)

    def test_hook_adapter_rejects_symlink_without_reading_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / ".codex").mkdir()
            target = root / "private.key"
            target.write_bytes(b"SYNTHETIC_PRIVATE_CONTENT")
            (root / ".codex/hooks.json").symlink_to(target)
            with patch.object(doctor.os, "fdopen", side_effect=AssertionError("unsafe read")):
                self.assertEqual(doctor.hook_adapter_status(root / ".codex/hooks.json", b"expected"), "unsafe-path")

    def test_hook_adapter_rejects_directory_symlink_without_reading_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "foreign").mkdir()
            (root / ".codex").symlink_to(root / "foreign", target_is_directory=True)
            with patch.object(doctor.os, "fdopen", side_effect=AssertionError("unsafe read")):
                self.assertEqual(doctor.hook_adapter_status(root / ".codex/hooks.json", b"expected"), "unsafe-path")

    def test_hook_adapter_rejects_replaced_symlink_at_open_without_read(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / ".codex").mkdir()
            hook = root / ".codex/hooks.json"
            hook.write_bytes(b"expected")
            target = root / "private.key"
            target.write_bytes(b"SYNTHETIC_PRIVATE_CONTENT")
            original_open = os.open

            def replace_before_open(path, flags, *args, **kwargs):
                if path == "hooks.json":
                    hook.unlink()
                    hook.symlink_to(target)
                return original_open(path, flags, *args, **kwargs)

            with patch.object(doctor.os, "open", side_effect=replace_before_open), patch.object(doctor.os, "fdopen", side_effect=AssertionError("unsafe read")):
                self.assertEqual(doctor.hook_adapter_status(hook, b"expected"), "unsafe-path")

    def test_hook_adapter_rejects_fifo_without_opening_stream(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / ".codex").mkdir()
            os.mkfifo(root / ".codex/hooks.json")
            with patch.object(doctor.os, "fdopen", side_effect=AssertionError("unsafe read")):
                self.assertEqual(doctor.hook_adapter_status(root / ".codex/hooks.json", b"expected"), "unsafe-path")

    def test_local_expected_sources_reject_links_fifo_oversize_and_open_races_before_rpc(self):
        for relative in (".codex/hooks.json", ".mcp.json"):
            for fault in ("symlink", "fifo", "oversize", "race"):
                with self.subTest(source=relative, fault=fault), tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary).resolve()
                    (root / ".codex").mkdir()
                    (root / ".codex/hooks.json").write_text('{"hooks": {}}')
                    (root / ".mcp.json").write_text('{"mcpServers": {"context7": {}}}')
                    private = root / "private.key"
                    private.write_bytes(b"SYNTHETIC_PRIVATE_CONTENT")
                    private_inode = private.stat().st_ino
                    target = root / relative
                    if fault in {"symlink", "fifo"}:
                        target.unlink()
                        target.symlink_to(private) if fault == "symlink" else os.mkfifo(target)
                    elif fault == "oversize":
                        target.write_bytes(b"x" * (2 * 1024 * 1024 + 1))
                    original_open, original_fdopen = os.open, os.fdopen
                    read_sizes = []

                    def race_open(path, flags, *args, **kwargs):
                        if fault == "race" and path == target.name:
                            target.unlink()
                            target.symlink_to(private)
                        return original_open(path, flags, *args, **kwargs)

                    def bounded_stream(descriptor, mode):
                        self.assertNotEqual(os.fstat(descriptor).st_ino, private_inode, "private target reached the reader")
                        underlying = original_fdopen(descriptor, mode)

                        class Stream:
                            def __enter__(self):
                                return self

                            def __exit__(self, *args):
                                underlying.close()

                            def read(self, size):
                                read_sizes.append(size)
                                self_test.assertLessEqual(size, 2 * 1024 * 1024 + 1)
                                return underlying.read(size)

                        return Stream()

                    self_test = self
                    output = io.StringIO()
                    with patch.object(doctor, "ROOT", root), patch.object(doctor, "native_hook_source", return_value=(root / ".codex/hooks.json", False)), patch.object(doctor.shutil, "which", return_value="fixture"), patch.object(doctor, "ReadOnlyRpc", side_effect=AssertionError("RPC must not start")), patch.object(doctor.os, "open", side_effect=race_open), patch.object(doctor.os, "fdopen", side_effect=bounded_stream), contextlib.redirect_stdout(output):
                        self.assertFalse(doctor.observe_runtime())
                    self.assertIn("SourceReadError", output.getvalue())
                    self.assertNotIn("SYNTHETIC_PRIVATE_CONTENT", output.getvalue())
                    if relative == ".codex/hooks.json" and fault != "oversize":
                        self.assertEqual(read_sizes, [])

    def test_metadata_cannot_complete_runtime_acceptance(self):
        output = io.StringIO()
        with patch.object(doctor.sys, "argv", ["doctor.py", "--runtime", "--require-runtime"]), patch.object(doctor, "observe_runtime", return_value=True), patch.object(doctor.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout="")), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            result = doctor.main()
        self.assertEqual(result, 1)
        self.assertIn("fresh-task evidence", output.getvalue())


if __name__ == "__main__":
    unittest.main()
