#!/usr/bin/env python3
"""Canonical project hooks for Codex.

Hook payloads are read from stdin. Payload-sensitive guards inspect `cwd`,
`tool_name`, and `tool_input`; repository-scoped lifecycle, context, and
formatting actions stay anchored to the versioned hook core's own worktree.
"""

from __future__ import annotations

import argparse
import filecmp
import fnmatch
import json
import os
from pathlib import Path
import posixpath
import re
import shlex
import shutil
import subprocess
import sys
from typing import Any, Iterable
from urllib.parse import unquote

from merge_payload import find_merge as classify_github_action


FILE_TOOLS = {"read", "edit", "write"}
PATCH_TOOLS = {"apply_patch"}
SHELL_TOOLS = {"bash", "exec_command", "shell", "shell_command"}
HOOK_ROOT = Path(__file__).resolve().parents[2]


def normalized_tool(value: object) -> str:
    tool = str(value or "").strip()
    for separator in (".", "::"):
        if separator in tool:
            tool = tool.rsplit(separator, 1)[-1]
    return tool.lower()


def read_payload(*, fail_closed: bool) -> tuple[dict[str, Any] | None, str | None]:
    raw = sys.stdin.read()
    if not raw.strip():
        return (None, "hook payload is empty") if fail_closed else ({}, None)
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError) as exc:
        return (None, f"hook payload is not valid JSON: {exc}") if fail_closed else ({}, None)
    if not isinstance(payload, dict):
        return (None, "hook payload must be a JSON object") if fail_closed else ({}, None)
    return payload, None


def tool_input(payload: dict[str, Any]) -> dict[str, Any]:
    value = payload.get("tool_input", {})
    return value if isinstance(value, dict) else {"command": value if isinstance(value, str) else ""}


def command_from(payload: dict[str, Any]) -> str:
    ti = tool_input(payload)
    values: list[str] = []
    for key in ("command", "cmd", "patch"):
        value = ti.get(key)
        if isinstance(value, str) and value:
            values.append(value)
    distinct = list(dict.fromkeys(values))
    return distinct[0] if len(distinct) == 1 else ""


def payload_cwd(payload: dict[str, Any]) -> Path:
    value = payload.get("cwd")
    if not isinstance(value, str) or not value:
        value = os.environ.get("AGENT_PROJECT_DIR") or os.environ.get("PROJECT_DIR") or os.getcwd()
    return Path(value).expanduser().resolve(strict=False)


def effective_shell_cwd(payload: dict[str, Any]) -> tuple[Path | None, str | None]:
    raw_cwd = payload.get("cwd")
    if not isinstance(raw_cwd, str) or not raw_cwd.strip():
        return None, "shell GitHub action payload has no execution cwd"
    values = [
        str(tool_input(payload)[key])
        for key in ("workdir", "cwd")
        if tool_input(payload).get(key) not in (None, "")
    ]
    distinct = list(dict.fromkeys(values))
    if len(distinct) > 1:
        return None, "conflicting workdir/cwd fields in GitHub action payload"
    cwd = Path(raw_cwd).expanduser()
    if distinct:
        workdir = Path(distinct[0]).expanduser()
        cwd = workdir if workdir.is_absolute() else cwd / workdir
    return cwd.resolve(strict=False), None


