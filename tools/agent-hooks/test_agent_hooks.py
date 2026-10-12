#!/usr/bin/env python3
"""Fast in-process unit tests for agent_hook guards and Antigravity normalization."""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
import shlex
import sys
import tempfile
import unittest
import subprocess
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/agent-hooks"))

import agent_hook
import merge_payload


class AgentHookFastTests(unittest.TestCase):
    def test_literal_pr_create_title_is_data_and_transport_checks_remain(self):
        for title in ("Modernize agent workflows and pre-push audits", "Document git push and cd checks",
                      "Explain gh pr merge and mergePullRequest", "User's git push guidance"):
            command = ("scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 "
                       "pr create --head agent/example --base main --title " + shlex.quote(title) +
                       " --body-file /private/tmp/body.md")
            payload = {"cwd": str(ROOT), "tool_name": "exec_command", "tool_input": {"cmd": command}}
            with self.subTest(title=title), patch("sys.stdin", io.StringIO(json.dumps(payload))), \
                    patch("sys.stdout", new_callable=io.StringIO) as output:
                self.assertEqual(merge_payload.main(), 0)
                fields = output.getvalue().split("\0")
                self.assertEqual(fields[0], "gh pr create")
                self.assertEqual(fields[5], "")
            self.assertEqual(self.run_pre_tool(payload), (0, ""))
            for prefix, suffix in (("env ", ""), ("cd /tmp; ", ""), ("", "; gh api user"),
                                   ("", " > /tmp/result")):
                candidate = prefix + command + suffix
                self.assertIsNone(merge_payload.literal_pr_create_form(candidate))
                rc, out = self.run_pre_tool({"cwd": str(ROOT), "tool_name": "exec_command",
                                             "tool_input": {"cmd": candidate}})
                self.assertEqual(rc, 0)
                self.assertEqual(json.loads(out)["hookSpecificOutput"]["permissionDecision"], "deny")
            self.assertIsNone(merge_payload.literal_pr_create_form(command + " --fill"))
            for title in ("X;echo", "X|sh", "X&echo", "X{a,b}", "X*", "X?", "X[ab]", ";", "~", "#"):
                candidate = command.replace(shlex.quote(shlex.split(command)[10]), title)
                self.assertIsNone(merge_payload.literal_pr_create_form(candidate))
                with patch("sys.stdin", io.StringIO(json.dumps({**payload, "tool_input": {"cmd": candidate}}))), \
                        patch("sys.stdout", new_callable=io.StringIO) as output:
                    self.assertEqual(merge_payload.main(), 0)
                    self.assertTrue(output.getvalue().split("\0")[5])
            with patch("sys.stdin", io.StringIO(json.dumps({**payload, "cwd": "/tmp"}))), \
                    patch("sys.stdout", new_callable=io.StringIO) as output:
                self.assertEqual(merge_payload.main(), 0)
                self.assertIn("not the canonical repository script", output.getvalue())

    def test_runner_aliases_keep_identical_pr_action_and_lease(self):
        command = ("scripts/gh-with-git-credentials.sh api --hostname github.com --method PUT "
                   "repos/0Bu/daikin-altherma-esp32/pulls/123/merge "
                   "-f sha=" + "a" * 40 + " -f merge_method=squash")
        actions = [command, "scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 "
                   "pr create --head agent/example --base main --title Example --body-file /private/tmp/body.md"]
        for command in actions:
            outputs = []
            for tool in ["Bash", "exec_command", "functions.exec_command", "functions::exec_command"]:
                payload = {"cwd": str(ROOT), "tool_name": tool, "tool_input": {"cmd": command}}
                with patch("sys.stdin", io.StringIO(json.dumps(payload))), patch("sys.stdout", new_callable=io.StringIO) as output:
                    self.assertEqual(merge_payload.main(), 0)
                    outputs.append(output.getvalue())
            self.assertTrue(outputs[0].startswith("gh "))
            self.assertEqual(outputs, [outputs[0]] * len(outputs))

    def test_dotted_mcp_identity_keeps_activation_block(self):
        identity = "mcp__github.server__merge_pull_request"
        for prefix in ("", "functions.", "functions::"):
            with self.subTest(prefix=prefix):
                tool = prefix + identity
                self.assertEqual(agent_hook.normalized_tool(tool), identity)
                with patch("sys.stdin", io.StringIO(json.dumps({"tool_name": tool, "tool_input": {}}))), \
                        patch("sys.stdout", new_callable=io.StringIO) as output:
                    self.assertEqual(merge_payload.main(), 0)
                    self.assertTrue(output.getvalue().split("\0")[0])

    def test_antigravity_stop_reminder_does_not_force_continuation(self):
        with patch("sys.stdin", io.StringIO('{"executionNum":1}')), \
                patch("sys.stdout", new_callable=io.StringIO) as output, \
                patch("sys.stderr", new_callable=io.StringIO) as diagnostics, \
                patch.object(agent_hook.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=" M main/example.cpp")):
            self.assertEqual(agent_hook.run_stop_logic_tests(unittest.mock.MagicMock()), 0)
            self.assertEqual(output.getvalue(), "")
            self.assertIn("does not run builds", diagnostics.getvalue())

    def test_stop_never_builds_or_blocks_for_foreign_dirty_state(self):
        for state in ["", " M main/logic/example.hpp", "M  test/test_logic.cpp", "?? main/example.cpp"]:
            for mode in ["default", "plan"]:
                with self.subTest(state=state, mode=mode), \
                        patch("sys.stdin", io.StringIO(json.dumps({"permission_mode": mode}))), \
                        patch("sys.stdout", new_callable=io.StringIO) as output, \
                        patch.object(agent_hook.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=state)) as run:
                    self.assertEqual(agent_hook.run_stop_logic_tests(unittest.mock.MagicMock()), 0)
                    self.assertEqual(run.call_count, 1)
                    self.assertEqual(run.call_args.args[0][0], "git")
                    self.assertIn("--no-optional-locks", run.call_args.args[0])
                    if state:
                        self.assertIn("does not run builds", json.loads(output.getvalue())["systemMessage"])
                        self.assertNotIn("decision", json.loads(output.getvalue()))
                    else:
                        self.assertEqual(output.getvalue(), "")

    def test_stop_git_failure_is_a_bounded_advisory(self):
        with patch("sys.stdin", io.StringIO("{}")), patch("sys.stdout", new_callable=io.StringIO) as output, \
                patch.object(agent_hook.subprocess, "run", side_effect=OSError("unavailable")):
            self.assertEqual(agent_hook.run_stop_logic_tests(unittest.mock.MagicMock()), 0)
            self.assertLess(len(output.getvalue()), 512)
            self.assertNotIn("block", output.getvalue())

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
            "rg -n 'credential|wrapper' scripts/gh-with-git-credentials.sh",
            "rg -n '(schema|protocol|HookRun|Notification|app-server).*(json|ts)$' tools",
            "rg -n 'mergePullRequest|$literal' tools/agent-hooks/merge_payload.py",
            "pgrep -f production-ota-gate.py",
            "pgrep -f 'production-ota-gate.py'",
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
            "env rg -n 'wrapper' scripts/gh-with-git-credentials.sh",
            "rg --pre=sh 'wrapper' scripts/gh-with-git-credentials.sh",
            "rg -n 'wrapper' scripts/gh-with-git-credentials.sh; sh",
            "rg -n 'wrapper' scripts/gh-with-git-credentials.sh > /tmp/output",
            "rg -n 'wrapper' scripts/gh-with-git-credentials.sh ota_signing_key.pem",
            "rg -n 'wrapper' scripts/gh-with-git-credentials.sh .git-credentials",
            "rg -n 'wrapper' ../scripts/gh-with-git-credentials.sh",
            "pgrep -af production-ota-gate.py",
            "pgrep -lf production-ota-gate.py",
            "pgrep -f production-ota-gate.py; sh",
            "pgrep -f production-ota-gate.py | sh",
            "pgrep -f production-ota-gate.py > /tmp/output",
            "env pgrep -f production-ota-gate.py",
            "pgrep -f $GATE_NAME-production-ota-gate.py",
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
            r"bash -O extglob -c $'rm partitions.c\x40(sv)'",
            r"bash -O extglob -c 'rm partitions.c'$'\x40''(sv)'",
            r"bash -O extglob -c $'cat /tmp/\x40(ordinary|private).pem'",
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

    def test_source_reader_exception_keeps_wrapper_execution_cwd_bound(self):
        payload = {
            "cwd": "/tmp",
            "tool_name": "exec_command",
            "tool_input": {"cmd": "scripts/gh-with-git-credentials.sh repo view"},
        }
        rc, out = self.run_pre_tool(payload)
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out)["hookSpecificOutput"]["permissionDecision"], "deny")

    def ruleset_command(self, path: Path) -> str:
        return ("gh api --hostname github.com --method PUT "
                "repos/0Bu/daikin-altherma-esp32/rulesets/20876393 --input " + shlex.quote(str(path)))

    def test_native_ruleset_update_reaches_both_hooks_without_merge_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / "public-ruleset.json"
            path.write_text('{}', encoding="utf-8")
            commands = [self.ruleset_command(path),
                        "gh api --input " + shlex.quote(str(path)) +
                        " repos/0Bu/daikin-altherma-esp32/rulesets/20876393 --method PUT --hostname github.com",
                        self.ruleset_command(path).replace(" --method", " \\\n  --method")]
            for command in commands:
                action = merge_payload.find_merge(command)
                self.assertEqual(action["action"], "gh api ruleset update")
                self.assertEqual(action["error"], "")
                for tool in ("Bash", "exec_command", "functions.exec_command", "functions::exec_command"):
                    with self.subTest(tool=tool, command=command):
                        payload = {"cwd": str(ROOT), "tool_name": tool, "tool_input": {"cmd": command}}
                        with patch.object(agent_hook.subprocess, "run", side_effect=AssertionError("no child execution")):
                            rc, out = self.run_pre_tool(payload)
                        self.assertEqual((rc, out), (0, ""))
                        result = subprocess.run([str(ROOT / "tools/agent-hooks/require-pr-gates.sh")],
                                                input=json.dumps(payload), text=True, capture_output=True)
                        self.assertEqual(result.returncode, 0, result.stderr)
                payload = {"cwd": str(ROOT), "toolCall": {"name": "run_command", "args": {"CommandLine": command}}}
                rc, out = self.run_pre_tool(payload)
                self.assertEqual((rc, json.loads(out)["decision"]), (0, "allow"))
                result = subprocess.run([str(ROOT / "tools/agent-hooks/require-pr-gates.sh")],
                                        input=json.dumps(payload), text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)["decision"], "allow")

    def test_native_ruleset_update_keeps_transport_and_merge_boundaries(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / "public-ruleset.json"
            path.write_text('{}', encoding="utf-8")
            command = self.ruleset_command(path)
            commands = [
                command.replace("--method PUT", "--method DELETE"),
                command.replace("--method PUT", "--method POST"),
                command + " --method GET",
                command + " --hostname github.com",
                command.replace("github.com", "ghe.example"),
                command.replace("--hostname github.com ", ""),
                command.replace("--input " + shlex.quote(str(path)), "--input -"),
                command + " -F field=@" + str(path),
                command + " -H 'Authorization: synthetic-value'",
                command + " --jq '.'",
                command + " --input " + str(path),
                command.replace("/rulesets/20876393", "/rulesets/20876393?unreviewed=1"),
                command.replace("/rulesets/20876393", "/rulesets/%32%30%38%37%36%33%39%33"),
                command.replace("repos/0Bu", "https://api.github.com/repos/0Bu"),
                command.replace("/rulesets/20876393", "/git/refs/heads/main"),
                command.replace("/rulesets/20876393", "/contents/file.json"),
                command.replace("/rulesets/20876393", "/merges"),
                command.replace("/rulesets/20876393", "/releases/123"),
                command.replace("/rulesets/20876393", "/actions/workflows/build.yml/dispatches"),
                command.replace("/rulesets/20876393", "/pulls/123/merge"),
                command.replace("/rulesets/20876393", "/pulls/123/merge-async"),
                command.replace("/rulesets/20876393", "/rulesets/$RULESET"),
                "env " + command,
                "command " + command,
                "PATH=/tmp " + command,
                "c=gh; " + command.replace("gh api", "$c api"),
                "bash -c " + shlex.quote(command),
                command + "; gh api user",
                "gh api user; " + command,
                command + "\ngh api user",
                command + " > /tmp/ruleset-output.json",
            ]
            for candidate in commands:
                with self.subTest(command=candidate):
                    rc, out = self.run_pre_tool({"cwd": str(ROOT), "tool_name": "exec_command",
                                                 "tool_input": {"cmd": candidate}})
                    self.assertEqual(rc, 0)
                    self.assertEqual(json.loads(out)["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_native_ruleset_update_rejects_unsafe_input_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            path = root / "public-ruleset.json"
            path.write_text('{}', encoding="utf-8")
            link = root / "link.json"
            link.symlink_to(path)
            parent_link = root / "linked-directory"
            parent_link.symlink_to(root, target_is_directory=True)
            hardlink = root / "hardlink.json"
            os.link(path, hardlink)
            writable = root / "writable.json"
            writable.write_text('{}', encoding="utf-8")
            writable.chmod(0o666)
            empty = root / "empty.json"
            empty.touch()
            large = root / "large.json"
            large.write_bytes(b' ' * (1024 * 1024 + 1))
            pipe = root / "pipe.json"
            os.mkfifo(pipe)
            paths = [link, parent_link / path.name, hardlink, path, writable, empty, large, pipe,
                     root / "missing.json", Path("relative.json"), root / ".." / "ruleset.json",
                     root / "private.pem", root]
            for candidate in paths:
                with self.subTest(path=candidate):
                    action = merge_payload.find_merge(self.ruleset_command(candidate))
                    self.assertTrue(action["error"])
            os.unlink(hardlink)
            with patch.object(merge_payload.os, "getuid", return_value=path.stat().st_uid + 1):
                self.assertIn("owned by the current user", merge_payload.find_merge(self.ruleset_command(path))["error"])
            sensitive = root / "credentials.json"
            sensitive.write_text('{}', encoding="utf-8")
            rc, out = self.run_pre_tool({"cwd": str(ROOT), "tool_name": "exec_command",
                                         "tool_input": {"cmd": self.ruleset_command(sensitive)}})
            self.assertEqual(rc, 0)
            self.assertEqual(json.loads(out)["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_native_ruleset_update_aggregate_binds_origin_and_execution_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            path = root / "public-ruleset.json"
            path.write_text('{}', encoding="utf-8")
            command = self.ruleset_command(path)
            payloads = [
                {"cwd": str(ROOT), "tool_name": "exec_command", "tool_input": {
                    "cmd": command.replace("repos/0Bu/", "repos/other/")}},
                {"cwd": str(root), "tool_name": "exec_command", "tool_input": {"cmd": command}},
                {"cwd": str(ROOT), "tool_name": "exec_command", "tool_input": {
                    "cmd": command, "workdir": str(root)}},
                {"tool_name": "exec_command", "tool_input": {"cmd": command}},
                {"cwd": str(ROOT), "tool_name": "exec_command", "tool_input": {
                    "cmd": command, "workdir": str(ROOT), "cwd": str(root)}},
            ]
            for payload in payloads:
                with self.subTest(payload=payload):
                    result = subprocess.run([str(ROOT / "tools/agent-hooks/require-pr-gates.sh")],
                                            input=json.dumps(payload), text=True, capture_output=True)
                    self.assertEqual(result.returncode, 2, result.stderr)
                    self.assertIn("BLOCKED", result.stderr)


if __name__ == "__main__":
    unittest.main()
