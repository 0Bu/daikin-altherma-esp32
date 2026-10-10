#!/usr/bin/env python3
"""Formatter ownership canaries in isolated Git fixtures; never edit the checkout."""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import tracemalloc
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/agent-hooks"))
import agent_hook
import format_snapshot


@unittest.skipUnless(shutil.which("git") and shutil.which("clang-format"), "requires git and clang-format")
class FormatterOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(prefix="format-ownership-")
        self.addCleanup(self.fixture.cleanup)
        self.root = Path(self.fixture.name).resolve()
        self.source = self.root / "main/probe.cpp"
        self.source.parent.mkdir()
        shutil.copy2(ROOT / ".clang-format", self.root / ".clang-format")
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "core.hooksPath", "")
        self.baseline = "int  legacy_untouched ( int a )  {  return a ;  }\nint keep(int b) { return b; }\n"
        self.source.write_text(self.baseline)
        self.git("add", ".")
        self.git("commit", "-qm", "Fixture")
        self.addCleanup(shutil.rmtree, format_snapshot.cache_directory(self.root), True)

    def git(self, *args):
        return subprocess.run(["git", "-c", "core.fsmonitor=false", "-C", str(self.root), *args],
                              check=True, capture_output=True, text=True).stdout.strip()

    def payload(self, content, key="one", source=None):
        return {"cwd": str(self.root), "session_id": "fixture-session", "turn_id": "fixture-turn",
                "tool_use_id": key, "tool_name": "Write",
                "tool_input": {"file_path": str(source or self.source), "content": content}}

    def pre(self, payload):
        args = type("Args", (), {"partition_shell_only": False})()
        with patch.object(agent_hook, "HOOK_ROOT", self.root), patch("sys.stdin", io.StringIO(json.dumps(payload))):
            self.assertEqual(agent_hook.run_pre_tool_guards(args), 0)

    def post(self, payload):
        with patch.object(agent_hook, "HOOK_ROOT", self.root), patch("sys.stdin", io.StringIO(json.dumps(payload))), \
                patch("sys.stderr", new_callable=io.StringIO) as diagnostic, \
                patch("sys.stdout", new_callable=io.StringIO) as output:
            self.assertEqual(agent_hook.run_format(None), 0)
            if output.getvalue():
                result = json.loads(output.getvalue())
                if "toolCall" in payload:
                    self.assertEqual(result, {})
                    return diagnostic.getvalue()
                self.assertEqual(result["hookSpecificOutput"]["hookEventName"], "PostToolUse")
                context = result["hookSpecificOutput"]["additionalContext"]
                self.assertLessEqual(len(context), 4000)
                self.assertNotIn("legacy_untouched", context)
                return context
            return diagnostic.getvalue()

    def test_clean_file_reports_current_edit_without_writing(self):
        changed = self.baseline + "int   added_line ( int c )  {return c ;}\n"
        payload = self.payload(changed)
        self.pre(payload)
        self.source.write_text(changed)
        self.assertIn("current-tool edit needs reviewed formatting", self.post(payload))
        self.assertEqual(self.source.read_text(), changed)
        self.assertEqual(self.source.read_text().splitlines()[0], self.baseline.splitlines()[0])

    def test_prior_unstaged_user_hunk_is_never_formatted(self):
        prior = self.baseline.replace("int keep(int b)", "int    user_edit (int b)")
        self.source.write_text(prior)
        changed = prior + "int   added_line ( int c )  {return c ;}\n"
        payload = self.payload(changed)
        self.pre(payload)
        self.source.write_text(changed)
        self.post(payload)
        self.assertEqual(self.source.read_text(), changed)

    def test_prior_staged_user_hunk_is_never_formatted(self):
        prior = self.baseline.replace("int keep(int b)", "int    user_edit (int b)")
        self.source.write_text(prior)
        self.git("add", "main/probe.cpp")
        changed = prior + "int   added_line ( int c )  {return c ;}\n"
        payload = self.payload(changed)
        self.pre(payload)
        self.source.write_text(changed)
        self.post(payload)
        self.assertEqual(self.source.read_text(), changed)

    def test_existing_untracked_user_file_is_never_formatted(self):
        source = self.source.with_name("untracked.cpp")
        source.write_text("int    user_file ( ) {return 1 ;}\n")
        changed = source.read_text() + "int   added_line ( ) {return 0 ;}\n"
        payload = self.payload(changed, source=source)
        self.pre(payload)
        source.write_text(changed)
        self.post(payload)
        self.assertEqual(source.read_text(), changed)

    def test_proven_new_file_is_reported_without_writing(self):
        source = self.source.with_name("new.cpp")
        changed = "int  fresh ( )  {return 0 ;}\n"
        payload = self.payload(changed, source=source)
        self.pre(payload)
        source.write_text(changed)
        self.assertIn("current-tool edit needs reviewed formatting", self.post(payload))
        self.assertEqual(source.read_text(), changed)

    def test_antigravity_notice_keeps_its_empty_object_protocol(self):
        changed = self.baseline + "int   added_line ( int c )  {return c ;}\n"
        payload = self.payload(changed)
        payload["toolCall"] = {"name": "write_to_file", "args": {"TargetFile": str(self.source)}}
        with patch("sys.stdout", new_callable=io.StringIO):
            self.pre(payload)
        self.source.write_text(changed)
        self.assertIn("current-tool edit needs reviewed formatting", self.post(payload))
        self.assertEqual(self.source.read_text(), changed)

    def test_absent_pre_event_or_identity_is_a_noop(self):
        changed = self.baseline + "int   added_line ( int c )  {return c ;}\n"
        payload = self.payload(changed)
        self.source.write_text(changed)
        self.post(payload)
        self.assertEqual(self.source.read_text(), changed)
        for key in ("session_id", "turn_id", "tool_use_id"):
            missing = dict(payload)
            del missing[key]
            self.pre(missing)
            self.post(missing)
            self.assertEqual(self.source.read_text(), changed)

    def test_unexpected_concurrent_edit_is_a_noop(self):
        changed = self.baseline + "int   added_line ( int c )  {return c ;}\n"
        payload = self.payload(changed)
        self.pre(payload)
        concurrent = changed.replace("int keep(int b)", "int    user_edit (int b)")
        self.source.write_text(concurrent)
        self.post(payload)
        self.assertEqual(self.source.read_text(), concurrent)

    def test_overlapping_tool_snapshots_invalidate_both(self):
        changed = self.baseline + "int   added_line ( int c )  {return c ;}\n"
        first, second = self.payload(changed), self.payload(changed, key="two")
        self.pre(first)
        self.pre(second)
        self.source.write_text(changed)
        self.post(first)
        self.post(second)
        self.assertEqual(self.source.read_text(), changed)

    def test_second_tool_after_first_write_invalidates_first_snapshot(self):
        changed = self.baseline + "int   added_line ( int c )  {return c ;}\n"
        first = self.payload(changed)
        self.pre(first)
        self.source.write_text(changed)
        self.pre(self.payload(changed, key="two"))
        self.post(first)
        self.assertEqual(self.source.read_text(), changed)

    def test_changed_tool_input_or_head_is_a_noop(self):
        changed = self.baseline + "int   added_line ( int c )  {return c ;}\n"
        payload = self.payload(changed)
        self.pre(payload)
        self.source.write_text(changed)
        self.post(self.payload(changed + "\n"))
        self.assertEqual(self.source.read_text(), changed)
        self.source.write_text(self.baseline)
        self.pre(payload)
        self.git("commit", "--allow-empty", "-qm", "New head")
        self.source.write_text(changed)
        self.post(payload)
        self.assertEqual(self.source.read_text(), changed)

    def test_custom_patch_exact_edit_is_correlated(self):
        command = "*** Begin Patch\n*** Update File: main/probe.cpp\n@@\n-int keep(int b) { return b; }\n+int   added_line ( int c )  {return c ;}\n*** End Patch"
        payload = self.payload("")
        payload.update(tool_name="apply_patch", tool_input={"patch": command})
        self.pre(payload)
        self.source.write_text(self.baseline.replace("int keep(int b) { return b; }", "int   added_line ( int c )  {return c ;}"))
        changed = self.source.read_text()
        self.assertIn("current-tool edit needs reviewed formatting", self.post(payload))
        self.assertEqual(self.source.read_text(), changed)

    def test_custom_patch_add_file_is_correlated(self):
        source = self.source.with_name("patch_new.cpp")
        payload = self.payload("")
        payload.update(tool_name="apply_patch", tool_input={"patch":
            "*** Begin Patch\n*** Add File: main/patch_new.cpp\n+int  fresh ( )  {return 0 ;}\n*** End Patch"})
        self.pre(payload)
        source.write_text("int  fresh ( )  {return 0 ;}\n")
        changed = source.read_text()
        self.assertIn("current-tool edit needs reviewed formatting", self.post(payload))
        self.assertEqual(source.read_text(), changed)

    def test_exact_edit_replacement_is_correlated(self):
        payload = self.payload("")
        payload.update(tool_name="Edit", tool_input={"file_path": str(self.source),
            "old_string": "int keep(int b) { return b; }", "new_string": "int   changed ( int b ) {return b ;}"})
        self.pre(payload)
        self.source.write_text(self.baseline.replace(payload["tool_input"]["old_string"], payload["tool_input"]["new_string"]))
        changed = self.source.read_text()
        self.assertIn("current-tool edit needs reviewed formatting", self.post(payload))
        self.assertEqual(self.source.read_text(), changed)

    def test_contended_cache_lock_is_not_removed(self):
        directory = format_snapshot.cache_directory(self.root)
        lock = format_snapshot.acquire_lock(directory)
        lock_path = directory / "records.lock"
        inode = lock_path.stat().st_ino
        payload = self.payload(self.baseline + "int   added_line ( ) {return 0 ;}\n")
        try:
            self.pre(payload)
            self.assertEqual(lock_path.stat().st_ino, inode)
            self.assertEqual(list(directory.glob("*.json")), [])
        finally:
            os.close(lock)
        self.source.write_text(payload["tool_input"]["content"])
        self.post(payload)
        self.assertEqual(self.source.read_text(), payload["tool_input"]["content"])

    def test_abrupt_process_exit_releases_cache_lock(self):
        directory = format_snapshot.cache_directory(self.root)
        script = """import os, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import format_snapshot
format_snapshot.acquire_lock(Path(sys.argv[2]))
os._exit(0)
"""
        result = subprocess.run([sys.executable, "-c", script, str(ROOT / "tools/agent-hooks"), str(directory)],
                                capture_output=True, text=True, timeout=2)
        self.assertEqual(result.returncode, 0, result.stderr)
        changed = self.baseline + "int   added_line ( ) {return 0 ;}\n"
        payload = self.payload(changed)
        self.pre(payload)
        self.source.write_text(changed)
        self.assertIn("current-tool edit needs reviewed formatting", self.post(payload))
        self.assertEqual(self.source.read_text(), changed)

    def test_full_cache_can_drain_without_exceeding_its_budget(self):
        changed = self.baseline + "int   added_line ( ) {return 0 ;}\n"
        payload = self.payload(changed)
        self.pre(payload)
        directory = format_snapshot.cache_directory(self.root)
        for index in range(format_snapshot.MAX_RECORDS - 1):
            format_snapshot.write_record(directory / f"fixture-{index}.json",
                                         {"inputs": "", "paths": {}, "blocked": True})
        new_source = self.source.with_name("new.cpp")
        self.pre(self.payload("int new_file() {return 0;}\n", key="new", source=new_source))
        self.assertEqual(len(list(directory.glob("*.json"))), format_snapshot.MAX_RECORDS)
        self.source.write_text(changed)
        self.assertIn("current-tool edit needs reviewed formatting", self.post(payload))
        self.assertEqual(len(list(directory.glob("*.json"))), format_snapshot.MAX_RECORDS - 1)
        self.assertEqual(self.source.read_text(), changed)

    def test_symlink_cache_lock_cannot_touch_its_destination(self):
        directory = format_snapshot.cache_directory(self.root)
        destination = self.root / "unrelated.txt"
        destination.write_text("unrelated contents\n")
        (directory / "records.lock").symlink_to(destination)
        changed = self.baseline + "int   added_line ( ) {return 0 ;}\n"
        payload = self.payload(changed)
        self.pre(payload)
        self.source.write_text(changed)
        self.assertEqual(self.post(payload), "")
        self.assertEqual(destination.read_text(), "unrelated contents\n")
        self.assertEqual(self.source.read_text(), changed)

    def test_user_edit_during_formatter_is_preserved(self):
        changed = self.baseline + "int   added_line ( int c )  {return c ;}\n"
        payload = self.payload(changed)
        self.pre(payload)
        self.source.write_text(changed)
        concurrent = changed.replace("int keep(int b)", "int    user_edit (int b)")
        original_run = subprocess.run
        def edit_during_format(command, **kwargs):
            result = original_run(command, **kwargs)
            if command[0] == "clang-format":
                self.source.write_text(concurrent)
            return result
        with patch("subprocess.run", side_effect=edit_during_format):
            self.assertEqual(self.post(payload), "")
        self.assertEqual(self.source.read_text(), concurrent)

    def test_user_edit_at_final_head_check_is_never_overwritten(self):
        changed = self.baseline + "int   added_line ( int c )  {return c ;}\n"
        payload = self.payload(changed)
        self.pre(payload)
        self.source.write_text(changed)
        concurrent = changed.replace("int keep(int b)", "int    user_edit (int b)")
        original_run = subprocess.run
        heads = 0
        def edit_at_last_check(command, **kwargs):
            nonlocal heads
            result = original_run(command, **kwargs)
            if command[-3:] == ["rev-parse", "--verify", "HEAD"]:
                heads += 1
                if heads == 2:
                    self.source.write_text(concurrent)
            return result
        with patch("subprocess.run", side_effect=edit_at_last_check):
            self.assertEqual(self.post(payload), "")
        self.assertEqual(heads, 2)
        self.assertEqual(self.source.read_text(), concurrent)

    def test_symlink_swap_at_final_head_check_cannot_touch_its_destination(self):
        changed = self.baseline + "int   added_line ( int c )  {return c ;}\n"
        payload = self.payload(changed)
        self.pre(payload)
        self.source.write_text(changed)
        destination = self.source.with_name("user_destination.cpp")
        destination.write_text("int    user_destination ( ) {return 1 ;}\n")
        preserved = destination.read_bytes()
        original_run = subprocess.run
        heads = 0
        def symlink_at_last_check(command, **kwargs):
            nonlocal heads
            result = original_run(command, **kwargs)
            if command[-3:] == ["rev-parse", "--verify", "HEAD"]:
                heads += 1
                if heads == 2:
                    self.source.unlink()
                    self.source.symlink_to(destination)
            return result
        with patch("subprocess.run", side_effect=symlink_at_last_check):
            self.assertEqual(self.post(payload), "")
        self.assertEqual(heads, 2)
        self.assertTrue(self.source.is_symlink())
        self.assertEqual(destination.read_bytes(), preserved)

    def test_untracked_scope_discovery_symlink_swap_is_not_read(self):
        source = self.source.with_name("new.cpp")
        changed = "int  fresh ( )  {return 0 ;}\n"
        payload = self.payload(changed, source=source)
        self.pre(payload)
        source.write_text(changed)
        destination = self.root / "unrelated.txt"
        destination.write_text("unrelated contents must not enter formatter context\n")
        original_run = subprocess.run
        swapped = False
        def symlink_after_scope(command, **kwargs):
            nonlocal swapped
            result = original_run(command, **kwargs)
            if "ls-files" in command and "--others" in command:
                source.unlink()
                source.symlink_to(destination)
                swapped = True
            return result
        original_read = Path.read_bytes
        def reject_symlink_read(path):
            if path == source and path.is_symlink():
                raise AssertionError("untracked line-count followed the swapped symlink")
            return original_read(path)
        with patch("subprocess.run", side_effect=symlink_after_scope), \
                patch.object(Path, "read_bytes", autospec=True, side_effect=reject_symlink_read):
            self.assertEqual(self.post(payload), "")
        self.assertTrue(swapped)
        self.assertTrue(source.is_symlink())
        self.assertEqual(destination.read_text(), "unrelated contents must not enter formatter context\n")

    def test_fifo_is_rejected_promptly_before_any_read(self):
        fifo = self.source.with_name("fifo.cpp")
        os.mkfifo(fifo)
        script = """import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import format_snapshot
try:
    format_snapshot.read_source(Path(sys.argv[2]))
except OSError:
    raise SystemExit(0)
raise SystemExit(1)
"""
        result = subprocess.run([sys.executable, "-c", script, str(ROOT / "tools/agent-hooks"), str(fifo)],
                                capture_output=True, text=True, timeout=1)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_snapshot_contains_no_source_content_and_cannot_be_replayed(self):
        changed = self.baseline + "int   added_line ( int c )  {return c ;}\n"
        payload = self.payload(changed)
        self.pre(payload)
        record = next(format_snapshot.cache_directory(self.root).glob("*.json"))
        self.assertEqual(record.stat().st_mode & 0o777, 0o600)
        self.assertNotIn("legacy_untouched", record.read_text())
        self.source.write_text(changed)
        self.assertIn("current-tool edit needs reviewed formatting", self.post(payload))
        self.source.write_text(changed)
        self.assertEqual(self.post(payload), "")
        self.assertEqual(self.source.read_text(), changed)