def project_root(payload: dict[str, Any]) -> Path:
    cwd = payload_cwd(payload)
    probe = cwd if cwd.is_dir() else cwd.parent
    try:
        found = subprocess.run(
            ["git", "-C", str(probe), "rev-parse", "--show-toplevel"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout.strip()
        if found:
            return Path(found).resolve(strict=False)
    except (FileNotFoundError, subprocess.SubprocessError):
        pass
    for candidate in (probe, *probe.parents):
        if (candidate / ".git").exists():
            return candidate
    return probe


def path_targets(payload: dict[str, Any]) -> list[str]:
    ti = tool_input(payload)
    values: list[str] = []
    for key in ("file_path", "path"):
        value = ti.get(key)
        if isinstance(value, str) and value:
            values.append(value)
    files = ti.get("files")
    if isinstance(files, list):
        values.extend(str(item) for item in files if isinstance(item, str) and item)
    return values


def patch_targets(patch: str) -> list[str]:
    targets: list[str] = []
    patterns = (
        r"^\*\*\* (?:Add|Update|Delete) File:\s*(.+?)\s*$",
        r"^\*\*\* Move to:\s*(.+?)\s*$",
        r"^\+\+\+\s+(?:b/)?(.+?)\s*$",
    )
    for line in patch.splitlines():
        for pattern in patterns:
            match = re.match(pattern, line)
            if match:
                target = match.group(1)
                if target != "/dev/null":
                    targets.append(target)
                break
    return targets


def basename(path: str) -> str:
    return path.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1].lower()


def is_sensitive_path(path: str) -> bool:
    normalized = path.strip().strip("'\"").replace("\\", "/").lower()
    base = basename(normalized)
    if not normalized:
        return False
    if base.endswith((".pem", ".key", ".p12", ".pfx", ".jks", ".keystore")):
        return True
    if base in {
        ".git-credentials",
        ".netrc",
        ".npmrc",
        ".pypirc",
        "credentials",
        "credentials.json",
        "secrets.env",
        "sdkconfig.local",
        "ota_signing_key.pem",
        "id_rsa",
        "id_dsa",
        "id_ecdsa",
        "id_ed25519",
        "id_ed25519_sk",
        "private_key",
        "credentials.yml",
        "credentials.yaml",
    }:
        return True
    if base.startswith("id_") and not base.endswith(".pub"):
        return True
    if base == ".env" or (base.startswith(".env.") and base not in {".env.example", ".env.sample", ".env.template"}):
        return True
    if "/.aws/credentials" in normalized or normalized.endswith(".aws/credentials"):
        return True
    if "/.config/gh/hosts.yml" in normalized or normalized.endswith(".config/gh/hosts.yml"):
        return True
    if "/.docker/config.json" in normalized or normalized.endswith(".docker/config.json"):
        return True
    if "/.gem/credentials" in normalized or normalized.endswith(".gem/credentials"):
        return True
    if "/.kube/config" in normalized or normalized.endswith(".kube/config"):
        return True
    if "/.ssh/" in normalized and not base.endswith(".pub") and base not in {"config", "known_hosts", "authorized_keys"}:
        return base.startswith("id_") or "private" in base
    return False


SENSITIVE_COMMAND_PATTERNS = (
    r"(?:^|[\s'\"=:/])(?:[^\s'\"]*/)?[^\s'\"]*\.(?:pem|key|p12|pfx|jks|keystore)(?:[\s'\";&|<>]|$)",
    r"(?:^|[\s'\"=/])(?:\.git-credentials|\.netrc|\.npmrc|\.pypirc|secrets\.env|sdkconfig\.local)(?:[\s'\";&|<>]|$)",
    r"(?:^|[\s'\"=/])(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:[\s'\";&|<>]|$)",
    r"\.aws/credentials(?:[\s'\";&|<>]|$)",
    r"\.config/gh/hosts\.yml(?:[\s'\";&|<>]|$)",
    r"\.docker/config\.json(?:[\s'\";&|<>]|$)",
    r"\.gem/credentials(?:[\s'\";&|<>]|$)",
    r"\.kube/config(?:[\s'\";&|<>]|$)",
    r"(?:^|[\s'\"=/])\.env(?:\.[A-Za-z0-9_-]+)?(?:[\s'\";&|<>]|$)",
)

SENSITIVE_ENV_REFERENCE = re.compile(
    r"\$(?:\{)?(?:"
    r"GH_TOKEN|GITHUB_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|"
    r"AWS_SESSION_TOKEN|AWS_[A-Z0-9_]*KEY[A-Z0-9_]*|"
    r"NPM_TOKEN|PYPI_TOKEN|GITLAB_TOKEN|DOCKER_PASSWORD|"
    r"SLACK_TOKEN|STRIPE_SECRET_KEY|SENTRY_AUTH_TOKEN|CLOUDFLARE_API_TOKEN|"
    r"OTA_SIGNING_KEY_FILE"
    r")(?:\})?",
)

SHELL_EXTGLOB = re.compile(r"(?<!\\)[@+?!*]\([^)]*\)")


def shell_mentions_sensitive(command: str) -> bool:
    return any(re.search(pattern, command, flags=re.IGNORECASE) for pattern in SENSITIVE_COMMAND_PATTERNS)


def shell_mentions_sensitive_env(command: str) -> bool:
    return SENSITIVE_ENV_REFERENCE.search(command) is not None


def shell_injects_credential_wrapper(command: str) -> bool:
    normalized = normalize_ansi_c_quotes(command).replace("\n", " ; ")
    try:
        lexer = shlex.shlex(normalized, posix=True, punctuation_chars=";&|()!<>")
        lexer.whitespace_split = True
        lexer.commenters = ""
        tokens = list(lexer)
    except ValueError:
        return "gh-with-git-" in normalized

    wrapper_name = "gh-with-git-credentials.sh"

    def may_resolve_wrapper(token: str) -> bool:
        for expanded in expand_static_braces(token):
            if expanded == "__AGENT_AMBIGUOUS_BRACE__":
                return "gh-with-git-" in token
            pieces = [expanded, *re.split(r"[\s;&|()!<>]+", expanded)]
            for piece in pieces:
                candidate = Path(piece).name
                if candidate == wrapper_name:
                    return True
                if any(character in candidate for character in "*?[") and fnmatch.fnmatchcase(
                    wrapper_name, candidate
                ):
                    return True
        return False

    if not any(may_resolve_wrapper(token) for token in tokens):
        return False
    if re.search(r"(?<!\\)(?:\$[({A-Za-z_]|`)", normalized):
        return True
    if any(re.fullmatch(r"[;&|()!<>]+", token) for token in tokens):
        return True
    canonical_wrapper = str((HOOK_ROOT / "scripts/gh-with-git-credentials.sh").resolve())
    if not tokens or tokens[0] not in {
        canonical_wrapper,
        "scripts/gh-with-git-credentials.sh",
        "./scripts/gh-with-git-credentials.sh",
    }:
        return True
    if any(
        tokens[index : index + 2]
        in (
            ["pr", "checkout"],
            ["pr", "co"],
            ["pr", "new"],
            ["pr", "revert"],
            ["issue", "transfer"],
            ["release", "create"],
            ["release", "new"],
            ["release", "download"],
            ["release", "upload"],
            ["release", "verify-asset"],
            ["repo", "create"],
            ["repo", "new"],
            ["repo", "read-file"],
            ["repo", "set-default"],
            ["run", "download"],
        )
        for index in range(len(tokens) - 1)
    ):
        return True
    if any(tokens[index : index + 2] == ["pr", "close"] for index in range(len(tokens) - 1)) and any(
        token in {"-d", "--delete-branch"} or token.startswith("--delete-branch=") for token in tokens
    ):
        return True

    def foreign_repo_spec(value: str) -> bool:
        parts = value.removesuffix(".git").split("/")
        return (
            len(parts) == 3
            and parts[0].lower() != "github.com"
            and all(re.fullmatch(r"[A-Za-z0-9_.-]+", part) for part in parts)
        )

    for index, token in enumerate(tokens[1:], 1):
        if token in {"--repo", "-R"} and index + 1 < len(tokens):
            if foreign_repo_spec(tokens[index + 1]):
                return True
        elif token.startswith("--repo=") and foreign_repo_spec(token.split("=", 1)[1]):
            return True
    if len(tokens) > 3 and tokens[1:3] == ["repo", "view"] and foreign_repo_spec(tokens[3]):
        return True

    return any(
        token in {"--jq", "-q", "--template", "-t", "--verbose", "--web", "-w", "--editor", "-e", "-F", "--allow-escape-sequences"}
        or token.startswith(("--jq=", "--template=", "--verbose=", "--web=", "--editor=", "--allow-escape-sequences="))
        or (token.startswith("-q") and len(token) > 2)
        or (token.startswith("-t") and len(token) > 2)
        or re.fullmatch(r"-[^-].+", token) is not None
        or "://" in token
        or re.fullmatch(r"[^/:]+@?[^/:]*:[^/]+/[^/]+", token) is not None
        for token in tokens[1:]
    )


def direct_credential_wrapper_token(command: str) -> str:
    """Return the executable token for a direct, already-validated wrapper invocation."""
    normalized = normalize_ansi_c_quotes(command).replace("\n", " ; ")
    try:
        lexer = shlex.shlex(normalized, posix=True, punctuation_chars=";&|()!<>")
        lexer.whitespace_split = True
        lexer.commenters = ""
        tokens = list(lexer)
    except ValueError:
        return ""
    canonical_wrapper = str((HOOK_ROOT / "scripts/gh-with-git-credentials.sh").resolve())
    if tokens and tokens[0] in {
        canonical_wrapper,
        "scripts/gh-with-git-credentials.sh",
        "./scripts/gh-with-git-credentials.sh",
    }:
        return tokens[0]
    return ""


SHELL_ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=.*$", re.DOTALL)
STATIC_VARIABLE = re.compile(r"^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$")


def resolve_static_shell_token(token: str, assignments: dict[str, str]) -> tuple[str, bool]:
    match = STATIC_VARIABLE.fullmatch(token)
    if match:
        value = assignments.get(match.group(1) or match.group(2))
        if value is None or re.search(r"[$`;&|<>()]", value):
            return token, False
        return value, True
    if re.search(r"[$`]", token):
        return token, False
    return token, True


def token_may_name_command(token: str, *names: str) -> bool:
    """Match a literal/static expansion, or a dynamic token that visibly names a command."""
    for expanded in expand_static_braces(token):
        if expanded == "__AGENT_AMBIGUOUS_BRACE__":
            return True
        candidate = Path(expanded).name
        for name in names:
            if candidate == name:
                return True
            if any(character in candidate for character in "*?[") and fnmatch.fnmatchcase(
                name, candidate
            ):
                return True
            if re.search(r"[$`]", candidate) and re.search(
                rf"(?:^|[^A-Za-z0-9_-]){re.escape(name)}(?:[^A-Za-z0-9_-]|$)", candidate
            ):
                return True
    return False


def dynamic_command_token(token: str) -> bool:
    return re.search(r"[$`]", token) is not None

SUDO_OPTIONS_WITH_VALUE = {
    "-C",
    "--chdir",
    "-D",
    "--chroot",
    "-g",
    "--group",
    "-h",
    "--host",
    "-p",
    "--prompt",
    "-R",
    "--role",
    "-T",
    "--type",
    "-u",
    "--user",
}


def consume_sudo_options(tokens: list[str]) -> list[str]:
    index = 1
    while index < len(tokens):
        token = tokens[index]
        if token == "--":
            return tokens[index + 1 :]
        if token in SUDO_OPTIONS_WITH_VALUE:
            index += 2
            continue
        if any(token.startswith(option + "=") for option in SUDO_OPTIONS_WITH_VALUE if option.startswith("--")):
            index += 1
            continue
        if token.startswith("-"):
            index += 1
            continue
        break
    return tokens[index:]


def effective_shell_tokens(segment: str) -> tuple[list[str], bool]:
    """Return the command after wrappers/env; bool means env itself would print its state."""
    try:
        tokens = shlex.split(segment, posix=True)
    except ValueError:
        return [], False
    while tokens and SHELL_ASSIGNMENT.fullmatch(tokens[0]):
        tokens.pop(0)
    for _ in range(8):
        if not tokens:
            break
        executable = Path(tokens[0]).name
        if executable == "sudo":
            tokens = consume_sudo_options(tokens)
            continue
        if executable in {"command", "builtin", "exec"}:
            tokens = tokens[1:]
            while tokens and tokens[0].startswith("-"):
                tokens = tokens[1:]
            continue
        if executable in {"!", "{", "}", "if", "then", "elif", "else", "do", "while", "until"}:
            tokens = tokens[1:]
            continue
        if executable in {"time", "nohup"}:
            tokens = tokens[1:]
            while tokens and tokens[0].startswith("-"):
                option = tokens.pop(0)
                if option in {"-f", "--format", "-o", "--output"} and tokens:
                    tokens.pop(0)
            continue
        if executable == "nice":
            tokens = tokens[1:]
            while tokens and tokens[0].startswith("-"):
                option = tokens.pop(0)
                if option in {"-n", "--adjustment"} and tokens:
                    tokens.pop(0)
            continue
        if executable == "env":
            args = tokens[1:]
            index = 0
            while index < len(args):
                token = args[index]
                if token == "--":
                    index += 1
                    break
                if token in {"-u", "--unset", "-C", "--chdir", "-S", "--split-string"}:
                    index += 2
                    continue
                if token.startswith("-"):
                    index += 1
                    continue
                break
            while index < len(args) and SHELL_ASSIGNMENT.fullmatch(args[index]):
                index += 1
            tokens = args[index:]
            if not tokens:
                return [], True
            continue
        break
    return tokens, bool(tokens and Path(tokens[0]).name == "env")


def normalize_ansi_c_quotes(command: str) -> str:
    def decode(match: re.Match[str]) -> str:
        try:
            return bytes(match.group(1), "utf-8").decode("unicode_escape")
        except UnicodeDecodeError:
            return match.group(0)

    command = re.sub(r"\\\r?\n", "", command)
    normalized = re.sub(r"\$'((?:[^'\\]|\\.)*)'", decode, command)
    return re.sub(r'\$"((?:[^"\\]|\\.)*)"', r'"\1"', normalized)


def shell_token_sets(command: str, depth: int = 0) -> list[tuple[list[str], bool]]:
    """Tokenize top-level commands and recursively inspect shell/eval string wrappers."""
    if depth > 4:
        return [([], True)]
    command = normalize_ansi_c_quotes(command)
    results: list[tuple[list[str], bool]] = []
    for substitution in re.findall(r"(?<!\\)`([^`]*)`", command, flags=re.DOTALL):
        results.extend(shell_token_sets(substitution, depth + 1))
    for substitution in re.findall(r"(?<!\\)\$\(([^()]*)\)", command, flags=re.DOTALL):
        results.extend(shell_token_sets(substitution, depth + 1))
    try:
        lexer = shlex.shlex(command.replace("\n", " ; "), posix=True, punctuation_chars=";&|()!<>")
        lexer.whitespace_split = True
        lexer.commenters = ""
        raw_tokens = list(lexer)
    except ValueError:
        return [([], True)]
    segments: list[list[str]] = [[]]
    for token in raw_tokens:
        if re.fullmatch(r"[;&|()!<>]+", token):
            if segments[-1]:
                segments.append([])
            continue
        segments[-1].append(token)
    persistent_assignments: dict[str, str] = {}
    for segment_tokens in (segment for segment in segments if segment):
        if all(SHELL_ASSIGNMENT.fullmatch(token) for token in segment_tokens):
            for token in segment_tokens:
                name, value = token.split("=", 1)
                if re.search(r"[$`;&|<>()]", value):
                    persistent_assignments.pop(name, None)
                else:
                    persistent_assignments[name] = value
            continue
        resolved_segment = [
            resolve_static_shell_token(token, persistent_assignments)[0] for token in segment_tokens
        ]
        if resolved_segment and Path(resolved_segment[0]).name == "env":
            for index, token in enumerate(resolved_segment[:-1]):
                if token in {"-S", "--split-string"}:
                    results.extend(shell_token_sets(resolved_segment[index + 1], depth + 1))
            for token in resolved_segment[1:]:
                if token.startswith("-S") and token != "-S":
                    results.extend(shell_token_sets(token[2:], depth + 1))
                elif token.startswith("--split-string="):
                    results.extend(shell_token_sets(token.split("=", 1)[1], depth + 1))
        tokens, env_without_command = effective_shell_tokens(shlex.join(resolved_segment))
        results.append((tokens, env_without_command))
        if not tokens:
            continue
        executable = Path(tokens[0]).name
        if executable in {"bash", "dash", "sh", "zsh"}:
            command_flag = next(
                (
                    index
                    for index, token in enumerate(tokens[1:], 1)
                    if token == "--command"
                    or (token.startswith("-") and not token.startswith("--") and "c" in token[1:])
                ),
                None,
            )
            if command_flag is not None and command_flag + 1 < len(tokens):
                results.extend(shell_token_sets(tokens[command_flag + 1], depth + 1))
        elif executable == "eval" and len(tokens) > 1:
            results.extend(shell_token_sets(" ".join(tokens[1:]), depth + 1))
    return results


def shell_dumps_environment(command: str) -> bool:
    if re.search(r"\bprintenv\b", command):
        return True
    if re.search(r"(?:^|[;&|]\s*)ps\s+e(?:w{0,2})(?:\s|$)", command):
        return True
    if re.search(r"\b(?:os\.(?:environ|getenv)|process\.env|ENVIRON)\b", command):
        return True
    for segment in shell_segments(command):
        for index, token in enumerate(segment):
            executable = Path(token).name
            if executable == "printenv":
                return True
            if executable == "env" and all(
                following in {";", "+", "{}"} for following in segment[index + 1 :]
            ):
                return True
    for tokens, env_without_command in shell_token_sets(command):
        if env_without_command:
            return True
        if not tokens:
            continue
        for token in tokens:
            for candidate in re.split(r"[=@]", token):
                normalized = posixpath.normpath(candidate)
                components = [component for component in normalized.split("/") if component]
                if components and components[-1] == "environ" and "proc" in components:
                    return True
        command_token = tokens[0]
        executable = Path(command_token).name
        if token_may_name_command(command_token, "ps") and any(
            (argument.startswith("-") and "E" in argument.lstrip("-"))
            or (not argument.startswith("-") and re.search(r"[eE]", argument))
            for argument in tokens[1:]
            if re.fullmatch(r"-?[A-Za-z]+", argument)
        ):
            return True
        if token_may_name_command(command_token, "printenv"):
            return True
        if token_may_name_command(command_token, "env") and len(tokens) == 1:
            return True
        if token_may_name_command(command_token, "set") and len(tokens) == 1:
            return True
        # All three builtins have output-producing forms whose option semantics differ between
        # bash and zsh (`declare GH_TOKEN`, `typeset +x`, naked `readonly`, ...).  Agents do not
        # need these declaration builtins for repository work, so fail closed instead of trying to
        # maintain a shell-version-specific list of printing combinations.
        if any(
            token_may_name_command(command_token, name)
            for name in ("declare", "typeset", "readonly")
        ):
            return True
        if token_may_name_command(command_token, "export"):
            args = tokens[1:]
            if (
                not args
                or any(token in {"-p", "--print"} for token in args)
                or not any(not token.startswith("-") for token in args)
            ):
                return True
    return False


def shell_dumps_credentials(command: str) -> bool:
    shell = r"(?:bash|dash|sh|zsh)"
    if any(
        re.search(pattern, command, flags=re.IGNORECASE)
        for pattern in (
            r"\bauth\s+(?:application-default\s+)?(?:token|print-(?:access|identity)-token)\b",
            r"\b(?:git|docker)-credential-[A-Za-z0-9_-]+\b[^;&|\n]*\bget\b",
            r"\bconfig\s+view\b[^;&|\n]*--raw(?:=|\b)",
            r"\bconfigure\s+(?:export-credentials|get\b[^;&|\n]*(?:access_key|secret|session_token))",
        )
    ):
        return True
    if (
        re.search(rf"\|[^|;\n]*\b{shell}\b", command)
        or re.search(rf"\b{shell}\b[^;&|\n]*(?:<<<|(?<!<)<(?!<))", command)
        or re.search(rf"\b{shell}\b(?:\s+-[^;&|\n]*)*\s+-s(?:\s|$)", command)
    ):
        return True
    for tokens, _ in shell_token_sets(command):
        if not tokens:
            continue
        for command_index, token in enumerate(tokens):
            executable = Path(token).name
            args = tokens[command_index + 1 :]
            token_may_resolve_gh = token_may_name_command(token, "gh")
            token_is_dynamic = dynamic_command_token(token)
            if (token_may_resolve_gh or token_is_dynamic) and any(
                argument in {"--jq", "-q", "--template", "-t"}
                or argument.startswith(("--jq=", "--template="))
                or re.fullmatch(r"-[A-Za-z]*[qt].*", argument) is not None
                for argument in args
            ):
                return True
            if (token_may_resolve_gh or token_is_dynamic or executable == "gh-with-git-credentials.sh") and (
                any(args[index : index + 2] == ["auth", "token"] for index in range(len(args) - 1))
                or any(argument == "--show-token" or argument.startswith("--show-token=") for argument in args)
                or (
                    any(args[index : index + 2] == ["auth", "status"] for index in range(len(args) - 1))
                    and "-t" in args
                )
            ):
                return True
            if (token_may_name_command(token, "git") or token_is_dynamic) and (
                any(args[index : index + 2] == ["credential", "fill"] for index in range(len(args) - 1))
                or any(
                    args[index].startswith("credential-") and args[index + 1] == "get"
                    for index in range(len(args) - 1)
                )
            ):
                return True
            if (
                executable.startswith("git-credential-")
                or (token_is_dynamic and "credential" in token)
            ) and args[:1] == ["get"]:
                return True
            if (
                executable.startswith("docker-credential-")
                or (token_is_dynamic and "credential" in token)
            ) and args[:1] == ["get"]:
                return True
            if (token_may_name_command(token, "aws") or token_is_dynamic) and any(
                args[index : index + 2] == ["configure", "export-credentials"]
                or (
                    args[index : index + 2] == ["configure", "get"]
                    and index + 2 < len(args)
                    and args[index + 2].split(".")[-1]
                    in {"aws_access_key_id", "aws_secret_access_key", "aws_session_token"}
                )
                for index in range(len(args))
            ):
                return True
            if (token_may_name_command(token, "gcloud") or token_is_dynamic) and any(
                args[index : index + 2]
                in (["auth", "print-access-token"], ["auth", "print-identity-token"])
                or args[index : index + 3] == ["auth", "application-default", "print-access-token"]
                for index in range(len(args))
            ):
                return True
            if (token_may_name_command(token, "kubectl") or token_is_dynamic) and any(
                args[index : index + 2] == ["config", "view"] for index in range(len(args))
            ) and any(arg == "--raw" or arg.startswith("--raw=") for arg in args):
                return True
            if (token_may_name_command(token, "security") or token_is_dynamic) and any(arg.startswith("find-") for arg in args) and any(
                arg in {"-g", "-w"} for arg in args
            ):
                return True
            if (token_may_name_command(token, "security") or token_is_dynamic) and "export" in args:
                return True
    return False


def expand_static_braces(token: str, depth: int = 0, budget: list[int] | None = None) -> list[str]:
    ambiguous = "__AGENT_AMBIGUOUS_BRACE__"
    if budget is None:
        budget = [256]
    if depth > 32:
        return [ambiguous]
    match = re.search(r"\{([^{}]+)\}", token)
    if not match:
        return [token]
    body = match.group(1)
    choices: list[str]
    if "," in body:
        choices = list(dict.fromkeys(body.split(",")))
    else:
        parts = body.split("..")
        if len(parts) not in {2, 3}:
            return [token]
        start, end = parts[:2]
        step_text = parts[2] if len(parts) == 3 else ""
        try:
            if len(start) == len(end) == 1 and not start.isdigit() and not end.isdigit():
                start_value, end_value = ord(start), ord(end)
                default_step = 1 if start_value <= end_value else -1
                step = int(step_text) if step_text else default_step
                if step == 0 or (end_value - start_value) * step < 0:
                    return [token]
                values = range(start_value, end_value + (1 if step > 0 else -1), step)
                choices = [chr(value) for value in values]
            elif re.fullmatch(r"-?\d+", start) and re.fullmatch(r"-?\d+", end):
                start_value, end_value = int(start), int(end)
                default_step = 1 if start_value <= end_value else -1
                step = int(step_text) if step_text else default_step
                if step == 0 or (end_value - start_value) * step < 0:
                    return [token]
                values = range(start_value, end_value + (1 if step > 0 else -1), step)
                choices = [str(value) for value in values]
            else:
                return [token]
        except (ValueError, OverflowError):
            return [token]
        if len(choices) > 256:
            return [ambiguous]
    # Charge the global expansion budget before descending.  Checking only after a complete child
    # subtree makes a short token containing many `{a,b}` groups exponential and can outlive the
    # hook timeout.  Exhaustion is policy ambiguity, so callers fail closed.
    if len(choices) > budget[0]:
        return [ambiguous]
    budget[0] -= len(choices)
    expanded: list[str] = []
    for choice in choices:
        replacement = token[: match.start()] + choice + token[match.end() :]
        child = expand_static_braces(replacement, depth + 1, budget)
        if ambiguous in child:
            return [ambiguous]
        expanded.extend(child)
        if len(expanded) > 256:
            return [ambiguous]
    return list(dict.fromkeys(expanded))


def token_can_resolve_sensitive(token: str) -> bool:
    for expanded in expand_static_braces(token):
        if expanded == "__AGENT_AMBIGUOUS_BRACE__":
            return True
        candidates = [expanded]
        if "=" in expanded:
            candidates.append(expanded.split("=", 1)[1])
        for candidate in candidates:
            if is_sensitive_path(candidate):
                return True
            base_pattern = basename(candidate)
            if not any(character in base_pattern for character in "*?["):
                continue
            representative_basenames = {
                "ota_signing_key.pem",
                "private.pem",
                "private.key",
                "private.p12",
                "private.pfx",
                "private.jks",
                "private.keystore",
                ".git-credentials",
                ".netrc",
                ".npmrc",
                ".pypirc",
                "secrets.env",
                "sdkconfig.local",
                "credentials",
                "credentials.json",
                ".env",
                ".env.production",
                "id_rsa",
                "id_dsa",
                "id_ecdsa",
                "id_ed25519",
                "id_ed25519_sk",
                "private_key",
            }
            if any(fnmatch.fnmatchcase(name, base_pattern) for name in representative_basenames):
                return True
            normalized = candidate.replace("\\", "/").lower()
            path_specific = {
                "/.aws/": "credentials",
                "/.gem/": "credentials",
                "/.config/gh/": "hosts.yml",
                "/.docker/": "config.json",
                "/.kube/": "config",
            }
            if any(marker in normalized and fnmatch.fnmatchcase(name, base_pattern) for marker, name in path_specific.items()):
                return True
    return False


def shell_mentions_sensitive_token_path(command: str) -> bool:
    for tokens, _ in shell_token_sets(command):
        for token in tokens:
            if token_can_resolve_sensitive(token):
                return True
    return False


def is_exact_espsecure_sign(command: str) -> bool:
    if "\n" in command or re.search(r"[;&|`<>]|\$\(", command):
        return False
    try:
        tokens = shlex.split(command, posix=True)
    except ValueError:
        return False
    if not tokens:
        return False
    if Path(tokens[0]).name in {"python", "python3"}:
        if len(tokens) < 4 or tokens[1:3] != ["-m", "espsecure"]:
            return False
        tokens = tokens[2:]
    executable = Path(tokens[0]).name
    if executable not in {"espsecure", "espsecure.py"} or len(tokens) < 3:
        return False
    if tokens[1] not in {"sign_data", "sign-data"}:
        return False
    key_flags = [index for index, token in enumerate(tokens) if token == "--keyfile"]
    if len(key_flags) != 1 or key_flags[0] + 1 >= len(tokens):
        return False
    key_index = key_flags[0] + 1
    key_path = tokens[key_index]
    key_reference = key_path in {"$OTA_SIGNING_KEY_FILE", "${OTA_SIGNING_KEY_FILE}"}
    if basename(key_path) != "ota_signing_key.pem" and not key_reference:
        return False

    # The private key path is allowed in exactly one semantic position: the value of --keyfile.
    # Reject it (or any other sensitive path) as DATAFILE, output, a second key, or an option value.
    # Otherwise espsecure could be abused as the copy primitive that the surrounding guard forbids.
    for index, token in enumerate(tokens):
        if index == key_index:
            continue
        if is_sensitive_path(token) or shell_mentions_sensitive_env(token):
            return False
    return True


def canonical_production_ota_command(payload: dict[str, Any], command: str) -> bool:
    """Only an exact reviewed gate shape may own a bench or production OTA write."""
    if "\n" in command or re.search(r"[;&|`<>]|\$\(", command):
        return False
    try:
        tokens = shlex.split(command, posix=True)
    except ValueError:
        return False
    if not tokens:
        return False
    effective_cwd, cwd_error = effective_shell_cwd(payload)
    if cwd_error:
        return False
    executable = Path(tokens[0]).expanduser()
    if not executable.is_absolute():
        executable = effective_cwd / executable
    canonical = HOOK_ROOT / "scripts/production-ota-gate.py"
    # Normalize dot components without resolving a foreign symlink onto the canonical file.
    if Path(os.path.abspath(executable)) != canonical:
        return False
    if tokens[1:] == ["--self-test"]:
        return True
    exact_values = {
        "--manifest-url": "https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json",
    }
    patterns = {
        "--expected-source-sha": r"[0-9a-f]{40}",
        "--expected-version": r"[0-9A-Za-z._+-]+-dev\.[0-9]+",
        "--expected-app-sha256": r"[0-9a-f]{64}",
    }
    flags: set[str] = set()
    if "--install-bench" in tokens:
        flags = {"--install-bench"}
        exact_values["--confirm-bench"] = "bench"
        patterns["--expected-current-version"] = r"[0-9A-Za-z._+-]+"
    elif "--execute" in tokens:
        flags = {"--execute"}
        exact_values["--confirm-production"] = "production"
        patterns["--expected-current-version"] = r"[0-9A-Za-z._+-]+"
    else:
        return False  # production staging without execution already performs bench writes

    expected_options = set(exact_values) | set(patterns)
    seen_options: dict[str, str] = {}
    seen_flags: set[str] = set()
    index = 1
    while index < len(tokens):
        token = tokens[index]
        if token in flags and token not in seen_flags:
            seen_flags.add(token)
            index += 1
            continue
        if token not in expected_options or token in seen_options or index + 1 >= len(tokens):
            return False
        seen_options[token] = tokens[index + 1]
        index += 2
    if set(seen_options) != expected_options or seen_flags != flags:
        return False
    if any(seen_options[option] != expected for option, expected in exact_values.items()):
        return False
    if seen_options.get("--expected-current-version") == seen_options["--expected-version"]:
        return False
    return all(
        re.fullmatch(pattern, seen_options[option]) is not None
        for option, pattern in patterns.items()
    )


def possible_ota_update_route(command: str) -> bool:
    """Recognize literal OTA routes and common shell-built equivalents."""
    decoded = unquote(unquote(command))
    compact = re.sub(r"[\s'\"+\\]", "", decoded.lower())
    if "/ota/update" in compact or "ota/update" in compact:
        return True
    if re.search(r"https?://[^'\";&|]*[$`][\s\S]{0,160}/update", decoded, re.IGNORECASE):
        return True
    for token in shell_syntax_tokens(decoded):
        if "/update" in token.lower() and re.search(r"[$`]", token):
            return True
        for expanded in expand_static_braces(token):
            if expanded == "__AGENT_AMBIGUOUS_BRACE__":
                return "ota" in token.lower() and "update" in token.lower()
            candidate = unquote(unquote(expanded)).lower()
            segments = candidate.split("/")
            for index in range(len(segments) - 1):
                route = segments[index]
                action = re.split(r"[?#]", segments[index + 1], maxsplit=1)[0]
                if fnmatch.fnmatchcase("ota", route) and fnmatch.fnmatchcase("update", action):
                    return True
    return False


def shell_syntax_tokens(command: str) -> list[str]:
    """Return quote-aware shell tokens while retaining control and redirection operators."""
    try:
        lexer = shlex.shlex(
            normalize_ansi_c_quotes(command).replace("\n", " ; "),
            posix=True,
            punctuation_chars=";&|()!<>",
        )
        lexer.whitespace_split = True
        lexer.commenters = ""
        return list(lexer)
    except ValueError:
        return []


def shell_client_receives_stdin(command: str, client: str) -> bool:
    """Recognize an upstream pipe or input redirection for a named client token."""
    tokens = shell_syntax_tokens(command)
    for index, token in enumerate(tokens):
        if Path(token).name.lower() != client:
            continue
        previous_control = next(
            (candidate for candidate in reversed(tokens[:index]) if re.fullmatch(r"[;&|()!<>]+", candidate)),
            "",
        )
        if "|" in previous_control:
            return True
        for candidate in tokens[index + 1 :]:
            if re.fullmatch(r"[;&|()!]+", candidate):
                break
            if re.fullmatch(r"<{1,3}", candidate):
                return True
    return False


def shell_argument_may_be_post(argument: str) -> bool:
    """Recognize literal, brace-expanded or glob-shaped POST method arguments."""
    for expanded in expand_static_braces(argument.lower()):
        if expanded == "__AGENT_AMBIGUOUS_BRACE__":
            return True
        if any(fnmatch.fnmatchcase(target, expanded) for target in ("post", "-xpost", "--request=post", "--method=post")):
            return True
    return False


def curl_short_option_effects(argument: str, following: str = "") -> tuple[str, bool, bool, bool, bool]:
    """Return (method, GET flag, body, next transfer, ambiguous write) for a curl short cluster."""
    if not argument.startswith("-") or argument.startswith("--") or argument == "-":
        return "", False, False, False, False
    consumes_value = set("AbcCDeEFHKmoPQrTtuUwXxyz")
    no_value = set("012346aBfgGhIiJkLlMnNOpqRsSvVZ#")
    cluster = argument[1:]
    saw_get = False
    for index, option in enumerate(cluster):
        remainder = cluster[index + 1 :]
        if option == "G":
            saw_get = True
            continue
        if option == ":":
            return "", saw_get, False, True, False
        if option == "X":
            return remainder or following, saw_get, False, False, False
        if option in {"d", "F", "T"}:
            return "", saw_get, True, False, False
        if option in consumes_value:
            return "", saw_get, False, False, False
        if option not in no_value:
            return "", saw_get, False, False, any(candidate in remainder for candidate in "XdFT:")
    return "", saw_get, False, False, False


def wget_argument_may_write(argument: str) -> bool:
    """Recognize GNU Wget write controls, including clusters and unique long abbreviations."""
    if argument.startswith("--"):
        name = argument[2:].split("=", 1)[0].lower()
        if not name:
            return False
        if any(target.startswith(name) for target in ("config", "execute", "post-file", "post-data")):
            return True
        return name != "method" and "method".startswith(name)
    if not argument.startswith("-") or argument == "-":
        return False
    value_options = set("aABDiIloOPQRtTUwX")
    for option in argument[1:]:
        if option == "e":
            return True
        if option in value_options:
            return False
    return False


def direct_ota_update_write(command: str) -> bool:
    """Recognize ordinary shell/client write shapes aimed at the OTA update route."""
    decoded = unquote(unquote(command))
    compact = re.sub(r"[\s'\"+\\]", "", decoded.lower())
    if not possible_ota_update_route(command):
        return False
    raw_tokens = shell_syntax_tokens(decoded)
    has_raw_network_client = any(
        Path(argument).name.lower() in {"nc", "ncat", "netcat", "openssl", "socat", "telnet"}
        for argument in raw_tokens
    ) or re.search(r"/dev/(?:tcp|udp)/", decoded, re.IGNORECASE) is not None
    if has_raw_network_client:
        return True
    if any(marker in compact for marker in (
        "-xpost", "--requestpost", "--request=post", ".post(", ".request(post,",
        "-methodpost",
    )):
        return True
    if re.search(r",method=post(?:[,)]|$)", compact) or \
       re.search(r"(?:^|[,{])method:post(?:[,}]|$)", compact):
        return True
    if "request(" in compact and ("data=" in compact or "json=" in compact):
        return True
    if "urlopen(" in compact and "data=" in compact:
        return True
    if re.search(r"(?:request|urlopen)\([^,]+,[^)]+", compact):
        return True
    for tokens, _ in shell_token_sets(decoded):
        if not tokens:
            continue
        for client_index, token in enumerate(tokens):
            executable = Path(token).name.lower()
            if executable not in {"curl", "http", "xh", "wget"}:
                continue
            raw_arguments = tokens[client_index + 1 :]
            arguments = [argument.lower() for argument in raw_arguments]
            dynamic_client_arguments = any(re.search(r"[$`]", argument) for argument in raw_arguments)
            if executable == "curl":
                if "--next" in arguments:
                    return True
                explicit_method = ""
                has_get_flag = False
                has_body = False
                for index, argument in enumerate(arguments):
                    if argument in {"-x", "--request"} and index + 1 < len(arguments):
                        explicit_method = arguments[index + 1]
                        if shell_argument_may_be_post(arguments[index + 1]):
                            return True
                    elif re.match(r"^(?:-x|--request=).+", argument):
                        explicit_method = re.sub(r"^(?:-x|--request=)", "", argument)
                        if shell_argument_may_be_post(argument):
                            return True
                    method, cluster_get, cluster_body, cluster_next, cluster_ambiguous = curl_short_option_effects(
                        raw_arguments[index], raw_arguments[index + 1] if index + 1 < len(raw_arguments) else "",
                    )
                    has_get_flag = has_get_flag or cluster_get
                    has_body = has_body or cluster_body
                    if cluster_next:
                        return True
                    if cluster_ambiguous:
                        return True
                    if method:
                        explicit_method = method.lower()
                        if shell_argument_may_be_post(method):
                            return True
                forces_get = explicit_method in {"get", "head"} or (
                    not explicit_method and (
                        has_get_flag or any(argument in {"-g", "--get"} for argument in arguments)
                    )
                )
                if dynamic_client_arguments and not forces_get:
                    return True
                if has_body and not forces_get:
                    return True
                for index, argument in enumerate(arguments):
                    if argument in {"-x", "--request"} and index + 1 < len(arguments) and \
                       arguments[index + 1] == "post":
                        return True
                    if not forces_get and (argument in {
                        "-d", "--data", "--data-ascii", "--data-binary", "--data-raw", "--json",
                        "--data-urlencode", "--form", "--form-string", "--upload-file",
                    } or raw_arguments[index] in {"-F", "-T"} or \
                       raw_arguments[index].startswith(("-F", "-T")) or \
                       argument.startswith(("--data", "--form", "--json=", "--upload-file=")) or \
                       re.match(r"^(?:-xpost|-d.+|--request=post)", argument)):
                        return True
            elif executable in {"http", "xh"}:
                explicit_methods = {
                    argument for argument in arguments
                    if argument in {"delete", "get", "head", "options", "patch", "post", "put"}
                }
                if any(shell_argument_may_be_post(argument) for argument in arguments):
                    return True
                if dynamic_client_arguments and explicit_methods not in ({"get"}, {"head"}):
                    return True
                has_body = shell_client_receives_stdin(decoded, executable) or any(
                    argument == "--raw" or argument.startswith("--raw=") or
                    argument in {"--form", "--multipart"} or
                    not argument.startswith("-") and (
                        ":=" in argument or
                        ("=" in argument and "==" not in argument) or
                        "@" in argument
                    )
                    for argument in arguments
                    if "://" not in argument
                )
                if explicit_methods in ({"get"}, {"head"}):
                    continue
                if explicit_methods or has_body:
                    return True
            elif executable == "wget":
                if any(shell_argument_may_be_post(argument) for argument in arguments):
                    return True
                if re.search(r"(?:^|[\s;&|])wgetrc\s*=", decoded, re.IGNORECASE):
                    return True
                if any(wget_argument_may_write(argument) for argument in raw_arguments):
                    return True
                effective_method = ""
                for index, argument in enumerate(arguments):
                    if argument == "--method" and index + 1 < len(arguments):
                        effective_method = arguments[index + 1]
                    elif argument.startswith("--method="):
                        effective_method = argument.split("=", 1)[1]
                literal_safe_method = effective_method in {"get", "head"}
                if dynamic_client_arguments and not literal_safe_method:
                    return True
                for index, argument in enumerate(arguments):
                    if argument in {"--post-data", "--post-file"} or \
                       argument.startswith(("--post-data=", "--post-file=")):
                        return True
                    if argument == "--method" and index + 1 < len(arguments) and arguments[index + 1] == "post":
                        return True
                    if argument == "--method=post":
                        return True
    return False


def read_only_gate_inspection(command: str) -> bool:
    """Allow source inspection to name the gate without allowing an execution wrapper."""
    token_sets = [tokens for tokens, _ in shell_token_sets(command) if tokens]
    if not token_sets:
        return False
    for tokens in token_sets:
        executable = Path(tokens[0]).name
        args = tokens[1:]
        if executable not in {"cat", "diff", "grep", "head", "rg", "sed", "tail"}:
            return False
        if executable == "diff" and any(
            arg == "--output" or arg.startswith("--output=") for arg in args
        ):
            return False
        if executable == "rg" and any(
            arg == "--pre" or arg.startswith("--pre=") for arg in args
        ):
            return False
        if executable == "sed" and any(
            arg == "-i" or arg.startswith("-i") or arg == "--in-place" or arg.startswith("--in-place=")
            for arg in args
        ):
            return False
    return True


def aliases_canonical_ota_gate(payload: dict[str, Any], command: str) -> bool:
    """Reject renamed aliases or exact copies, including launcher arguments."""
    effective_cwd, cwd_error = effective_shell_cwd(payload)
    if cwd_error:
        return False
    canonical = HOOK_ROOT / "scripts/production-ota-gate.py"
    token_sets = shell_token_sets(command)
    raw_tokens = shell_syntax_tokens(command)
    if raw_tokens:
        token_sets.append((raw_tokens, False))
    nested_tokens = []
    for tokens, _ in token_sets:
        for token in tokens:
            if any(character.isspace() for character in token):
                nested = token.split("=", 1)[1] if "=" in token else token
                nested_tokens.extend(shell_token_sets(nested))
    for tokens, _ in [*token_sets, *nested_tokens]:
        if not tokens:
            continue
        for token in tokens:
            candidate = Path(token).expanduser()
            if not candidate.is_absolute():
                candidate = effective_cwd / candidate
            lexical = Path(os.path.abspath(candidate))
            if lexical == canonical or not lexical.is_file():
                continue
            try:
                if os.path.samefile(lexical, canonical) or filecmp.cmp(lexical, canonical, shallow=False):
                    return True
            except OSError:
                pass
    return False


def production_ota_violation(payload: dict[str, Any]) -> str | None:
    if normalized_tool(payload.get("tool_name")) not in SHELL_TOOLS:
        return None
    command = command_from(payload)
    if not command:
        return None
    if canonical_production_ota_command(payload, command):
        return None
    compact = re.sub(r"[\s'\"+\\]", "", unquote(unquote(command)).lower())
    names_gate = "production-ota-gate.py" in compact or any(
        token_may_name_command(token, "production-ota-gate.py")
        for tokens, _ in shell_token_sets(command)
        for token in tokens
    )
    names_gate = names_gate or (
        re.search(r"[$`]", command) is not None
        and (
            ("production-ota-" in compact and "gate.py" in compact)
            or all(
                option in compact
                for option in (
                    "--manifest-url", "--expected-source-sha", "--expected-version",
                    "--expected-app-sha256",
                )
            )
            or any(
                re.search(r"[$`]", token) is not None and "/scripts/" in f"/{token}"
                for tokens, _ in shell_token_sets(command)
                for token in tokens
            )
        )
    )
    read_only_inspection = read_only_gate_inspection(command)
    if (aliases_canonical_ota_gate(payload, command) and not read_only_inspection) or \
       (names_gate and not read_only_inspection):
        return "the OTA gate is not a canonical direct, unchained, role- and artifact-bound command"
    if direct_ota_update_write(command):
        return (
            "direct OTA writes are forbidden; run scripts/production-ota-gate.py so the exact signed "
            "artifact targets either the inventory-pinned bench-only gate or the distinct bench-first "
            "production promotion gate"
        )
    return None


def secret_violation(payload: dict[str, Any]) -> str | None:
    raw_tool = payload.get("tool_name")
    if not isinstance(raw_tool, str) or not raw_tool.strip():
        return "hook payload has no non-empty string tool_name"
    tool = normalized_tool(raw_tool)
    if tool not in FILE_TOOLS | PATCH_TOOLS | SHELL_TOOLS:
        return f"hook payload names unsupported matched tool {raw_tool!r}"
    if tool in FILE_TOOLS:
        targets = path_targets(payload)
        if not targets:
            return f"cannot determine the {tool} target from the hook payload"
        for target in targets:
            if is_sensitive_path(target):
                return f"{target} is credential or private-key material and must not enter agent context"
        return None
    if tool in PATCH_TOOLS:
        command = command_from(payload)
        targets = patch_targets(command)
        if not command or not targets:
            return "cannot determine apply_patch targets from the hook payload"
        for target in targets:
            if is_sensitive_path(target):
                return f"apply_patch targets sensitive credential or private-key file {target}"
        return None
    if tool in SHELL_TOOLS:
        command = command_from(payload)
        if not command:
            return f"cannot determine the {tool} command from the hook payload"
        if shell_injects_credential_wrapper(command):
            return (
                "the credential wrapper must use the reviewed direct form without shell wrappers, "
                "assignments, substitutions, redirections, chaining, or unreviewed output and child-process flags"
            )
        wrapper_token = direct_credential_wrapper_token(command)
        if wrapper_token:
            effective_cwd, cwd_error = effective_shell_cwd(payload)
            if cwd_error:
                return cwd_error
            wrapper = Path(wrapper_token)
            if not wrapper.is_absolute():
                wrapper = effective_cwd / wrapper
            if wrapper.resolve(strict=False) != (HOOK_ROOT / "scripts/gh-with-git-credentials.sh").resolve():
                return "credential wrapper is not the canonical repository script"
        github_action = classify_github_action(command)
        if github_action is not None and github_action.get("error"):
            return github_action["error"]
        if SHELL_EXTGLOB.search(command):
            return "shell extglob expansion is not statically bounded by the credential/partition guard"
        if shell_dumps_environment(command):
            return "the command would dump process environment values, which may include credentials"
        if shell_dumps_credentials(command):
            return "the command would print an authentication token or credential value"
        if (
            shell_mentions_sensitive_env(command)
            or shell_mentions_sensitive_token_path(command)
            or shell_mentions_sensitive(command)
        ) and not is_exact_espsecure_sign(command):
            return "the command reads, copies, stages, or otherwise exposes credential/private-key material"
        return None
    return None


def is_partitions_path(path: str) -> bool:
    return basename(path) == "partitions.csv"


def command_tokens(segment: str) -> list[str]:
    try:
        tokens = shlex.split(segment, posix=True)
    except ValueError:
        return []
    while tokens and ("=" in tokens[0] and not tokens[0].startswith(("=", "-"))):
        tokens.pop(0)
    if tokens and tokens[0] in {"sudo", "command", "builtin"}:
        tokens.pop(0)
    return tokens


PARTITIONS_MENTION = re.compile(
    r"(?:^|[^A-Za-z0-9_.-])partitions\.csv(?:$|[^A-Za-z0-9_.-])", re.IGNORECASE
)


def shell_segments(command: str) -> list[list[str]]:
    command = normalize_ansi_c_quotes(command)
    try:
        lexer = shlex.shlex(command.replace("\n", " ; "), posix=True, punctuation_chars=";&|()!<>")
        lexer.whitespace_split = True
        lexer.commenters = ""
        tokens = list(lexer)
    except ValueError:
        return []
    segments: list[list[str]] = [[]]
    for token in tokens:
        if re.fullmatch(r"[;&|()!]+", token):
            if segments[-1]:
                segments.append([])
            continue
        segments[-1].append(token)
    return [segment for segment in segments if segment]


def token_can_resolve_partitions(token: str) -> bool:
    for expanded in expand_static_braces(token):
        if expanded == "__AGENT_AMBIGUOUS_BRACE__":
            return True
        for piece in re.findall(r"[A-Za-z0-9_.?*\[\]-]+", expanded.lower()):
            if piece == "partitions.csv" or fnmatch.fnmatchcase("partitions.csv", piece):
                return True
    return False


def partition_segment_is_read_only(tokens: list[str]) -> bool:
    for index, token in enumerate(tokens):
        if token_can_resolve_partitions(token) and index > 0 and re.fullmatch(r"\d*>+|>+", tokens[index - 1]):
            return False
    tokens, _ = effective_shell_tokens(shlex.join(tokens))
    if not tokens:
        return False
    executable = Path(tokens[0]).name.lower()
    args = tokens[1:]
    if executable in {
        "cat",
        "cmp",
        "diff",
        "file",
        "grep",
        "egrep",
        "fgrep",
        "head",
        "ls",
        "rg",
        "sha256sum",
        "shasum",
        "stat",
        "tail",
        "wc",
    }:
        if executable in {"cmp", "diff"} and any(
            arg == "--output" or arg.startswith("--output=") for arg in args
        ):
            return False
        if executable == "rg" and any(arg == "--pre" or arg.startswith("--pre=") for arg in args):
            return False
        return True
    if executable == "git" and args:
        if args[0] not in {"diff", "grep", "log", "show", "status"}:
            return False
        return not any(
            arg in {"--output", "--ext-diff", "--textconv"} or arg.startswith("--output=")
            for arg in args[1:]
        )
    return False


def shell_writes_partitions(command: str) -> bool:
    if any(is_partitions_path(target) for target in patch_targets(command)):
        return True
    if re.search(r"\bpartitions\b", command, re.IGNORECASE) and ".csv" in command and re.search(
        r"[$+]|\b(?:python|python3|node|awk)\b", command
    ):
        return True
    # A normally read-only tool becomes a writer when the protected path is its redirection target.
    # Check this before the executable allowlist so `cat source > partitions.csv` cannot pass as a
    # harmless cat invocation.
    if re.search(
        r">{1,2}\s*['\"]?[^\s'\"]*partitions\.csv(?:[\s'\";&|]|$)",
        command,
        re.IGNORECASE,
    ):
        return True
    segments = shell_segments(command)
    if not segments:
        return bool(PARTITIONS_MENTION.search(command) or "*.csv" in command or "partitions.*" in command)
    if not any(token_can_resolve_partitions(token) for segment in segments for token in segment):
        return False
    mentioned = False
    for tokens in segments:
        if not any(token_can_resolve_partitions(token) for token in tokens):
            continue
        mentioned = True
        if not partition_segment_is_read_only(tokens):
            return True
    # A mention that disappeared during tokenization is ambiguous and therefore blocked.
    return not mentioned


def partition_violation(payload: dict[str, Any], *, shell_only: bool = False) -> bool:
    tool = normalized_tool(payload.get("tool_name"))
    if tool in SHELL_TOOLS:
        return shell_writes_partitions(command_from(payload))
    if shell_only:
        return False
    if tool in FILE_TOOLS:
        return tool in {"edit", "write"} and any(is_partitions_path(path) for path in path_targets(payload))
    if tool in PATCH_TOOLS:
        command = command_from(payload)
        return any(is_partitions_path(path) for path in patch_targets(command))
    return False


def emit_permission(decision: str, reason: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": decision,
                    "permissionDecisionReason": reason,
                }
            },
            separators=(",", ":"),
        )
    )


