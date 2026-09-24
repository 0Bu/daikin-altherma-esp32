#!/usr/bin/env python3
"""Validate the canonical agent hook dispatch contract."""

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


def command_hook(group: Any, *, matcher: str, command: str, timeout: int | None) -> None:
    if not isinstance(group, dict):
        fail("hook group must be an object")
    if set(group) != {"matcher", "hooks"}:
        fail(f"hook group keys drifted for matcher {matcher!r}")
    if group.get("matcher") != matcher:
        fail(f"hook matcher drifted; expected {matcher!r}")
    hooks = group.get("hooks")
    if not isinstance(hooks, list) or len(hooks) != 1 or not isinstance(hooks[0], dict):
        fail(f"hook group {matcher!r} must contain exactly one command hook")
    hook = hooks[0]
    expected_hook_keys = {"type", "command"}
    if timeout is not None:
        expected_hook_keys.add("timeout")
    if not set(hook).issuperset(expected_hook_keys) or not set(hook).issubset(expected_hook_keys | {"statusMessage"}):
        fail(f"hook command keys drifted for matcher {matcher!r}; blocking hooks must not be async")
    if hook.get("type") != "command" or hook.get("command") != command:
        fail(f"hook command drifted for matcher {matcher!r}")
    if timeout is not None and hook.get("timeout") != timeout:
        fail(f"hook timeout drifted for matcher {matcher!r}")


hooks_doc = load_json(".agents/hooks.json")
if set(hooks_doc) != {"safety-guards"} or not isinstance(hooks_doc.get("safety-guards"), dict):
    fail(".agents/hooks.json needs a safety-guards object")

guards = hooks_doc["safety-guards"]
expected_events = {"PreToolUse", "PostToolUse", "Stop"}
if set(guards) != expected_events:
    fail(".agents/hooks.json event set drifted")
if any(not isinstance(guards[event], list) for event in expected_events):
    fail(".agents/hooks.json event groups must be arrays")
if len(guards["PreToolUse"]) != 2 or len(guards["PostToolUse"]) != 1 or len(guards["Stop"]) != 1:
    fail("canonical hook dispatch count drifted")

git_root = "$(git rev-parse --show-toplevel)"
pre_tool_matcher = (
    "run_command|view_file|replace_file_content|write_to_file|Bash|Read|Edit|Write|apply_patch|exec_command|shell|shell_command"
)
pr_gates_matcher = (
    "run_command|Bash|exec_command|shell|shell_command|mcp__.+(?:merge_pull_request|enable_auto_merge|enable_pull_request_auto_merge|enqueue_pull_request)"
)
format_matcher = "replace_file_content|write_to_file|Edit|Write|apply_patch"

command_hook(
    guards["PreToolUse"][0],
    matcher=pre_tool_matcher,
    command=f'python3 "{git_root}/tools/agent-hooks/agent_hook.py" pre-tool-guards',
    timeout=10,
)
command_hook(
    guards["PreToolUse"][1],
    matcher=pr_gates_matcher,
    command=f'python3 "{git_root}/tools/agent-hooks/agent_hook.py" pr-gates',
    timeout=600,
)
command_hook(
    guards["PostToolUse"][0],
    matcher=format_matcher,
    command=f'python3 "{git_root}/tools/agent-hooks/agent_hook.py" format',
    timeout=30,
)

# Stop is a flat handler list in .agents/hooks.json
stop_hook = guards["Stop"][0]
if not isinstance(stop_hook, dict):
    fail("Stop hook must be an object")
stop_expected_keys = {"type", "command", "timeout"}
if not set(stop_hook).issuperset(stop_expected_keys) or not set(stop_hook).issubset(stop_expected_keys | {"statusMessage"}):
    fail("Stop hook command keys drifted")
if stop_hook.get("type") != "command" or stop_hook.get("command") != f'python3 "{git_root}/tools/agent-hooks/agent_hook.py" stop-logic-tests':
    fail("Stop hook command drifted")
if stop_hook.get("timeout") != 600:
    fail("Stop hook timeout drifted")

print("agent-hooks-config: canonical agent hook dispatch clean")
