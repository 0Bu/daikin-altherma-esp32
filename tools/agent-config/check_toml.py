#!/usr/bin/env python3
"""Parse and validate the project-local canonical agent TOML and MCP contract."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tomllib
from typing import Any


def fail(message: str, code: int = 1) -> None:
    print(f"agent-config: {message}", file=sys.stderr)
    raise SystemExit(code)


root = Path(os.environ.get("AGENT_CONFIG_ROOT") or Path(__file__).resolve().parents[2]).resolve()


def load_toml(relative: str) -> dict[str, Any]:
    path = root / relative
    try:
        source = path.read_bytes()
    except OSError as exc:
        fail(f"cannot read {relative}: {exc}", 2)
    try:
        parsed = tomllib.loads(source.decode("utf-8"))
    except (UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
        fail(f"{relative} is not valid TOML: {exc}", 2)
    if not isinstance(parsed, dict):
        fail(f"{relative} must contain a TOML table", 2)
    return parsed


def contains_model_key(value: Any) -> bool:
    if isinstance(value, dict):
        return any(key == "model" or contains_model_key(child) for key, child in value.items())
    if isinstance(value, list):
        return any(contains_model_key(child) for child in value)
    return False


mcp_path = root / ".mcp.json"
try:
    compatible_mcp = json.loads(mcp_path.read_text(encoding="utf-8"))
except OSError as exc:
    fail(f"cannot read .mcp.json: {exc}", 2)
except (UnicodeDecodeError, json.JSONDecodeError) as exc:
    fail(f".mcp.json is not valid JSON: {exc}", 2)
if not isinstance(compatible_mcp, dict) or set(compatible_mcp) != {"mcpServers"}:
    fail(".mcp.json must contain only mcpServers")
compatible_servers = compatible_mcp["mcpServers"]
if not isinstance(compatible_servers, dict) or set(compatible_servers) != {"context7"}:
    fail(".mcp.json must configure only Context7")
context7 = compatible_servers["context7"]
if not isinstance(context7, dict) or context7.get("command") != "npx":
    fail("Context7 MCP must use npx")
if context7.get("args") != ["-y", "@upstash/context7-mcp@4.0.2"]:
    fail("Context7 MCP must stay pinned to @upstash/context7-mcp@4.0.2")

agent_root = root / ".agents" / "agents"
try:
    agent_files = sorted(agent_root.glob("*.toml"))
except OSError as exc:
    fail(f"cannot enumerate .agents/agents: {exc}", 2)
expected_files = {
    "doc-drift-checker.toml",
    "heap-safety-reviewer.toml",
    "x10a-decode-reviewer.toml",
}
if {path.name for path in agent_files} != expected_files:
    fail(".agents/agents must contain exactly the three mapped project reviewers")

names: set[str] = set()
required_keys = {"name", "description", "sandbox_mode", "developer_instructions"}
for path in agent_files:
    relative = path.relative_to(root).as_posix()
    parsed = load_toml(relative)
    if contains_model_key(parsed):
        fail(f"{relative} must not pin a model")
    if set(parsed) != required_keys:
        fail(f"{relative} must contain exactly {', '.join(sorted(required_keys))}")
    expected_name = path.stem.replace("-", "_")
    if parsed.get("name") != expected_name:
        fail(f"{relative} name must be {expected_name}")
    if parsed.get("sandbox_mode") != "read-only":
        fail(f"{relative} sandbox_mode must be read-only")
    for key in ("description", "developer_instructions"):
        if not isinstance(parsed.get(key), str) or not parsed[key].strip():
            fail(f"{relative} needs a non-empty {key}")
    if parsed["name"] in names:
        fail(f"duplicate subagent name: {parsed['name']}")
    names.add(parsed["name"])

print(f"agent-config: parsed canonical config and {len(agent_files)} read-only subagents")