def guard_secrets(payload: dict[str, Any] | None, error: str | None) -> bool:
    reason = error or (secret_violation(payload or {}) if payload is not None else "unknown payload error")
    if not reason:
        return False
    emit_permission(
        "deny",
        "Blocked by the repository secret guard: "
        + reason
        + ". Do not read or copy the value. The sole key-path exception is an unchained espsecure sign_data invocation.",
    )
    return True


def guard_partitions(payload: dict[str, Any], *, shell_only: bool = False) -> bool:
    if not partition_violation(payload, shell_only=shell_only):
        return False
    invariant = (
        "partitions.csv write: nvs@0x9000 offset and size must remain unchanged or an OTA can silently "
        "erase WiFi, MQTT, and X10A configuration"
    )
    emit_permission(
        "deny",
        invariant
        + ". Project hooks cannot safely express the required ask decision. Do not retry through another shell path; "
        "prepare the patch for an explicitly authorized maintainer to apply manually.",
    )
    return True


def guard_production_ota(payload: dict[str, Any]) -> bool:
    reason = production_ota_violation(payload)
    if not reason:
        return False
    emit_permission("deny", "Blocked by the role-pinned OTA gate: " + reason + ".")
    return True


def run_pre_tool_guards(args: argparse.Namespace) -> int:
    payload, error = read_payload(fail_closed=True)
    if guard_secrets(payload, error):
        return 0
    assert payload is not None
    if guard_production_ota(payload):
        return 0
    guard_partitions(payload, shell_only=args.partition_shell_only)
    return 0


