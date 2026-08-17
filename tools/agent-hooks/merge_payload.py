#!/usr/bin/env python3
"""Parse merge-tool hook payloads into a repository-bound, unambiguous target."""

from __future__ import annotations

import json
import fnmatch
import os
from pathlib import Path
import posixpath
import re
import shlex
import sys
from typing import Any
from urllib.parse import unquote, urlsplit


ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=(.*)$", re.DOTALL)
STATIC_VARIABLE = re.compile(r"^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$")
SHELLS = {"bash", "dash", "sh", "zsh"}
SHELL_EXTGLOB = re.compile(r"(?<!\\)[@+?!*]\([^)]*\)")
PROJECT_ROOT = Path(__file__).resolve().parents[2]
CANONICAL_CREDENTIAL_WRAPPER = (PROJECT_ROOT / "scripts/gh-with-git-credentials.sh").resolve()
RELATIVE_CREDENTIAL_WRAPPERS = {
    "scripts/gh-with-git-credentials.sh",
    "./scripts/gh-with-git-credentials.sh",
}
MCP_BLOCKED_ACTIONS = {
    "merge_pull_request",
    "enable_auto_merge",
    "enable_pull_request_auto_merge",
    "enqueue_pull_request",
}

GH_BUILTIN_COMMANDS = {
    "alias",
    "api",
    "auth",
    "browse",
    "codespace",
    "completion",
    "config",
    "extension",
    "gist",
    "help",
    "issue",
    "org",
    "pr",
    "project",
    "release",
    "repo",
    "run",
    "search",
    "secret",
    "ssh-key",
    "status",
    "variable",
    "workflow",
}


def executable(token: str) -> str:
    return token.rsplit("/", 1)[-1]


def canonical_github_api_path(token: str, *, allow_relative: bool = True) -> str | None:
    """Return a policy-comparable GitHub API path for static endpoint tokens."""
    decoded = token
    for _ in range(3):
        expanded = unquote(decoded)
        if expanded == decoded:
            break
        decoded = expanded
    try:
        if allow_relative and decoded.startswith("/"):
            path = decoded.split("#", 1)[0].split("?", 1)[0]
        else:
            parsed = urlsplit(decoded)
            if parsed.scheme or parsed.netloc:
                if parsed.scheme.lower() not in {"http", "https"}:
                    return None
                if (parsed.hostname or "").lower() != "api.github.com":
                    return None
                path = parsed.path
            elif allow_relative:
                path = parsed.path
            else:
                return None
    except ValueError:
        return None
    normalized = posixpath.normpath("/" + path.lstrip("/"))
    if normalized in {"/", "/."}:
        return ""
    return normalized.strip("/")


def dynamic_repository_api_token(token: str) -> bool:
    """Identify a shell-expanded repository API endpoint before URL normalization hides it."""
    decoded = token
    for _ in range(3):
        expanded = unquote(decoded)
        if expanded == decoded:
            break
        decoded = expanded
    path_candidate = decoded
    if "?" in path_candidate:
        path_part, query = path_candidate.split("?", 1)
        if re.fullmatch(r"[A-Za-z0-9_.~%=&:+,@/-]*", query):
            path_candidate = path_part
    return re.search(r"(?:^|/)repos/", path_candidate, flags=re.IGNORECASE) is not None and re.search(
        r"[$`*?\[\]{}()@!+]", path_candidate
    ) is not None


def normalize_shell_source(source: str) -> str:
    def decode(match: re.Match[str]) -> str:
        try:
            return bytes(match.group(1), "utf-8").decode("unicode_escape")
        except UnicodeDecodeError:
            return match.group(0)

    normalized = re.sub(r"\\\r?\n", "", source)
    normalized = re.sub(r"\$'((?:[^'\\]|\\.)*)'", decode, normalized)
    normalized = re.sub(r'\$"((?:[^"\\]|\\.)*)"', r'"\1"', normalized)
    previous = None
    while previous != normalized:
        previous = normalized
        normalized = re.sub(r"\{([^{}]+)\.\.\1\}", r"\1", normalized)
    return normalized


def tokenize(source: str) -> list[str]:
    lexer = shlex.shlex(source.replace("\n", " ; "), posix=True, punctuation_chars=";&|(){}!<>")
    lexer.whitespace_split = True
    lexer.commenters = ""
    return list(lexer)


def split_segments(tokens: list[str]) -> list[list[str]]:
    segments: list[list[str]] = [[]]
    for token in tokens:
        if re.fullmatch(r"[;&|(){}!<>]+", token):
            if segments[-1]:
                segments.append([])
            continue
        segments[-1].append(token)
    return [segment for segment in segments if segment]


def assignments_before(tokens: list[str], end: int) -> dict[str, str]:
    values: dict[str, str] = {}
    for token in tokens[:end]:
        match = ASSIGNMENT.fullmatch(token)
        if match:
            values[token.split("=", 1)[0]] = match.group(1)
    return values


def resolve_static_token(token: str, assignments: dict[str, str]) -> tuple[str, bool]:
    """Resolve one exact shell variable reference without evaluating shell code."""
    match = STATIC_VARIABLE.fullmatch(token)
    if match:
        name = match.group(1) or match.group(2)
        value = assignments.get(name)
        if value is None or re.search(r"[$`;&|<>()]", value):
            return token, False
        return value, True
    if re.search(r"[$`]", token):
        return token, False
    return token, True