class FormatterAllocationTests(unittest.TestCase):
    def test_replace_all_rejects_expansion_before_allocating_output(self):
        previous = b"x" * 8192
        inputs = {"old_string": "x", "new_string": "x" * 1024, "replace_all": True}
        tracemalloc.start()
        try:
            result = format_snapshot.expected_content("edit", inputs, "", "probe.cpp", previous)
            self.assertTrue(result is None, "oversized replacement was constructed")
            self.assertLess(tracemalloc.get_traced_memory()[1], 2 * format_snapshot.MAX_CONTENT_BYTES)
        finally:
            tracemalloc.stop()

    def test_write_limit_counts_utf8_bytes_before_encoding_whole_input(self):
        class NoWholeEncoding(str):
            def encode(self, *args, **kwargs):
                raise AssertionError("oversized output must not be encoded")

        content = NoWholeEncoding("é" * (format_snapshot.MAX_CONTENT_BYTES // 2 + 1))
        self.assertIsNone(format_snapshot.expected_content("write", {"content": content}, "", "probe.cpp", None))

    def test_exact_byte_limit_and_shrinking_edits_still_work(self):
        limit = format_snapshot.MAX_CONTENT_BYTES
        inputs = {"old_string": "x", "new_string": "é" * (limit // 2)}
        expected = inputs["new_string"].encode()
        self.assertEqual(format_snapshot.expected_content("edit", inputs, "", "probe.cpp", b"x"), expected)
        self.assertEqual(format_snapshot.expected_content("write", {"content": inputs["new_string"]}, "", "probe.cpp", None), expected)
        inputs = {"old_string": "é", "new_string": "x", "replace_all": True}
        self.assertEqual(format_snapshot.expected_content("edit", inputs, "", "probe.cpp", expected), b"x" * (limit // 2))

    def test_patch_growth_is_rejected_before_replacing_source_lines(self):
        previous = b"keep\n" + b"x" * 600000 + b"\n"
        patch_text = "*** Begin Patch\n*** Update File: probe.cpp\n@@\n-keep\n+" + "y" * 600000 + "\n*** End Patch\n"
        self.assertIsNone(format_snapshot.patch_result(patch_text, "probe.cpp", previous))
        self.assertEqual(format_snapshot.patch_result("*** Begin Patch\n*** Update File: probe.cpp\n@@\n-keep\n+é\n*** End Patch\n", "probe.cpp", previous),
                         "é\n".encode() + previous[5:])

    def test_oversized_patch_and_single_replacement_are_skipped(self):
        oversized = "x" * (format_snapshot.MAX_CONTENT_BYTES + 1)
        self.assertIsNone(format_snapshot.patch_result("*** Begin Patch\n*** Add File: probe.cpp\n+" + oversized + "\n*** End Patch\n", "probe.cpp", None))
        self.assertIsNone(format_snapshot.expected_content("edit", {"old_string": "x", "new_string": oversized}, "", "probe.cpp", b"x"))


if __name__ == "__main__":
    unittest.main()
