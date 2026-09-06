#!/usr/bin/env python3
"""Export canonical subagents from .codex/agents/*.toml for Antigravity / Gemini CLI."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[2]
AGENTS_DIR = ROOT / ".codex" / "agents"


def load_subagents() -> list[dict[str, object]]:
    subagents = []
    for toml_path in sorted(AGENTS_DIR.glob("*.toml")):
        data = tomllib.loads(toml_path.read_text(encoding="utf-8"))
        subagents.append({
            "name": data["name"],
            "description": data["description"],
            "system_prompt": data["developer_instructions"].strip(),
            "enable_write_tools": False,
            "enable_mcp_tools": False,
            "enable_subagent_tools": False,
        })
    return subagents


def main() -> int:
    subagents = load_subagents()
    if len(sys.argv) > 1 and sys.argv[1] == "--json":
        print(json.dumps(subagents, indent=2))
        return 0
    print(f"Loaded {len(subagents)} canonical subagent(s):")
    for agent in subagents:
        print(f" - {agent['name']}: {agent['description']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