def static_assignment_segments(segments: list[list[str]]) -> list[tuple[list[str], dict[str, str]]]:
    """Carry only unconditional, assignment-only shell segments into later argv parsing."""
    persistent: dict[str, str] = {}
    resolved: list[tuple[list[str], dict[str, str]]] = []
    for segment in segments:
        if segment and all(ASSIGNMENT.fullmatch(token) for token in segment):
            for token in segment:
                name, value = token.split("=", 1)
                if not re.search(r"[$`;&|<>()]", value):
                    persistent[name] = value
                else:
                    persistent.pop(name, None)
            continue
        values = dict(persistent)
        values.update(assignments_before(segment, len(segment)))
        resolved.append((segment, values))
    return resolved


def split_repo_spec(spec: str, explicit_host: str = "") -> tuple[str, str, str]:
    value = spec.strip().removesuffix(".git")
    host = explicit_host.strip()
    if not value:
        return "", host, ""
    if re.search(r"[\s$`{};&|<>]", value) or "://" in value:
        return "", host, f"repository target is not a static [HOST/]OWNER/REPO value: {spec}"
    parts = [part for part in value.split("/") if part]
    if len(parts) == 3:
        repo_host, owner, name = parts
        if host and host.lower() != repo_host.lower():
            return "", host, "conflicting repository host selectors"
        host = repo_host
    elif len(parts) == 2:
        owner, name = parts
    else:
        return "", host, f"repository target is not OWNER/REPO: {spec}"
    return f"{owner}/{name}", host, ""


def normalize_gh_args(args: list[str], assignments: dict[str, str]) -> tuple[list[str], str, str, str]:
    repo_spec = assignments.get("GH_REPO", "")
    host = assignments.get("GH_HOST", "")
    normalized: list[str] = []
    index = 0
    while index < len(args):
        token = args[index]
        if token in {"-R", "--repo", "--hostname"}:
            if index + 1 >= len(args):
                return [], "", host, f"{token} has no value"
            value = args[index + 1]
            if token == "--hostname":
                host = value
            else:
                repo_spec = value
            index += 2
            continue
        if token.startswith("--repo="):
            repo_spec = token.split("=", 1)[1]
            index += 1
            continue
        if token.startswith("-R") and token != "-R":
            repo_spec = token[2:]
            index += 1
            continue
        if token.startswith("--hostname="):
            host = token.split("=", 1)[1]
            index += 1
            continue
        normalized.append(token)
        index += 1
    repo, host, error = split_repo_spec(repo_spec, host)
    return normalized, repo, host, error


def parse_pr_selector(args: list[str]) -> tuple[str, str, str, str, str]:
    positional: list[str] = []
    expected_head = ""
    squash_count = 0
    index = 0
    while index < len(args):
        token = args[index]
        if token == "--":
            return "", "", "", "gh pr merge does not permit an option terminator", expected_head
        if token == "--match-head-commit" or token.startswith("--match-head-commit="):
            if expected_head:
                return "", "", "", "gh pr merge needs exactly one --match-head-commit", expected_head
            if token == "--match-head-commit":
                if index + 1 >= len(args):
                    return "", "", "", f"{token} has no value", ""
                value = args[index + 1]
                index += 2
            else:
                value = token.split("=", 1)[1]
                index += 1
            if not re.fullmatch(r"[0-9a-fA-F]{40}", value):
                return "", "", "", "--match-head-commit must be a full static 40-hex SHA", ""
            expected_head = value.lower()
            continue
        if token == "--squash":
            squash_count += 1
            if squash_count > 1:
                return "", "", "", "gh pr merge needs exactly one --squash", expected_head
            index += 1
            continue
        if token.startswith("-"):
            return "", "", "", f"unsupported gh pr merge option: {token}", expected_head
        positional.append(token)
        index += 1
    if len(positional) > 1:
        return "", "", "", "gh pr merge has more than one positional target", expected_head
    if not positional:
        return "", "", "", "gh pr merge needs one explicit numeric pull request", expected_head
    selector = positional[0]
    if not re.fullmatch(r"\d+", selector):
        return "", "", "", f"merge selector must be a static numeric pull request: {selector}", expected_head
    if not expected_head:
        return selector, "", "", "gh pr merge needs exactly one full --match-head-commit", ""
    if squash_count != 1:
        return selector, "", "", "gh pr merge needs exactly one --squash", expected_head
    return selector, "", "", "", expected_head


def canonical_api_host_option(args: list[str]) -> str:
    """Require the exact host flag supported by the canonical gh api merge transport."""
    values: list[str] = []
    index = 0
    while index < len(args):
        token = args[index]
        if token == "--hostname":
            if index + 1 >= len(args):
                return "--hostname has no value"
            values.append(args[index + 1])
            index += 2
            continue
        if token.startswith("--hostname="):
            return "canonical REST merge needs the separate --hostname github.com arguments"
        if token in {"--repo", "-R"} or token.startswith(("--repo=", "-R")):
            return "canonical REST merge binds its repository only through the endpoint"
        index += 1
    if values != ["github.com"]:
        return "canonical REST merge needs exactly --hostname github.com"
    return ""


