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
import merge_payload


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


    def test_pr_gates_read_only_push_text_is_not_a_push(self):
        payload = {"toolCall": {"name": "run_command", "args": {"CommandLine": 'git log --grep="a git push"'}}}
        with patch("sys.stdin", io.StringIO(json.dumps(payload))):
            with patch("sys.stdout", new_callable=io.StringIO) as fake_out:
                args = unittest.mock.MagicMock()
                rc = agent_hook.run_pr_gates(args)
                self.assertEqual(rc, 0)
                data = json.loads(fake_out.getvalue().strip())
                self.assertEqual(data["decision"], "allow")

    def test_native_review_source_reads_are_allowed_without_running_commands(self):
        commands = [
            "git -c core.fsmonitor=false --no-optional-locks ls-files -- AGENTS.md CONTRIBUTING.md README.md 'docs/*.md' '.agents/skills/*/SKILL.md' '.agents/agents/*.md'",
            "nl -ba scripts/production-ota-gate.py | sed -n '1140,1186p'",
            "rg -n 'expected.elf|expected_elf|app_elf_sha256|ELF|sha256|prefix|signature|verify_signature' scripts/verify-device-health.sh scripts/require-signed.sh",
            "rg -n -C 3 --glob '*.md' 'app_elf_sha256|ELF.*(prefix|SHA|hash)|CONFIG_APP_RETRIEVE_LEN_ELF_SHA' docs/ARCHITECTURE.md docs/SECURITY.md docs/FEATURES.md docs/DESIGN.md docs/README.md .agents/skills/deploy-prod/SKILL.md .agents/skills/device-triage/SKILL.md .agents/skills/bug-triage/SKILL.md",
        ]
        with patch.object(agent_hook.subprocess, "run", side_effect=AssertionError("must not execute")):
            for command in commands:
                with self.subTest(command=command):
                    rc, out = self.run_pre_tool({"tool_name": "Bash", "tool_input": {"command": command}})
                    self.assertEqual((rc, out), (0, ""))

    def test_reader_proof_does_not_admit_execution_or_writes(self):
        commands = [
            "cat AGENTS.md > partitions.csv",
            "git -c alias.inspect='!sh' inspect partitions.csv",
            "git -c core.pager=sh log partitions.csv",
            "nl -ba scripts/production-ota-gate.py | sh",
            "sed -n 'e scripts/production-ota-gate.py --execute' AGENTS.md",
            "sed -n 'w /tmp/SYNTHETIC_GATE_COPY' scripts/production-ota-gate.py",
            "sed -i '1,80p' scripts/production-ota-gate.py",
            "cat scripts/production-ota-gate.py > /tmp/SYNTHETIC_GATE_COPY",
            "rg -n '--pre=sh' scripts/production-ota-gate.py",
            "rg -n 'prefix|sh' scripts/require-signed.sh | sh",
            "rg -n 'ELF.*(prefix|SHA)' docs/ARCHITECTURE.md > /tmp/output",
            "cat /tmp/@(ordinary|private).pem",
            "bash -c 'cat /tmp/@(ordinary|private).pem'",
            "printf harmless | env sh",
            "bash -s",
            "sh < /tmp/script",
            "sh <<'EOF'",
            "sh <<< 'harmless'",
            "rg --hostname-bin=sh -n 'prefix|sh' scripts/production-ota-gate.py",
        ]
        with patch.object(agent_hook.subprocess, "run", side_effect=AssertionError("must not execute")):
            for command in commands:
                with self.subTest(command=command):
                    rc, out = self.run_pre_tool({"tool_name": "Bash", "tool_input": {"command": command}})
                    self.assertEqual(rc, 0)
                    self.assertEqual(json.loads(out)["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_literal_query_proof_rejects_flags_wrappers_and_expansions(self):
        commands = [
            "rg -n '--pre=sh' docs/ARCHITECTURE.md",
            "rg -n 'prefix|sh' --pre=sh",
            "rg -n 'prefix|sh' ../outside.md",
            "rg -n 'prefix|sh' /tmp/outside.md",
            "rg --pre=sh 'prefix|sh' docs/ARCHITECTURE.md",
            "rg -n 'prefix|sh' docs/ARCHITECTURE.md; sh",
            "rg -n 'prefix|sh' docs/ARCHITECTURE.md\nsh",
            "env rg -n 'prefix|sh' docs/ARCHITECTURE.md",
            "bash -c \"rg -n 'prefix|sh' docs/ARCHITECTURE.md\"",
            "rg -n 'prefix|sh' $(echo docs/ARCHITECTURE.md)",
            "rg -n $'prefix|sh' docs/ARCHITECTURE.md",
            "rg -n 'prefix|sh' docs/@(ARCHITECTURE|SECURITY).md",
            "rg -n 'unterminated docs/ARCHITECTURE.md",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertFalse(merge_payload.literal_rg_inspection(command))
        # Decoding an ANSI-C quoted token must not create reader proof absent in the raw source.
        command = "rg -n $'prefix|sh' scripts/require-signed.sh"
        self.assertIsNotNone(merge_payload.find_merge(command))
        self.assertTrue(merge_payload.shell_executes_stdin("printf harmless | sh"))


if __name__ == "__main__":
    unittest.main()
