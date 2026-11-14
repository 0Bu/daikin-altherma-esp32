#!/usr/bin/env python3
"""Run the local release suite and retain proof for the exact pushed commit."""

from concurrent.futures import ThreadPoolExecutor
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time

import local_checks as local
from verify_push_proof import PREFIX, REPO


def run_phase(label, command, checkout, env, *, timeout, log=None):
    started = time.monotonic()
    print(f"Local release phase started: {label}", flush=True)
    try:
        with subprocess.Popen(command, cwd=checkout, env=env, start_new_session=True,
                              stdout=log, stderr=subprocess.STDOUT if log is not None else None) as process:
            try:
                result = process.wait(timeout=timeout)
            except BaseException:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                raise
            if result:
                raise subprocess.CalledProcessError(result, command)
    finally:
        print(f"Local release phase ended: {label} ({time.monotonic() - started:.1f}s)", flush=True)


def check_candidate(checkout, offline, build_checkout, build_env, tested, base, head):
    # The compiler writes sdkconfig, managed components and build outputs. Keep
    # those writes separate from the host gates, some of which inspect Git state.
    command = ["scripts/idf-docker.sh", "--with-host-tests", "bash", "-ec",
               'test "$(git rev-parse HEAD)" = "$1"; exec scripts/ci-build-all.sh '
               '--compile-only --source-sha "$2"', "release-checks", tested, head]
    host_checks = ["bash", "scripts/run-local-release-checks.sh"]
    with tempfile.TemporaryFile(mode="w+b", dir=checkout.parent) as build_log:
        try:
            with ThreadPoolExecutor(max_workers=1) as workers:
                firmware = workers.submit(run_phase, "ESP32-S3 and real cJSON", command,
                                          build_checkout, build_env, timeout=1800, log=build_log)
                # The OTA gate reuses these two host results on the landed tree.
                local.verify(checkout, expected_head=tested, require_receipt=True, fresh=True)
                run_phase("host tests and audits", [*host_checks, "host", base, head],
                          checkout, offline, timeout=1800)
                firmware.result()
        finally:
            # The executor joins the build before reading the log, including on failure.
            build_log.seek(0)
            sys.stdout.flush()
            shutil.copyfileobj(build_log, sys.stdout.buffer)
            sys.stdout.buffer.flush()
    subprocess.run(["scripts/check-nonflashable-artifacts.sh", "dist"],
                   cwd=build_checkout, env=build_env, timeout=60, check=True)
    # Frame and input budgets need an uncontended browser phase. No host gate
    # or firmware compiler from this invocation may still be running.
    run_phase("headless Chromium and WebKit", [*host_checks, "browser", base, head],
              checkout, offline, timeout=2100)


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
    local.hydrate_release_trees(root, env, derived_tree, base)
    # Read the witness pin from the same tree the tests will run. Fetch it while online.
    subprocess.run([sys.executable, "scripts/prepare-ci-history.py", "--source-tree", derived_tree],
                   cwd=root, env=env, check=True)
    scratch_parent = root / "build"
    scratch_parent.mkdir(exist_ok=True)
    if scratch_parent.is_symlink():
        raise local.CheckError("local release checks require a real build directory")
    with local.frozen_checkout(root, env, identity, scratch_parent=scratch_parent,
                               container_visible=True) as (checkout, offline):
        # Validate the historical fixture from the actual merged test source without lazy fetching.
        subprocess.run([sys.executable, "scripts/prepare-ci-history.py"], cwd=checkout,
                       env=offline, check=True)
        with local.frozen_checkout(root, env, identity, scratch_parent=scratch_parent,
                                   container_visible=True) as (build_checkout, build_env):
            check_candidate(checkout, offline, build_checkout, build_env, tested, base, head)
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