def is_canonical_credential_wrapper(token: str) -> bool:
    """Bind privileged local GitHub actions to this worktree's reviewed wrapper."""
    return token in RELATIVE_CREDENTIAL_WRAPPERS or (
        os.path.isabs(token) and Path(token) == CANONICAL_CREDENTIAL_WRAPPER
    )


def token_may_be_gh(token: str) -> bool:
    base = executable(token)
    canonical_wrapper = is_canonical_credential_wrapper(token)
    return base == "gh" or canonical_wrapper or (
        any(character in base for character in "*?[") and fnmatch.fnmatchcase("gh", base)
    )


def gh_api_endpoint(args: list[str]) -> tuple[str, str]:
    """Return the one positional `gh api` endpoint, excluding option values."""
    value_options = {
        "--cache",
        "-F",
        "--field",
        "-H",
        "--header",
        "--hostname",
        "--input",
        "-q",
        "--jq",
        "-X",
        "--method",
        "-p",
        "--preview",
        "-f",
        "--raw-field",
        "-t",
        "--template",
    }
    boolean_options = {
        "--allow-escape-sequences",
        "-i",
        "--include",
        "--paginate",
        "--silent",
        "--slurp",
        "--verbose",
        "--help",
    }
    long_value_prefixes = tuple(f"{option}=" for option in value_options if option.startswith("--"))
    short_value_options = {"-F", "-H", "-q", "-X", "-p", "-f", "-t"}
    endpoints: list[str] = []
    index = 0
    while index < len(args):
        token = args[index]
        if token in value_options:
            if index + 1 >= len(args):
                return "", f"{token} has no value"
            index += 2
            continue
        if token.startswith(long_value_prefixes) or any(
            token.startswith(option) and token != option for option in short_value_options
        ):
            index += 1
            continue
        if token in boolean_options:
            index += 1
            continue
        if token.startswith("-"):
            return "", f"unsupported gh api option while binding the endpoint: {token}"
        endpoints.append(token)
        index += 1
    if len(endpoints) != 1:
        return "", "gh api needs exactly one static positional endpoint"
    return endpoints[0], ""


def gh_api_write_error(args: list[str], *, graphql: bool) -> str:
    """Reject API writes unless they were consumed by the exact merge parser above.

    `gh api` defaults to GET without input fields and POST when fields or an input body are
    supplied.  Explicit GET/HEAD remains read-only.  A static GraphQL query is also read-only even
    though gh transports it with POST; every mutation or uninspectable query source fails closed.
    """
    methods: list[str] = []
    has_fields_or_input = False
    index = 0
    while index < len(args):
        token = args[index]
        if token in {"--method", "-X"}:
            if index + 1 >= len(args):
                return f"{token} has no value"
            methods.append(args[index + 1])
            index += 2
            continue
        if token.startswith("--method="):
            methods.append(token.split("=", 1)[1])
            index += 1
            continue
        if token.startswith("-X") and token != "-X":
            methods.append(token[2:])
            index += 1
            continue
        if token in {"-f", "--raw-field", "-F", "--field", "--input"}:
            if index + 1 >= len(args):
                return f"{token} has no value"
            has_fields_or_input = True
            index += 2
            continue
        if token.startswith(("--raw-field=", "--field=", "--input=")) or (
            token.startswith(("-f", "-F")) and token not in {"-f", "-F"}
        ):
            has_fields_or_input = True
        index += 1

    if len(methods) > 1:
        return "gh api request has conflicting or repeated methods"
    method = methods[0].upper() if methods else ("POST" if has_fields_or_input else "GET")
    if not re.fullmatch(r"[A-Z]+", method):
        return "gh api method is not a static HTTP verb"
    if graphql:
        joined = " ".join(args)
        if re.search(r"\bmutation\b", joined, flags=re.IGNORECASE):
            return "GraphQL mutations are not allowed through the credential-bound API surface"
        if method not in {"GET", "HEAD", "POST"}:
            return f"GraphQL method {method} is not a provably read-only request"
        return ""
    if method not in {"GET", "HEAD"}:
        return f"gh api method {method} is not read-only and is not the canonical merge action"
    return ""


def token_may_be_curl(token: str) -> bool:
    base = executable(token)
    return base == "curl" or (
        any(character in base for character in "*?[") and fnmatch.fnmatchcase("curl", base)
    )


def curl_github_write_error(tokens: list[str]) -> str:
    """Allow curl against api.github.com only when its complete static shape is GET/HEAD."""
    methods: list[str] = []
    body = False
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token in {"-X", "--request"}:
            if index + 1 >= len(tokens):
                return f"curl {token} has no value"
            methods.append(tokens[index + 1])
            index += 2
            continue
        if token.startswith("--request="):
            methods.append(token.split("=", 1)[1])
            index += 1
            continue
        if token.startswith("-X") and token != "-X":
            methods.append(token[2:])
            index += 1
            continue
        if token in {
            "-d",
            "--data",
            "--data-ascii",
            "--data-binary",
            "--data-raw",
            "--data-urlencode",
            "-F",
            "--form",
            "--form-string",
            "-T",
            "--upload-file",
            "--json",
        }:
            if index + 1 >= len(tokens):
                return f"curl {token} has no value"
            body = True
            index += 2
            continue
        if token in {"-K", "--config"} or token.startswith(("--config=", "-K")):
            return "curl config files cannot be inspected for GitHub API mutations"
        if token.startswith(
            (
                "--data=",
                "--data-ascii=",
                "--data-binary=",
                "--data-raw=",
                "--data-urlencode=",
                "--form=",
                "--form-string=",
                "--upload-file=",
                "--json=",
            )
        ) or (token.startswith(("-d", "-F", "-T")) and token not in {"-d", "-F", "-T"}):
            body = True
        index += 1
    if len(methods) > 1:
        return "curl GitHub API request has conflicting or repeated methods"
    method = methods[0].upper() if methods else ("POST" if body else "GET")
    if not re.fullmatch(r"[A-Z]+", method):
        return "curl GitHub API method is not a static HTTP verb"
    if method not in {"GET", "HEAD"} or body:
        return f"curl GitHub API method {method} is not statically read-only"
    return ""


