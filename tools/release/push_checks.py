#!/usr/bin/env python3
"""Run the local release suite and retain proof for the exact pushed commit."""

import json
import subprocess
import sys
import time

import local_checks as local
from verify_push_proof import PREFIX, REPO


def run(root, expected_head):
    env = local.check_environment()
    # Git hooks inherit repository-local variables. Drop them before checking the frozen tree.
    local.git(root, env, "fetch", "--no-tags", "origin", "refs/heads/main:refs/remotes/origin/main")
    actual = local.source(root, env)
    head, tree, _ = actual
    if head != expected_head:
        raise local.CheckError("release checks require the exact commit being pushed")
    base = local.git(root, env, "rev-parse", "refs/remotes/origin/main").strip()
    derived_tree = local.git(root, env, "merge-tree", "--write-tree", base, head).strip()
    if not local.SHA.fullmatch(derived_tree):
        raise local.CheckError("cannot determine the candidate merge tree")
    # Keep the complete comparison range even when the branch has several commits.
    # Work under the ignored build tree so Colima can mount the isolated source.
    if actual[2] == base and tree == derived_tree:
        tested = head
    else:
        identity_env = dict(env, GIT_AUTHOR_NAME="Local release checks",
                            GIT_AUTHOR_EMAIL="release-checks@example.invalid",
                            GIT_COMMITTER_NAME="Local release checks",
                            GIT_COMMITTER_EMAIL="release-checks@example.invalid")
        tested = local.git(root, identity_env, "-c", "commit.gpgsign=false", "commit-tree", derived_tree,
                           "-p", base, "-p", head, "-m", "Frozen local release checks").strip()
    identity = (tested, derived_tree, base)
    # A partial clone can fetch the committed historical witness while still online. The
    # candidate repeats the check inside the offline snapshot before the runtime suite.
    subprocess.run([sys.executable, "scripts/prepare-ci-history.py"], cwd=root, env=env, check=True)
    local.hydrate_parent_coverage(root, env, base)
    scratch_parent = root / "build"
    scratch_parent.mkdir(exist_ok=True)
    if scratch_parent.is_symlink():
        raise local.CheckError("local release checks require a real build directory")
    with local.frozen_checkout(root, env, identity, scratch_parent=scratch_parent,
                               container_visible=True) as (checkout, offline):
        # Validate the historical fixture from the actual merged test source without lazy fetching.
        subprocess.run([sys.executable, "scripts/prepare-ci-history.py"], cwd=checkout,
                       env=offline, check=True)
        # These two checks use the same private receipt as official bench and production OTA.
        local.verify(checkout, expected_head=tested, require_receipt=True, fresh=True)
        subprocess.run(["bash", "scripts/run-local-release-checks.sh", base, head],
                       cwd=checkout, env=offline, check=True)
        subprocess.run(["scripts/idf-docker.sh", "--with-host-tests", "bash", "-ec",
                        'test "$(git rev-parse HEAD)" = "$1"; exec scripts/ci-build-all.sh '
                        '--compile-only --source-sha "$2"', "release-checks", tested, head],
                       cwd=checkout, env=offline, check=True)
        subprocess.run(["scripts/check-nonflashable-artifacts.sh", "dist"],
                       cwd=checkout, env=offline, check=True)
    if local.source(root, env) != actual:
        raise local.CheckError("checkout changed during local release checks")
    if local.git(root, env, "ls-remote", "--refs", "origin", "refs/heads/main").split() != [
        base, "refs/heads/main"
    ]:
        raise local.CheckError("origin/main changed during local release checks")
    return {"schema": 1, "repo": REPO, "head": head, "tree": derived_tree, "base": base,
            "finished_at": int(time.time())}


def main():
    if len(sys.argv) != 2 or not local.SHA.fullmatch(sys.argv[1]):
        sys.exit("usage: push_checks.py EXACT_HEAD_SHA")
    try:
        proof = run(local.ROOT, sys.argv[1])
        print("Local release checks passed. Post the following line as a new maintainer PR comment.")
        print(PREFIX + json.dumps(proof, sort_keys=True, separators=(",", ":")))
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        sys.exit(f"Local release checks failed: {error}")


if __name__ == "__main__":
    main()
