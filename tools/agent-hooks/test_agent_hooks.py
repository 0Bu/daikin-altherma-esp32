#!/usr/bin/env python3
"""Fast in-process unit tests for agent_hook guards and Antigravity normalization."""

from __future__ import annotations

import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/agent-hooks"))

import agent_hook


class AgentHookFastTests(unittest.TestCase):
    def run_pre_tool(self, payload: dict) -> tuple[int, str]:
        with patch("sys.stdin", io.StringIO(json.dumps(payload))):
            with patch("sys.stdout", new_callable=io.StringIO) as fake_out:
                args = unittest.mock.MagicMock()
                args.partition_shell_only = False
                rc = agent_hook.run_pre_tool_guards(args)
                return rc, fake_out.getvalue().strip()

    def test_antigravity_safe_command_allowed(self):
        payload = {"toolCall": {"name": "run_command", "args": {"CommandLine": "ls -la"}}}
        rc, out = self.run_pre_tool(payload)
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out), {"decision": "allow"})

    def test_antigravity_secret_blocked(self):
        payload = {"toolCall": {"name": "run_command", "args": {"CommandLine": "cat ota_signing_key.pem"}}}
        rc, out = self.run_pre_tool(payload)
        self.assertEqual(rc, 0)
        data = json.loads(out)
        self.assertEqual(data["decision"], "deny")
        self.assertIn("secret guard", data["reason"])

    def test_antigravity_view_secret_blocked(self):
        payload = {"toolCall": {"name": "view_file", "args": {"AbsolutePath": "/project/ota_signing_key.pem"}}}
        rc, out = self.run_pre_tool(payload)
        self.assertEqual(rc, 0)
        data = json.loads(out)
        self.assertEqual(data["decision"], "deny")

    def test_codex_safe_command_silent(self):
        payload = {"tool_name": "Bash", "tool_input": {"command": "ls -la"}}
        rc, out = self.run_pre_tool(payload)
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_codex_secret_blocked(self):
        payload = {"tool_name": "Bash", "tool_input": {"command": "cat ota_signing_key.pem"}}
        rc, out = self.run_pre_tool(payload)
        self.assertEqual(rc, 0)
        data = json.loads(out)
        self.assertEqual(data["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_partition_modification_blocked(self):
        payload = {"toolCall": {"name": "write_to_file", "args": {"TargetFile": "/path/partitions.csv"}}}
        rc, out = self.run_pre_tool(payload)
        self.assertEqual(rc, 0)
        data = json.loads(out)
        self.assertEqual(data["decision"], "deny")
        self.assertIn("partitions.csv write", data["reason"])

    def test_direct_ota_post_blocked(self):
        payload = {"toolCall": {"name": "run_command", "args": {"CommandLine": "curl -X POST http://192.0.2.137/ota/update"}}}
        rc, out = self.run_pre_tool(payload)
        self.assertEqual(rc, 0)
        data = json.loads(out)
        self.assertEqual(data["decision"], "deny")
        self.assertIn("role-pinned OTA gate", data["reason"])

    def test_pr_gates_non_merge_allowed(self):
        payload = {"toolCall": {"name": "run_command", "args": {"CommandLine": "git status"}}}
        with patch("sys.stdin", io.StringIO(json.dumps(payload))):
            with patch("sys.stdout", new_callable=io.StringIO) as fake_out:
                args = unittest.mock.MagicMock()
                rc = agent_hook.run_pr_gates(args)
                self.assertEqual(rc, 0)
                data = json.loads(fake_out.getvalue().strip())
                self.assertEqual(data["decision"], "allow")


if __name__ == "__main__":
    unittest.main()