def curl_uses_config_file(tokens: list[str]) -> bool:
    """Return true when curl can import an uninspected URL/method/body from a file."""
    return any(
        token in {"-K", "--config"}
        or token.startswith("--config=")
        or re.fullmatch(r"-[^-]*K.*", token) is not None
        for token in tokens
    )


def curl_target_tokens(tokens: list[str]) -> list[str]:
    """Include positional URLs and the value forms accepted by curl's --url option."""
    targets = list(tokens)
    for index, token in enumerate(tokens):
        if token == "--url" and index + 1 < len(tokens):
            targets.append(tokens[index + 1])
        elif token.startswith("--url="):
            targets.append(token.split("=", 1)[1])
    return targets


def execution_context_is_ambiguous(source: str) -> bool:
    """Reject merge wrappers that can change argv or cwd after static target binding."""
    normalized = normalize_shell_source(source)
    try:
        tokens = tokenize(normalized)
    except ValueError:
        return True
    if re.search(
        r"(?:^|[^A-Za-z0-9_./-])(?:command\s+)?(?:cd|pushd|popd)(?:[^A-Za-z0-9_./-]|$)",
        normalized,
    ):
        return True
    if re.search(r"\bgit\b[\s\S]*\b(?:push|remote|config)\b", normalized):
        return True
    if re.search(
        r"\b(?:printf|read|declare|typeset|export|unset)\b[\s\S]*\bGH_(?:REPO|HOST)\b",
        normalized,
    ):
        return True
    for index, token in enumerate(tokens):
        base = executable(token)
        if token in {"GH_REPO", "GH_HOST"}:
            return True
        if base in {"source", "."}:
            return True
        if base == "git" and any(
            candidate in {"push", "remote", "config"} for candidate in tokens[index + 1 :]
        ):
            return True
        if ".git/config" in token.replace("\\", "/"):
            return True
        if base in {"cd", "pushd", "popd"}:
            return True
        if base == "env":
            following = tokens[index + 1 :]
            if any(
                option in {"-C", "--chdir"}
                or option.startswith("--chdir=")
                or (option.startswith("-C") and option != "-C")
                for option in following
            ):
                return True
        if base == "sudo":
            following = tokens[index + 1 :]
            if any(
                option in {"-D", "--chdir"}
                or option.startswith("--chdir=")
                or (option.startswith("-D") and option != "-D")
                for option in following
            ):
                return True
    if re.search(r"\bGH_(?:REPO|HOST)=", normalized) and re.search(r"[;&|]|\n", normalized):
        return True
    mergeish = re.search(r"\bpr\s+merge\b|mergePullRequest|/pulls?/.*/merge", normalized)
    if mergeish and (
        re.search(r"(?:^|[\s;&|(){}!])xargs(?:[\s;&|(){}!]|$)", normalized)
        or re.search(r"(?:^|[\s;&|(){}!])find\b[^;\n]*\s-exec(?:dir)?\b", normalized)
        or re.search(r"(?:^|[\s;&|(){}!])parallel(?:[\s;&|(){}!]|$)", normalized)
    ):
        return True
    return False


def merge_action_count(source: str) -> int:
    normalized = normalize_shell_source(source)
    count = (
        len(re.findall(r"\bpr\s+merge\b", normalized))
        + sum(
            len(re.findall(action, normalized))
            for action in (
                "mergePullRequest",
                "mergeBranch",
                "enqueuePullRequest",
                "enablePullRequestAutoMerge",
            )
        )
    )
    try:
        tokens = tokenize(normalized)
    except ValueError:
        tokens = []
    for token in tokens:
        path = canonical_github_api_path(token)
        if path is not None and (
            re.fullmatch(r"repos/[^/]+/[^/]+/pulls/[^/]+/merge(?:-async)?", path, flags=re.IGNORECASE)
            or re.fullmatch(r"repos/[^/]+/[^/]+/merges", path, flags=re.IGNORECASE)
        ):
            count += 1
    # A merge and any second gh/curl invocation in one tool call are not atomic even when that
    # second invocation appears read-only or constructs its mutation target dynamically.
    github_invocations = len(
        re.findall(
            r"(?<![A-Za-z0-9_.-])(?:gh|curl|gh-with-git-credentials[.]sh)(?=\s)",
            normalized,
        )
    )
    if count == 1 and github_invocations > 1:
        return 2
    return count


