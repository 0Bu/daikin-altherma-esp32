#!/usr/bin/env python3
"""Separate source checks, generated registration, and bounded read-only Codex observations."""

from __future__ import annotations

import argparse
import errno
import json
import os
from pathlib import Path
import selectors
import shutil
import stat
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]


def git_metadata(root: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "-C", str(root), *arguments],
        text=True, capture_output=True, check=True, timeout=5,
    )
    if len(result.stdout) > 2 * 1024 * 1024:
        raise ValueError("Git metadata exceeded the bounded read")
    return result.stdout


def native_hook_source(root: Path) -> tuple[Path, bool]:
    """Resolve the primary worktree from Git metadata; never modify that checkout."""
    paths = git_metadata(root, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir").splitlines()
    if len(paths) != 2 or not all(Path(path).is_absolute() for path in paths):
        raise ValueError("Git directories were not exposed as absolute paths")
    git_dir, common_dir = (Path(path).resolve() for path in paths)
    linked = git_dir != common_dir
    primary = root.resolve()
    if linked:
        first = git_metadata(root, "worktree", "list", "--porcelain", "-z").split("\0\0", 1)[0].split("\0")
        if not first or not first[0].startswith("worktree ") or "bare" in first:
            raise ValueError("Git did not expose a primary checkout")
        primary = Path(first[0][len("worktree "):])
        if not primary.is_absolute():
            raise ValueError("Git primary checkout was not an absolute path")
        primary = primary.resolve()
        primary_paths = git_metadata(primary, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir").splitlines()
        if len(primary_paths) != 2 or any(Path(path).resolve() != common_dir for path in primary_paths):
            raise ValueError("Git primary checkout does not own the common directory")
        if Path(git_metadata(primary, "rev-parse", "--show-toplevel").strip()).resolve() != primary:
            raise ValueError("Git primary checkout root does not match")
    return primary / ".codex/hooks.json", linked


class SourceReadError(ValueError):
    def __init__(self, status: str):
        super().__init__(status)
        self.status = status


def read_regular_source(path: Path) -> bytes:
    """Bounded no-follow read of a regular source through its directory descriptor."""
    directory = None
    descriptor = None
    try:
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK)
        descriptor = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise SourceReadError("unsafe-path")
        with os.fdopen(descriptor, "rb") as source:
            descriptor = None
            actual = source.read(2 * 1024 * 1024 + 1)
        if len(actual) > 2 * 1024 * 1024:
            raise SourceReadError("oversized")
        return actual
    except FileNotFoundError as exc:
        raise SourceReadError("missing") from exc
    except OSError as exc:
        raise SourceReadError("unsafe-path" if exc.errno in {errno.ELOOP, errno.ENOTDIR} else "unreadable") from exc
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if directory is not None:
            os.close(directory)


def hook_adapter_status(path: Path, expected: bytes) -> str:
    """Compare only the expected adapter, without printing foreign file contents."""
    try:
        actual = read_regular_source(path)
        return "matches-worktree-generated-adapter" if actual == expected else "stale-or-foreign"
    except SourceReadError as exc:
        return exc.status


class ReadOnlyRpc:
    """No thread/turn creation, MCP calls, trust, or configuration writes."""

    def __init__(self, executable: str):
        self.process = subprocess.Popen(
            [executable, "app-server", "--listen", "stdio://"],
            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        self.buffer = b""
        self.serial = 0

    def send(self, value: dict) -> None:
        self.process.stdin.write((json.dumps({"jsonrpc": "2.0", **value}) + "\n").encode())
        self.process.stdin.flush()

    def request(self, method: str, params: dict) -> dict:
        if method not in {"initialize", "config/read", "hooks/list"}:
            raise ValueError("doctor permits only read-only metadata methods")
        self.serial += 1
        self.send({"id": self.serial, "method": method, "params": params})
        deadline = time.monotonic() + 12
        consumed = 0
        while time.monotonic() < deadline:
            while b"\n" in self.buffer:
                line, self.buffer = self.buffer.split(b"\n", 1)
                message = json.loads(line)
                if message.get("id") == self.serial:
                    if "error" in message:
                        code = message["error"].get("code")
                        raise ValueError(f"Codex rejected read-only method {method} (code {code if isinstance(code, int) else 'unknown'})")
                    return message.get("result", {})
            events = self.selector.select(max(0, deadline - time.monotonic()))
            if events:
                chunk = os.read(self.process.stdout.fileno(), 65536)
                if not chunk:
                    raise ValueError(f"Codex metadata process closed before responding (exit {self.process.poll()})")
                consumed += len(chunk)
                if consumed > 2 * 1024 * 1024:
                    raise ValueError("Codex metadata response exceeded the bounded read")
                self.buffer += chunk
        raise ValueError(f"Codex read-only method {method} timed out")

    def close(self) -> None:
        self.selector.close()
        self.process.terminate()
        try:
            self.process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=2)
        for stream in (self.process.stdin, self.process.stdout):
            stream.close()


def observe_runtime() -> bool:
    executable = shutil.which(os.environ.get("AGENT_CODEX", "codex"))
    if not executable:
        print("codex-doctor: effective runtime metadata unavailable (Codex executable not found)")
        return False
    rpc = None
    stage = "native hook source resolution"
    try:
        hook_source, linked = native_hook_source(ROOT)
        stage = "local generated hook adapter"
        expected_bytes = read_regular_source(ROOT / ".codex/hooks.json")
        stage = "local canonical MCP registration"
        expected_context = json.loads(read_regular_source(ROOT / ".mcp.json"))["mcpServers"]["context7"]
        adapter_status = hook_adapter_status(hook_source, expected_bytes)
        print(f"codex-doctor: native hook source {'primary checkout (linked worktree)' if linked else 'current checkout'}: {hook_source}")
        print(f"codex-doctor: native hook adapter {adapter_status}; no other checkout was modified")
        stage = "app-server startup"
        rpc = ReadOnlyRpc(executable)
        stage = "initialize"
        rpc.request("initialize", {
            "clientInfo": {"name": "daikin-codex-doctor", "version": "1"},
            "capabilities": {"experimentalApi": True},
        })
        rpc.send({"method": "initialized"})
        stage = "config/read"
        response = rpc.request("config/read", {"cwd": str(ROOT), "includeLayers": True})
        config = response.get("config", {})
        context = config.get("mcp_servers", {}).get("context7", {})
        pinned = all(context.get(key) == expected_context[key] for key in ("command", "args"))
        context_enabled = context.get("enabled", True) is True
        agents = config.get("agents", {})
        capped = agents.get("max_concurrent_threads_per_session") == 3
        agent_enabled_setting = agents.get("enabled")
        agents_enabled = agent_enabled_setting is True or agent_enabled_setting is None
        print(f"codex-doctor: effective Context7 registration {'matches pin' if pinned else 'missing or overridden'}; {'enabled' if context_enabled else 'disabled'}; server was not contacted")
        print(f"codex-doctor: effective three-subagent limit {'observed' if capped else 'not observed'}")
        print(f"codex-doctor: effective subagent tools {'enabled' if agents_enabled else 'disabled'}")
        layers = response.get("layers", []) or []
        project = [layer for layer in layers if layer.get("name", {}).get("type") == "project"
                   and layer.get("name", {}).get("dotCodexFolder") == str(ROOT / ".codex")]
        layer_active = bool(project) and all(not layer.get("disabledReason") for layer in project)
        print(f"codex-doctor: native project config layer {'active' if layer_active else 'not active or not exposed'} at current worktree")
        stage = "hooks/list"
        response = rpc.request("hooks/list", {"cwds": [str(ROOT)]})
        entries = [entry for entry in response.get("data", []) if entry.get("cwd") == str(ROOT)]
        discovered = [hook for entry in entries for hook in entry.get("hooks", [])]
        registered = [hook for hook in discovered if hook.get("source") == "project"
                      and hook.get("handlerType") == "command"
                      and hook.get("sourcePath") == str(hook_source)]
        expected = json.loads(expected_bytes)["hooks"]
        expected_count = sum(len(group["hooks"]) for groups in expected.values() for group in groups)
        project_count = sum(hook.get("source") == "project" for hook in discovered)
        user_count = sum(hook.get("source") == "user" for hook in discovered)
        errors_count = sum(len(entry.get("errors", [])) for entry in entries)
        warnings_count = sum(len(entry.get("warnings", [])) for entry in entries)
        print(f"codex-doctor: native hook discovery expected-project-source={len(registered)}/{expected_count}; "
              f"project={project_count}, user={user_count}, other={len(discovered) - project_count - user_count}; "
              f"errors={errors_count}, warnings={warnings_count}")
        foreign_count = project_count - len(registered)
        if foreign_count:
            print(f"codex-doctor: project handlers from foreign source or unsupported handler type={foreign_count}")
        events = {"PreToolUse": "preToolUse", "PostToolUse": "postToolUse", "Stop": "stop"}
        complete = True
        for event, groups in expected.items():
            for group in groups:
                for handler in group["hooks"]:
                    matches = [hook for hook in registered if hook.get("eventName") == events[event]
                               and hook.get("command") == handler["command"]
                               and hook.get("matcher") == group.get("matcher")
                               and hook.get("timeoutSec") == handler["timeout"]]
                    ready = len(matches) == 1 and matches[0].get("enabled") is True and matches[0].get("trustStatus") in {"trusted", "managed"}
                    trust = matches[0].get("trustStatus") if len(matches) == 1 else "not-observed"
                    if trust not in {"trusted", "managed", "untrusted", "modified", "not-observed"}:
                        trust = "unknown"
                    if not matches:
                        registration = "not-discovered" if not registered else "definition-mismatch"
                    elif len(matches) != 1:
                        registration = "ambiguous"
                    else:
                        registration = "ready" if ready else "pending"
                    print(f"codex-doctor: {event}/{handler['command'].rsplit(' ', 1)[-1]} registration {registration}; trust={trust}")
                    complete &= ready
        complete &= len(entries) == 1 and len(registered) == expected_count and project_count == expected_count and errors_count == 0
        return pinned and context_enabled and capped and agents_enabled and layer_active and adapter_status == "matches-worktree-generated-adapter" and complete
    except (OSError, ValueError, TypeError, AttributeError, subprocess.SubprocessError) as exc:
        # Do not dump config responses, arbitrary server error data, credentials or environment.
        print(f"codex-doctor: effective runtime observation unavailable at {stage} ({type(exc).__name__})")
        if isinstance(exc, ValueError) and str(exc).startswith(("Codex rejected read-only method ", "Codex metadata process closed ", "Codex read-only method ")):
            print(f"codex-doctor: {exc}")
        return False
    finally:
        if rpc:
            rpc.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", action="store_true", help="read effective config and hooks/list metadata without starting a task")
    parser.add_argument("--require-runtime", action="store_true", help="fail unless activation, dispatch and sandbox evidence are complete")
    args = parser.parse_args()
    if args.require_runtime and not args.runtime:
        parser.error("--require-runtime requires --runtime")
    result = subprocess.run([str(ROOT / "scripts/run-agent-instructions-budget.sh")], check=False)
    if result.returncode:
        return result.returncode
    print("codex-doctor: canonical sources and native generated registrations verified")
    git = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--git-path", "hooks/pre-push"], text=True, capture_output=True, check=False)
    hook_path = Path(git.stdout.strip()) if git.returncode == 0 else None
    if hook_path and not hook_path.is_absolute():
        hook_path = ROOT / hook_path
    native_hook = ROOT / ".githooks/pre-push"
    active = bool(hook_path and hook_path.resolve() == native_hook.resolve() and os.access(hook_path, os.X_OK))
    print(f"codex-doctor: effective Git pre-push {'uses executable project hook' if active else 'not activated; configure core.hooksPath manually'}")
    if args.runtime:
        ready = observe_runtime()
        print(f"codex-doctor: runtime registration/trust {'verified' if ready else 'incomplete'}")
    else:
        print("codex-doctor: effective Codex MCP and hook trust not observed; use --runtime for read-only metadata")
    print("codex-doctor: actual PreToolUse/PostToolUse/Stop dispatch and reviewer read-only sandbox require a fresh-task smoke check")
    print("codex-doctor: inspect /hooks in the Codex CLI and review current hashes manually; this tool never grants trust")
    if args.require_runtime:
        print("codex-doctor: full runtime acceptance pending fresh-task evidence", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
