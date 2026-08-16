#!/usr/bin/env python3
"""Validate actual Codex hook dispatch and every retained Claude compatibility adapter."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
from typing import Any


def fail(message: str, code: int = 1) -> None:
    print(f"agent-hooks-config: {message}", file=sys.stderr)
    raise SystemExit(code)


root = Path(os.environ.get("AGENT_CONFIG_ROOT") or Path(__file__).resolve().parents[2]).resolve()


def load_json(relative: str) -> dict[str, Any]:
    try:
        value = json.loads((root / relative).read_text(encoding="utf-8"))
    except OSError as exc:
        fail(f"cannot read {relative}: {exc}", 2)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail(f"{relative} is not valid JSON: {exc}", 2)
    if not isinstance(value, dict):
        fail(f"{relative} must contain a JSON object", 2)
    return value


def command_hook(group: Any, *, matcher: str | None, command: str, timeout: int | None) -> None:
    if not isinstance(group, dict):
        fail("hook group must be an object")
    expected_group_keys = {"hooks"} if matcher is None else {"matcher", "hooks"}
    if set(group) != expected_group_keys:
        fail(f"hook group keys drifted for matcher {matcher!r}")
    if group.get("matcher") != matcher:
        fail(f"hook matcher drifted; expected {matcher!r}")
    hooks = group.get("hooks")
    if not isinstance(hooks, list) or len(hooks) != 1 or not isinstance(hooks[0], dict):
        fail(f"hook group {matcher!r} must contain exactly one command hook")
    hook = hooks[0]
    expected_hook_keys = {"type", "command", "statusMessage"}
    if timeout is not None:
        expected_hook_keys.add("timeout")
    if set(hook) != expected_hook_keys:
        fail(f"hook command keys drifted for matcher {matcher!r}; blocking hooks must not be async")
    if hook.get("type") != "command" or hook.get("command") != command:
        fail(f"hook command drifted for matcher {matcher!r}")
    if timeout is not None and hook.get("timeout") != timeout:
        fail(f"hook timeout drifted for matcher {matcher!r}")


codex = load_json(".codex/hooks.json")
if set(codex) != {"description", "hooks"} or not isinstance(codex.get("description"), str):
    fail(".codex/hooks.json needs only a non-empty description and hooks")
codex_hooks = codex["hooks"]
expected_events = {
    "SessionStart",
    "SubagentStart",
    "UserPromptSubmit",
    "Stop",
    "PreToolUse",
    "PostToolUse",
}
if not isinstance(codex_hooks, dict) or set(codex_hooks) != expected_events:
    fail(".codex/hooks.json event set drifted")
if any(not isinstance(codex_hooks[event], list) for event in expected_events):
    fail(".codex/hooks.json event groups must be arrays")
if any(len(codex_hooks[event]) != 1 for event in ("SessionStart", "SubagentStart", "UserPromptSubmit", "Stop")):
    fail("Codex lifecycle/start events must each have one hook group")
if len(codex_hooks["PreToolUse"]) != 2 or len(codex_hooks["PostToolUse"]) != 1:
    fail("Codex guard/PR/format dispatch count drifted")

git_root = "$(git rev-parse --show-toplevel)"
command_hook(
    codex_hooks["SessionStart"][0],
    matcher="^(?:startup|resume|clear|compact)$",
    command=f'python3 "{git_root}/tools/agent-hooks/agent_hook.py" capabilities',
    timeout=15,
)
command_hook(
    codex_hooks["SubagentStart"][0],
    matcher=None,
    command=f'python3 "{git_root}/tools/agent-hooks/agent_hook.py" subagent-context',
    timeout=10,
)
command_hook(
    codex_hooks["UserPromptSubmit"][0],
    matcher=None,
    command=f'python3 "{git_root}/tools/agent-hooks/agent_hook.py" prompt-context',
    timeout=10,
)
command_hook(
    codex_hooks["Stop"][0],
    matcher=None,
    command=f'python3 "{git_root}/tools/agent-hooks/agent_hook.py" stop-logic-tests',
    timeout=600,
)
command_hook(
    codex_hooks["PreToolUse"][0],
    matcher="^(?:Read|Edit|Write|Bash|apply_patch|exec_command|shell|shell_command)$",
    command=f'python3 "{git_root}/tools/agent-hooks/agent_hook.py" pre-tool-guards --runner codex',
    timeout=10,
)
command_hook(
    codex_hooks["PreToolUse"][1],
    matcher="^(?:Bash|exec_command|shell|shell_command|mcp__.+(?:merge_pull_request|enable_auto_merge|enable_pull_request_auto_merge|enqueue_pull_request))$",
    command=f'bash "{git_root}/tools/agent-hooks/require-pr-gates.sh"',
    timeout=600,
)
command_hook(
    codex_hooks["PostToolUse"][0],
    matcher="^(?:Edit|Write|apply_patch)$",
    command=f'python3 "{git_root}/tools/agent-hooks/agent_hook.py" format',
    timeout=30,
)

claude = load_json(".claude/settings.json")
claude_hooks = claude.get("hooks")
expected_claude_events = {"PreToolUse", "SessionStart", "PostToolUse", "Stop", "UserPromptSubmit"}
if not isinstance(claude_hooks, dict) or set(claude_hooks) != expected_claude_events:
    fail(".claude/settings.json hook event set drifted")
claude_root = "${CLAUDE_PROJECT_DIR:-.}"
expected_claude = {
    "PreToolUse": [
        ("^(?:Read|Edit|Write|Bash)$", f'bash "{claude_root}/.claude/hooks/guard-secrets.sh"'),
        ("^(?:Bash|mcp__.+(?:merge_pull_request|enable_auto_merge|enable_pull_request_auto_merge|enqueue_pull_request))$", f'bash "{claude_root}/.claude/hooks/require-project-review.sh"'),
    ],
    "SessionStart": [(None, f'bash "{claude_root}/.claude/hooks/report-capabilities.sh"')],
    "PostToolUse": [("^(?:Edit|Write)$", f'bash "{claude_root}/.claude/hooks/clang-format-edit.sh"')],
    "Stop": [(None, f'bash "{claude_root}/.claude/hooks/run-logic-tests.sh"')],
    "UserPromptSubmit": [(None, f'bash "{claude_root}/.claude/hooks/crash-triage-context.sh"')],
}
for event, expected_groups in expected_claude.items():
    groups = claude_hooks[event]
    if not isinstance(groups, list) or len(groups) != len(expected_groups):
        fail(f".claude/settings.json {event} dispatch count drifted")
    for group, (matcher, command) in zip(groups, expected_groups, strict=True):
        command_hook(group, matcher=matcher, command=command, timeout=None)

adapter_root = 'root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"'
aggregate = 'exec "$root/tools/agent-hooks/require-pr-gates.sh" --project-dir "$root"'
adapter_contracts = {
    ".claude/hooks/clang-format-edit.sh": [
        "set -u",
        adapter_root,
        'exec python3 "$root/tools/agent-hooks/agent_hook.py" format',
    ],
    ".claude/hooks/crash-triage-context.sh": [
        "set -u",
        adapter_root,
        'exec python3 "$root/tools/agent-hooks/agent_hook.py" prompt-context',
    ],
    ".claude/hooks/guard-partitions.sh": [
        "set -u",
        adapter_root,
        'exec python3 "$root/tools/agent-hooks/agent_hook.py" pre-tool-guards --runner claude',
    ],
    ".claude/hooks/guard-secrets.sh": [
        "set -u",
        adapter_root,
        'exec python3 "$root/tools/agent-hooks/agent_hook.py" pre-tool-guards --runner claude',
    ],
    ".claude/hooks/pr-gate-lib.sh": [
        adapter_root,
        '. "$root/tools/agent-hooks/pr-gate-lib.sh"',
    ],
    ".claude/hooks/report-capabilities.sh": [
        "set -u",
        adapter_root,
        'exec python3 "$root/tools/agent-hooks/agent_hook.py" capabilities',
    ],
    ".claude/hooks/run-logic-tests.sh": [
        "set -u",
        adapter_root,
        'exec python3 "$root/tools/agent-hooks/agent_hook.py" stop-logic-tests',
    ],
    **{
        f".claude/hooks/{name}.sh": ["set -u", adapter_root, aggregate]
        for name in (
            "require-absence-review",
            "require-domain-review",
            "require-feature-docs",
            "require-project-review",
            "require-schematic-review",
            "require-ui-gif",
            "require-ui-use-case-review",
        )
    },
}
for relative, expected_lines in adapter_contracts.items():
    path = root / relative
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as exc:
        fail(f"cannot read adapter {relative}: {exc}", 2)
    if not source.startswith("#!/usr/bin/env bash\n"):
        fail(f"compatibility adapter needs an executable bash shebang: {relative}")
    active_lines = [
        line.strip()
        for line in source.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    if active_lines != expected_lines:
        fail(f"thin compatibility adapter drifted: {relative}")
    if not os.access(path, os.X_OK):
        fail(f"compatibility adapter is not executable: {relative}")

print(f"agent-hooks-config: Codex/Claude dispatch and {len(adapter_contracts)} adapters clean")