def parse_gh(tokens: list[str], index: int, inherited: dict[str, str]) -> dict[str, str] | None:
    assignments = dict(inherited)
    assignments.update(assignments_before(tokens, index))
    raw_args = tokens[index + 1 :]
    normalized, repo, host, error = normalize_gh_args(raw_args, assignments)
    if error:
        return {"action": "gh merge", "selector": "", "repo": repo, "host": host, "error": error}
    if normalized[:2] == ["pr", "revert"]:
        return {
            "action": "gh pr revert",
            "selector": "",
            "repo": repo,
            "host": host,
            "error": "gh pr revert creates a pull request outside the reviewed exact PR-create contract",
        }
    if normalized[:2] == ["issue", "transfer"]:
        return {
            "action": "gh issue transfer",
            "selector": "",
            "repo": repo,
            "host": host,
            "error": "gh issue transfer accepts an independently hosted repository target and is unsupported",
        }
    if normalized[:2] in (["pr", "create"], ["pr", "new"]):
        if normalized[:2] == ["pr", "new"] or not is_canonical_credential_wrapper(tokens[index]):
            return {
                "action": "gh pr create",
                "selector": "",
                "repo": repo,
                "host": host,
                "error": (
                    "PR creation must use this repository's reviewed credential wrapper and exact "
                    "noninteractive form"
                ),
            }
        # The canonical wrapper performs the exact argv, checked-out-head, and pushed-head checks
        # before credential lookup. Keep a non-merge action so payload cwd/workdir resolution below
        # can also prove that a relative wrapper token names this worktree's actual script.
        return {
            "action": "gh pr create",
            "selector": "",
            "repo": repo,
            "host": host,
            "error": "",
            "credential_wrapper": tokens[index],
        }
    if normalized[:2] == ["pr", "merge"]:
        selector, _, _, error, expected_head = parse_pr_selector(normalized[2:])
        error = (
            "gh pr merge may activate auto-merge or a merge queue; use the canonical synchronous REST merge path"
        )
        return {
            "action": "gh pr merge",
            "selector": selector,
            "repo": repo,
            "host": host,
            "error": error,
            "expected_head": expected_head,
            "credential_wrapper": tokens[index]
            if executable(tokens[index]) == "gh-with-git-credentials.sh"
            else "",
        }
    if normalized and normalized[0] == "pr" and not is_canonical_credential_wrapper(tokens[index]):
        read_only_pr_commands = {"checks", "diff", "list", "status", "view"}
        if len(normalized) < 2 or normalized[1] not in read_only_pr_commands:
            return {
                "action": "direct gh pr action",
                "selector": "",
                "repo": repo,
                "host": host,
                "error": (
                    "direct gh pr actions must be statically read-only; mutations require this "
                    "repository's reviewed credential wrapper"
                ),
            }
    if normalized and normalized[0] == "api":
        endpoint_token, endpoint_error = gh_api_endpoint(normalized[1:])
        if endpoint_error:
            return {
                "action": "gh api target",
                "selector": "",
                "repo": repo,
                "host": host,
                "error": endpoint_error,
            }
        api_paths = [canonical_github_api_path(token) for token in normalized[1:]]
        endpoint_path = canonical_github_api_path(endpoint_token)
        has_graphql_target = endpoint_path is not None and endpoint_path.lower() == "graphql"
        joined = " ".join(normalized[1:])
        if any(dynamic_repository_api_token(token) for token in normalized[1:]) or (
            has_graphql_target and re.search(r"[$`*?\[\]]", joined)
        ):
            return {
                "action": "dynamic gh api mutation target",
                "selector": "",
                "repo": repo,
                "host": host,
                "error": "dynamic GitHub API endpoints or GraphQL inputs cannot be proved read-only",
            }
        if has_graphql_target and (
            "--input" in normalized[1:]
            or any(token.startswith("--input=") for token in normalized[1:])
            or any("@" in token for token in normalized[1:])
        ):
            return {
                "action": "gh api graphql input",
                "selector": "",
                "repo": repo,
                "host": host,
                "error": "file-backed GraphQL input cannot be inspected or bound to one reviewed pull request",
            }
        if has_graphql_target and re.search(r"\bmutation\b", joined, flags=re.IGNORECASE):
            return {
                "action": "gh api graphql mutation",
                "selector": "",
                "repo": repo,
                "host": host,
                "error": "GraphQL mutations are not allowed through the credential-bound API surface",
            }
        for path in api_paths:
            if path is None:
                continue
            branch_merge = re.fullmatch(r"repos/([^/]+)/([^/]+)/merges", path, flags=re.IGNORECASE)
            if branch_merge:
                api_repo = f"{branch_merge.group(1)}/{branch_merge.group(2)}"
                return {
                    "action": "gh api branch merge",
                    "selector": "",
                    "repo": api_repo,
                    "host": host,
                    "error": "direct branch merge cannot bind one reviewed pull request and head SHA",
                }
            match = re.fullmatch(
                r"repos/([^/]+)/([^/]+)/pulls/(\d+)/merge(?:-async)?",
                path,
                flags=re.IGNORECASE,
            )
            if match:
                api_repo = f"{match.group(1)}/{match.group(2)}"
                if path.lower().endswith("/merge-async"):
                    return {
                        "action": "gh api asynchronous merge",
                        "selector": match.group(3),
                        "repo": api_repo,
                        "host": host,
                        "error": "asynchronous merge can activate direct merge or a merge queue",
                    }
                method_values: list[str] = []
                field_values: list[str] = []
                endpoint_count = 0
                option_index = 0
                api_args = normalized[1:]
                parse_error = ""
                while option_index < len(api_args):
                    option = api_args[option_index]
                    option_path = canonical_github_api_path(option)
                    if option_path is not None and re.fullmatch(
                        r"repos/[^/]+/[^/]+/pulls/\d+/merge", option_path
                    ):
                        if option != option_path:
                            parse_error = "canonical REST merge endpoint must use one plain relative path"
                            break
                        endpoint_count += 1
                        option_index += 1
                        continue
                    if option == "--method":
                        if option_index + 1 >= len(api_args):
                            parse_error = "canonical REST merge --method has no value"
                            break
                        method_values.append(api_args[option_index + 1])
                        option_index += 2
                        continue
                    if option == "-f":
                        if option_index + 1 >= len(api_args):
                            parse_error = "canonical REST merge -f has no value"
                            break
                        field_values.append(api_args[option_index + 1])
                        option_index += 2
                        continue
                    parse_error = f"unsupported canonical REST merge argument: {option}"
                    break
                fields: dict[str, str] = {}
                if not parse_error:
                    for field in field_values:
                        if "=" not in field:
                            parse_error = f"canonical REST merge field has no value: {field}"
                            break
                        key, value = field.split("=", 1)
                        if key in fields:
                            parse_error = f"canonical REST merge field is duplicated: {key}"
                            break
                        fields[key] = value
                expected_head = fields.get("sha", "").lower()
                if not parse_error and endpoint_count != 1:
                    parse_error = "canonical REST merge needs exactly one endpoint"
                if not parse_error and method_values != ["PUT"]:
                    parse_error = "canonical REST merge needs exactly --method PUT"
                if not parse_error and set(fields) != {"sha", "merge_method"}:
                    parse_error = "canonical REST merge needs exactly sha and merge_method fields"
                if not parse_error and not re.fullmatch(r"[0-9a-f]{40}", expected_head):
                    parse_error = "canonical REST merge sha must be a full static 40-hex SHA"
                if not parse_error and fields.get("merge_method") != "squash":
                    parse_error = "canonical REST merge needs merge_method=squash"
                if not parse_error:
                    parse_error = canonical_api_host_option(raw_args)
                if not parse_error and not is_canonical_credential_wrapper(tokens[index]):
                    parse_error = (
                        "local merge actions must use this repository's reviewed credential wrapper"
                    )
                return {
                    "action": "gh api merge",
                    "selector": match.group(3),
                    "repo": api_repo,
                    "host": host,
                    "error": parse_error,
                    "expected_head": expected_head,
                    "credential_wrapper": tokens[index]
                    if is_canonical_credential_wrapper(tokens[index])
                    else "",
                }
            lowered_path = path.lower()
            if (
                "repos/" in lowered_path
                and "/pulls/" in lowered_path
                and lowered_path.endswith(("/merge", "/merge-async"))
            ):
                return {
                    "action": "gh api merge",
                    "selector": "",
                    "repo": repo,
                    "host": host,
                    "error": "gh api merge endpoint contains a dynamic or invalid target",
                }
        write_error = gh_api_write_error(normalized[1:], graphql=has_graphql_target)
        if write_error:
            return {
                "action": "gh api write",
                "selector": "",
                "repo": repo,
                "host": host,
                "error": write_error,
            }
    if normalized and not normalized[0].startswith("-") and normalized[0] not in GH_BUILTIN_COMMANDS:
        return {
            "action": "gh alias or extension",
            "selector": "",
            "repo": repo,
            "host": host,
            "error": f"unknown gh subcommand may be a configured merge alias: {normalized[0]}",
        }
    return None