def eligible_format_path(root: Path, target: str) -> Path | None:
    path = Path(target).expanduser()
    if not path.is_absolute():
        path = root / path
    path = path.resolve(strict=False)
    try:
        relative = path.relative_to(root)
    except ValueError:
        return None
    parts = relative.parts
    if not parts or path.suffix not in {".cpp", ".hpp"}:
        return None
    if parts[0] == "main" and len(parts) >= 2 and parts[1] != "def":
        return path
    if parts[0] == "test":
        return path
    return None


def run_format(_: argparse.Namespace) -> int:
    payload, _ = read_payload(fail_closed=False)
    if not payload or shutil.which("clang-format") is None:
        return 0
    tool = normalized_tool(payload.get("tool_name"))
    targets = path_targets(payload)
    if tool in PATCH_TOOLS:
        targets.extend(patch_targets(command_from(payload)))
    root = HOOK_ROOT
    for target in dict.fromkeys(targets):
        path = eligible_format_path(root, target)
        if path is not None and path.is_file():
            subprocess.run(["clang-format", "-i", str(path)], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return 0


def run_capabilities(_: argparse.Namespace) -> int:
    payload, _ = read_payload(fail_closed=False)
    root = HOOK_ROOT
    print(f"daikin-altherma-esp32 capabilities ({root}):")
    docker = shutil.which("docker")
    docker_ok = False
    if docker:
        try:
            docker_ok = subprocess.run(
                [docker, "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5, check=False
            ).returncode == 0
        except subprocess.SubprocessError:
            docker_ok = False
    print("  + Docker daemon: firmware builds available" if docker_ok else "  - No Docker daemon: firmware build unavailable")
    esptool = shutil.which("esptool") or shutil.which("esptool.py")
    ports = []
    for pattern in ("cu.usbmodem*", "ttyUSB*", "ttyACM*"):
        ports.extend(str(path) for path in Path("/dev").glob(pattern))
    if esptool and ports:
        print("  + esptool and serial device present: local USB work may be possible after explicit authorization")
    elif esptool:
        print("  ~ esptool present, no serial device detected")
    else:
        print("  - No esptool: USB flashing unavailable")
    host = any(shutil.which(tool) for tool in ("cmake", "g++", "clang++"))
    print("  + Host C++ toolchain: mock tests available" if host else "  - No host C++ toolchain: rely on CI")
    return 0


def run_subagent_context(_: argparse.Namespace) -> int:
    payload, _ = read_payload(fail_closed=False)
    payload = payload or {}
    root = HOOK_ROOT
    agent_type = str(payload.get("agent_type") or "subagent")
    print("<repository-subagent-context>")
    print(f"Project root: {root}")
    print(f"Agent type: {agent_type}")
    print("Work only inside the scope assigned by the parent. Treat other worktree changes as another agent's work.")
    print("Review agents remain read-only; writing agents use explicit file ownership and report changed files plus checks.")
    print("Never read credentials/private keys. Never edit generated main/def profiles. partitions.csv needs maintainer review.")
    print("Put hardware-free logic in main/logic with host tests; do not claim build, flash, device, or UI evidence not observed.")
    print("</repository-subagent-context>")
    return 0


CRASH_TRIAGE_PATTERN = re.compile(
    r"crash|absturz|abgestürzt|abgestuerzt|core ?dump|coredump|panic|watchdog|brownout|brown-out|"
    r"boot ?loop|bootloop|reboot ?loop|neustart|rebootet|reset ?reason|kein netz|nicht erreichbar|"
    r"unreachable|offline|hängt|haengt|wedge|ghost.?assoc",
    re.IGNORECASE,
)

CRASH_TRIAGE_REMINDER = """<crash-triage-reminder>
The prompt looks like a report of a crashed / rebooting / unreachable daikin-altherma-esp32.
Before concluding anything:

1. Run the `device-triage` skill rather than hand-rolling curl calls.
2. Read durable log history when an explicitly configured external syslog collector is available;
   do not assume a backend, MCP, stream schema, broker deployment, or Kubernetes environment. Check
   `/status.syslog`, reconstruct boots from backwards jumps in the uptime prefix, and keep absence
   bounded because crash capture starts before Wi-Fi/syslog delivery is available. Without an
   accessible collector, state that events preceding the RAM ring cannot be reconstructed.
3. Read `fault` before calling it a crash. `reason=usb` plus `fault=false` is a normal USB reset, and
   an orphan flash coredump can raise a banner after an unrelated boot.
4. Verify claims: fetch `/coredump` when status says it exists, and check whether missing current
   status fields prove that the board runs an older build than the source being inspected.
</crash-triage-reminder>"""


def run_prompt_context(_: argparse.Namespace) -> int:
    payload, _ = read_payload(fail_closed=False)
    prompt = (payload or {}).get("prompt", "")
    if isinstance(prompt, str) and CRASH_TRIAGE_PATTERN.search(prompt):
        print(CRASH_TRIAGE_REMINDER)
    return 0


def run_stop_logic_tests(_: argparse.Namespace) -> int:
    payload, _ = read_payload(fail_closed=False)
    payload = payload or {}
    if payload.get("stop_hook_active") is True:
        return 0
    root = HOOK_ROOT
    if shutil.which("git"):
        unstaged = subprocess.run(
            ["git", "-C", str(root), "diff", "--quiet", "--", "main/", "test/"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode
        staged = subprocess.run(
            ["git", "-C", str(root), "diff", "--cached", "--quiet", "--", "main/", "test/"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode
        untracked = subprocess.run(
            ["git", "-C", str(root), "ls-files", "--others", "--exclude-standard", "--", "main/", "test/"],
            check=False,
            capture_output=True,
            text=True,
        )
        if unstaged == 0 and staged == 0 and untracked.returncode == 0 and not untracked.stdout.strip():
            return 0
    if not any(shutil.which(tool) for tool in ("cmake", "g++", "clang++")):
        return 0
    script = root / "scripts/run-mock-tests.sh"
    if not script.is_file():
        return 0
    try:
        result = subprocess.run(
            [str(script)],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
            timeout=540,
        )
        if result.returncode == 0:
            return 0
        output = (result.stdout + result.stderr).strip()
    except subprocess.TimeoutExpired as exc:
        output = f"host logic tests exceeded 540 seconds: {exc}"
    reason = ("Host logic tests failed — fix before stopping:\n" + output)[:4000]
    print(json.dumps({"decision": "block", "reason": reason}, separators=(",", ":")))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    guards = subparsers.add_parser("pre-tool-guards")
    guards.add_argument("--partition-shell-only", action="store_true")
    guards.set_defaults(func=run_pre_tool_guards)
    formatter = subparsers.add_parser("format")
    formatter.set_defaults(func=run_format)
    capabilities = subparsers.add_parser("capabilities")
    capabilities.set_defaults(func=run_capabilities)
    subagent = subparsers.add_parser("subagent-context")
    subagent.set_defaults(func=run_subagent_context)
    prompt_context = subparsers.add_parser("prompt-context")
    prompt_context.set_defaults(func=run_prompt_context)
    stop_tests = subparsers.add_parser("stop-logic-tests")
    stop_tests.set_defaults(func=run_stop_logic_tests)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
