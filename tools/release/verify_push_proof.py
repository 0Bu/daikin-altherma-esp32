#!/usr/bin/env python3
"""Validate a maintainer's local check result without executing any PR source."""

from datetime import datetime, timezone
import json
from pathlib import Path
from functools import partial
import re
import subprocess
import sys


REPO = "0Bu/daikin-altherma-esp32"
MAINTAINER_ID = 4757856
PREFIX = "daikin-local-release-checks "
MAX_AGE = 86400
COMMENTS_PER_PAGE = 10
SHA = re.compile(r"[0-9a-f]{40}")


class ProofError(ValueError):
    pass


def api(path, *, local=False):
    if local:
        client = str(Path(__file__).resolve().parents[2] / "scripts/gh-with-git-credentials.sh")
    else:
        client = "gh"
    result = subprocess.run([client, "api", "--hostname", "github.com", "--method", "GET",
                             f"repos/{REPO}/{path}"],
                            capture_output=True, check=True, timeout=20)
    if len(result.stdout) > 8 * 1024 * 1024:
        raise ProofError("GitHub metadata exceeds the verification limit")
    return json.loads(result.stdout)


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def unique_items(items):
    obj = dict(items)
    if len(obj) != len(items):
        raise ProofError("duplicate proof fields")
    return obj


def require_receipt(number, head, tree, base, *, boundary, query=api):
    # Limit each response and stop as soon as a matching receipt is found.
    since = datetime.fromtimestamp(boundary - MAX_AGE, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    page_number = 1
    while True:
        comments = query(f"issues/{number}/comments?since={since}&per_page={COMMENTS_PER_PAGE}&page={page_number}")
        if not isinstance(comments, list) or len(comments) > COMMENTS_PER_PAGE:
            raise ProofError("invalid GitHub issue comment page")
        for item in comments:
            body = item.get("body") or ""
            if (item.get("user", {}).get("id") != MAINTAINER_ID or item.get("performed_via_github_app")
                    or not body.startswith(PREFIX) or len(body) > 1024):
                continue
            try:
                created = timestamp(item["created_at"])
                updated = timestamp(item["updated_at"])
                receipt = json.loads(body[len(PREFIX):], object_pairs_hook=unique_items)
            except (ValueError, KeyError, AttributeError, TypeError):
                continue
            if not boundary - MAX_AGE <= created == updated <= boundary:
                continue
            if (not isinstance(receipt, dict) or type(receipt.get("schema")) is not int
                    or receipt["schema"] != 1 or receipt.get("repo") != REPO
                    or (receipt.get("head"), receipt.get("tree"), receipt.get("base")) != (head, tree, base)):
                continue
            if type(receipt.get("finished_at")) is not int or not boundary - MAX_AGE <= receipt["finished_at"] <= created:
                continue
            return receipt
        if len(comments) < COMMENTS_PER_PAGE:
            raise ProofError("missing exact local check receipt from the maintainer")
        page_number += 1


def commit(path, query):
    sha = query(path)["object"]["sha"]
    if not SHA.fullmatch(sha):
        raise ProofError("invalid GitHub ref object")
    return sha


def verify_pr(number, head, query=api):
    pr = query(f"pulls/{number}")
    if (not pr.get("state") == "open" or pr["base"]["ref"] != "main"
            or pr["base"]["repo"]["full_name"] != REPO or pr["head"]["sha"] != head):
        raise ProofError("PR does not match the current open head")
    base = commit("git/ref/heads/main", query)
    tested = commit(f"git/ref/pull/{number}/merge", query)
    detail = query(f"git/commits/{tested}")
    if [row["sha"] for row in detail["parents"]] != [base, head] or detail["sha"] != tested:
        raise ProofError("PR merge tree is stale")
    tree = detail["tree"]["sha"]
    if not SHA.fullmatch(tree):
        raise ProofError("invalid PR tree")
    return require_receipt(number, head, tree, base, boundary=datetime.now().timestamp(), query=query)


def verify_landed(target, query=api):
    prs = query(f"commits/{target}/pulls?per_page=100")
    matches = [pr for pr in prs if pr.get("merge_commit_sha") == target and pr.get("merged_at")
               and pr["base"]["ref"] == "main" and pr["base"]["repo"]["full_name"] == REPO]
    if len(matches) != 1:
        raise ProofError("published commit does not have one matching merged PR")
    pr = matches[0]
    landed = query(f"git/commits/{target}")
    parents = [row["sha"] for row in landed["parents"]]
    if landed["sha"] != target or len(parents) != 1:
        raise ProofError("published commit is not a single squash merge")
    tree = landed["tree"]["sha"]
    head = pr["head"]["sha"]
    if not all(SHA.fullmatch(value) for value in (tree, parents[0], head)):
        raise ProofError("invalid landed Git identity")
    return require_receipt(pr["number"], head, tree, parents[0],
                           boundary=timestamp(pr["merged_at"]), query=query)


def main():
    if (len(sys.argv) == 4 and sys.argv[1] in {"pr", "local-pr"}
            and sys.argv[2].isdigit() and SHA.fullmatch(sys.argv[3])):
        verify_pr(int(sys.argv[2]), sys.argv[3], query=partial(api, local=sys.argv[1] == "local-pr"))
    elif len(sys.argv) == 3 and sys.argv[1] == "landed" and SHA.fullmatch(sys.argv[2]):
        verify_landed(sys.argv[2])
    else:
        raise ProofError("invalid receipt verification arguments")
    print("Local release proof verified.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, AttributeError, subprocess.SubprocessError) as error:
        reason = str(error) if isinstance(error, ProofError) else type(error).__name__
        sys.exit(f"Local release proof rejected: {reason}")