def shell_executes_stdin(source: str) -> bool:
    shell = r"(?:bash|dash|sh|zsh)"
    if re.search(rf"\|[^|;\n]*\b{shell}\b", source):
        return True
    if re.search(rf"\b{shell}\b[^;&|\n]*(?:<<<|(?<!<)<(?!<))", source):
        return True
    return re.search(rf"\b{shell}\b(?:\s+-[^;&|\n]*)*\s+-s(?:\s|$)", source) is not None


def find_merge(source: str, depth: int = 0) -> dict[str, str] | None:
    if depth > 5:
        return {"action": "shell merge", "selector": "", "repo": "", "host": "", "error": "shell nesting exceeds parser limit"}
    source = normalize_shell_source(source)
    graphql_action = next(
        (
            action
            for action in (
                "mergePullRequest",
                "mergeBranch",
                "enqueuePullRequest",
                "enablePullRequestAutoMerge",
            )
            if action in source
        ),
        "",
    )
    if graphql_action:
        return {
            "action": "GraphQL merge activation",
            "selector": "",
            "repo": "",
            "host": "",
            "error": f"GraphQL {graphql_action} uses an unbindable node-id target",
        }
    try:
        source_tokens = tokenize(source)
        segments = split_segments(source_tokens)
    except ValueError:
        source_tokens = []
        segments = []
    assigned_segments = static_assignment_segments(segments)
    resolved_source_tokens: list[str] = []
    source_has_curl = False
    for segment, assignments in assigned_segments:
        for token in segment:
            resolved, static = resolve_static_token(token, assignments)
            resolved_source_tokens.append(resolved)
            if static and token_may_be_curl(resolved):
                source_has_curl = True
    curl_targets = curl_target_tokens(resolved_source_tokens)
    curl_api_paths = [canonical_github_api_path(token, allow_relative=False) for token in curl_targets]
    if source_has_curl and curl_uses_config_file(resolved_source_tokens):
        return {
            "action": "curl config input",
            "selector": "",
            "repo": "",
            "host": "",
            "error": "curl config files cannot be inspected for GitHub API mutations",
        }
    if source_has_curl and any(dynamic_repository_api_token(token) for token in resolved_source_tokens):
        return {
            "action": "dynamic curl GitHub API target",
            "selector": "",
            "repo": "",
            "host": "",
            "error": "dynamic GitHub API endpoints cannot be bound to one reviewed pull request",
        }
    if source_has_curl and any(
        path is not None
        and (
            re.fullmatch(r"repos/[^/]+/[^/]+/pulls/\d+/merge(?:-async)?", path, flags=re.IGNORECASE)
            or re.fullmatch(r"repos/[^/]+/[^/]+/merges", path, flags=re.IGNORECASE)
        )
        for path in curl_api_paths
    ):
        return {
            "action": "curl REST merge",
            "selector": "",
            "repo": "",
            "host": "",
            "error": "curl merge endpoint cannot bind the reviewed head SHA",
        }
    if source_has_curl and any(
        path is not None and path.lower() == "graphql" for path in curl_api_paths
    ):
        return {
            "action": "curl GraphQL request",
            "selector": "",
            "repo": "",
            "host": "",
            "error": "curl GraphQL input cannot be proved read-only or bound to one reviewed pull request",
        }
    if source_has_curl and any(path is not None for path in curl_api_paths):
        return {
            "action": "curl GitHub API request",
            "selector": "",
            "repo": "",
            "host": "",
            "error": (
                "direct curl GitHub API requests are unsupported; use the reviewed credential wrapper"
            ),
        }
    if SHELL_EXTGLOB.search(source) and re.search(
        r"\bpr\s+merge\b|mergePullRequest|/pulls?/.*/merge", source
    ):
        return {
            "action": "shell merge",
            "selector": "",
            "repo": "",
            "host": "",
            "error": "shell extglob prevents static merge executable/target binding",
        }
    if shell_executes_stdin(source):
        return {"action": "shell stdin", "selector": "", "repo": "", "host": "", "error": "stdin-executed shell cannot be bound to one merge target"}
    substitutions = re.findall(r"(?<!\\)`([^`]*)`", source, flags=re.DOTALL)
    substitutions += re.findall(r"(?<!\\)\$\(([^()]*)\)", source, flags=re.DOTALL)
    for substitution in substitutions:
        nested = find_merge(substitution, depth + 1)
        if nested is not None:
            return nested
    if not source_tokens and source.strip():
        return {"action": "shell merge", "selector": "", "repo": "", "host": "", "error": "shell command is not parseable"}
    for segment, assignments in assigned_segments:
        resolved_segment: list[str] = []
        static_flags: list[bool] = []
        for token in segment:
            resolved, static = resolve_static_token(token, assignments)
            resolved_segment.append(resolved)
            static_flags.append(static)
        for index, token in enumerate(resolved_segment):
            original_token = segment[index]
            base = executable(token)
            if base in SHELLS:
                for flag_index in range(index + 1, len(segment)):
                    flag = segment[flag_index]
                    is_command = flag == "--command" or (
                        flag.startswith("-") and not flag.startswith("--") and "c" in flag[1:]
                    )
                    if is_command and flag_index + 1 < len(segment):
                        nested = find_merge(segment[flag_index + 1], depth + 1)
                        if nested is not None:
                            return nested
                        break
            if base == "env":
                for env_index in range(index + 1, len(segment)):
                    option = segment[env_index]
                    if option in {"-S", "--split-string"} and env_index + 1 < len(segment):
                        nested = find_merge(segment[env_index + 1], depth + 1)
                        if nested is not None:
                            return nested
                    elif option.startswith("-S") and option != "-S":
                        nested = find_merge(option[2:], depth + 1)
                        if nested is not None:
                            return nested
                    elif option.startswith("--split-string="):
                        nested = find_merge(option.split("=", 1)[1], depth + 1)
                        if nested is not None:
                            return nested
            if base == "eval" and index + 1 < len(segment):
                nested = find_merge(" ".join(segment[index + 1 :]), depth + 1)
                if nested is not None:
                    return nested
            if static_flags[index] and token_may_be_gh(token):
                if token != original_token and is_canonical_credential_wrapper(token):
                    return {
                        "action": "dynamic credential wrapper",
                        "selector": "",
                        "repo": "",
                        "host": "",
                        "error": "the credential wrapper must be invoked directly, not through a shell variable",
                    }
                parsed = parse_gh(resolved_segment, index, {})
                if parsed is not None:
                    return parsed
        command_index = next(
            (index for index, token in enumerate(segment) if not ASSIGNMENT.fullmatch(token)),
            None,
        )
        if command_index is not None and (
            not static_flags[command_index]
            or re.search(r"[$`]", segment[command_index]) is not None
        ):
            tail = resolved_segment[command_index + 1 :]
            curl_targets = curl_target_tokens(tail)
            if curl_uses_config_file(tail) or any(
                canonical_github_api_path(token, allow_relative=False) is not None
                for token in curl_targets
            ):
                return {
                    "action": "dynamic curl GitHub API action",
                    "selector": "",
                    "repo": "",
                    "host": "",
                    "error": "a dynamic executable cannot be proved safe for a GitHub API write",
                }
            if "api" in tail:
                return {
                    "action": "dynamic gh api action",
                    "selector": "",
                    "repo": "",
                    "host": "",
                    "error": "a dynamic executable cannot be proved safe for GitHub API access",
                }
            if "pr" in tail:
                pr_index = tail.index("pr")
                subcommand = tail[pr_index + 1] if pr_index + 1 < len(tail) else ""
                read_only_pr_commands = {"checks", "diff", "list", "status", "view"}
                if not subcommand or not static_flags[min(command_index + pr_index + 2, len(static_flags) - 1)] or subcommand not in read_only_pr_commands:
                    return {
                        "action": "dynamic gh pr action",
                        "selector": "",
                        "repo": "",
                        "host": "",
                        "error": (
                            "a dynamic executable cannot be trusted for a mutating GitHub PR action; "
                            "use this repository's reviewed credential wrapper directly"
                        ),
                    }
    if (
        re.search(r"\bpr\s+merge\b|mergePullRequest|/?repos/[^\s'\"]+/pulls/[^\s'\"]+/merge", source)
        or (
            re.search(r"(?:^|[^A-Za-z0-9_])gh(?:[^A-Za-z0-9_]|$)", source)
            and re.search(r"\bpr\b", source)
            and re.search(r"\bmerge\b", source)
        )
    ):
        return {
            "action": "shell merge",
            "selector": "",
            "repo": "",
            "host": "",
            "error": "literal merge operation is present but its executable or target is dynamic",
        }
    return None


def blocked_mcp_activation(tool: str) -> dict[str, str]:
    action = tool.rsplit("__", 1)[-1]
    return {
        "action": f"MCP {action}",
        "selector": "",
        "repo": "",
        "host": "",
        "error": "MCP merge and auto-merge activation tools are unsupported; use the canonical synchronous REST CAS path",
        "expected_head": "",
    }


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 2
    if not isinstance(data, dict):
        return 2
    tool = str(data.get("tool_name") or "")
    tool_input = data.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        return 2
    parsed: dict[str, str] | None = None
    tool_lower = tool.lower()
    if tool_lower.startswith("mcp__") and any(
        tool_lower.endswith(action) for action in MCP_BLOCKED_ACTIONS
    ):
        parsed = blocked_mcp_activation(tool)
    elif tool.lower() in {"bash", "exec_command", "shell", "shell_command"}:
        command_values = [
            str(tool_input[key])
            for key in ("command", "cmd")
            if tool_input.get(key) not in (None, "")
        ]
        distinct_commands = list(dict.fromkeys(command_values))
        command = distinct_commands[0] if len(distinct_commands) == 1 else ""
        parsed = (
            {
                "action": "ambiguous shell tool input",
                "selector": "",
                "repo": "",
                "host": "",
                "error": "conflicting command/cmd fields in merge hook payload",
            }
            if len(distinct_commands) > 1
            else find_merge(command)
        )
        if parsed is not None:
            if merge_action_count(command) > 1:
                parsed["error"] = parsed["error"] or "multiple merge actions cannot be bound atomically"
            elif execution_context_is_ambiguous(command):
                parsed["error"] = parsed["error"] or "merge command changes argv or working directory after target binding"
    if parsed is None:
        parsed = {"action": "", "selector": "", "repo": "", "host": "", "error": ""}
    raw_payload_cwd = data.get("cwd")
    payload_cwd = str(raw_payload_cwd or "")
    if parsed["action"] and tool.lower() in {"bash", "exec_command", "shell", "shell_command"} and (
        not isinstance(raw_payload_cwd, str) or not raw_payload_cwd.strip()
    ):
        parsed["error"] = parsed["error"] or "shell merge hook payload has no execution cwd"
    workdir_values = [
        str(tool_input[key])
        for key in ("workdir", "cwd")
        if tool_input.get(key) not in (None, "")
    ]
    distinct_workdirs = list(dict.fromkeys(workdir_values))
    if len(distinct_workdirs) > 1:
        parsed["action"] = parsed["action"] or "ambiguous shell workdir input"
        parsed["error"] = parsed["error"] or "conflicting workdir/cwd fields in merge hook payload"
    tool_workdir = distinct_workdirs[0] if len(distinct_workdirs) == 1 else ""
    if tool_workdir:
        payload_cwd = os.path.abspath(os.path.join(payload_cwd or os.getcwd(), tool_workdir))
    credential_wrapper = parsed.get("credential_wrapper", "")
    if credential_wrapper:
        wrapper_path = Path(credential_wrapper)
        if not wrapper_path.is_absolute():
            wrapper_path = Path(payload_cwd or os.getcwd()) / wrapper_path
        if wrapper_path.resolve() != CANONICAL_CREDENTIAL_WRAPPER:
            parsed["error"] = parsed["error"] or "merge credential wrapper is not the canonical repository script"
    fields = (
        parsed["action"],
        parsed["selector"],
        payload_cwd,
        parsed["repo"],
        parsed["host"],
        parsed["error"],
        parsed.get("expected_head", ""),
    )
    sys.stdout.write("\0".join(fields) + "\0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
