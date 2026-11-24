#!/usr/bin/env python3
"""Run the local release suite and retain proof for the exact pushed commit."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from threading import Event
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
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        pass
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                raise
            if result:
                raise subprocess.CalledProcessError(result, command)
    finally:
        print(f"Local release phase ended: {label} ({time.monotonic() - started:.1f}s)", flush=True)


def check_candidate(checkout, offline, build_checkout, build_env, runtime_checkout, runtime_env,
                    tested, base, head):
    # Each worker has its own source checkout. The build worker also owns the
    # Docker host checks, so only one of our compilation containers runs at a time.
    host_checks = ["bash", "scripts/run-local-release-checks.sh"]
    host_failed = Event()

    def build_and_check(log):
        command = ["scripts/idf-docker.sh", "--with-host-tests", "bash", "-ec",
                   'test "$(git rev-parse HEAD)" = "$1"; exec scripts/ci-build-all.sh '
                   '--compile-only --source-sha "$2"', "release-checks", tested, head]
        run_phase("ESP32-S3 and real cJSON", command, build_checkout, build_env, timeout=1800, log=log)
        if host_failed.is_set():
            return
        subprocess.run(["scripts/check-nonflashable-artifacts.sh", "dist"],
                       cwd=build_checkout, env=build_env, stdout=log, stderr=subprocess.STDOUT,
                       timeout=60, check=True)
        if not host_failed.is_set():
            run_phase("Docker host checks", [*host_checks, "docker", base, head],
                      build_checkout, build_env, timeout=1800, log=log)

    def check_runtime(log):
        try:
            run_phase("runtime and transport tests", [*host_checks, "runtime", base, head],
                      runtime_checkout, runtime_env, timeout=1800, log=log)
        except BaseException:
            host_failed.set()
            raise

    with ExitStack() as logs:
        build_log = logs.enter_context(tempfile.TemporaryFile(mode="w+b", dir=checkout.parent))
        runtime_log = logs.enter_context(tempfile.TemporaryFile(mode="w+b", dir=checkout.parent))
        try:
            with ThreadPoolExecutor(max_workers=2) as workers:
                build = workers.submit(build_and_check, build_log)
                runtime = workers.submit(check_runtime, runtime_log)
                try:
                    # The OTA gate reuses these two host results on the landed tree.
                    started = time.monotonic()
                    local.verify(checkout, expected_head=tested, require_receipt=True, fresh=True)
                    print(f"Local release host receipt checks: {time.monotonic() - started:.1f}s", flush=True)
                    run_phase("host audits and release contracts", [*host_checks, "audits", base, head],
                              checkout, offline, timeout=1800)
                    build.result()
                    runtime.result()
                except BaseException:
                    host_failed.set()
                    raise
        finally:
            for phase_log in (build_log, runtime_log):
                phase_log.seek(0)
                sys.stdout.flush()
                shutil.copyfileobj(phase_log, sys.stdout.buffer)
                sys.stdout.buffer.flush()
    # Keep all host work out of the browser frame and input measurements.
    browser_env = dict(offline)
    if context := browser_env.pop("DAIKIN_RELEASE_BROWSER_DOCKER_CONTEXT", ""):
        browser_env["DOCKER_CONTEXT"] = context
    run_phase("headless Chromium and WebKit", [*host_checks, "browser", base, head],
              checkout, browser_env, timeout=2100)


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
        # Hook self-tests compare protected operations against the configured repository.
        # A local clone initially points origin at the source directory instead.
        local.git(checkout, offline, "remote", "set-url", "origin", f"https://github.com/{REPO}.git")
        # Validate the historical fixture from the actual merged test source without lazy fetching.
        subprocess.run([sys.executable, "scripts/prepare-ci-history.py"], cwd=checkout,
                       env=offline, check=True)
        with local.frozen_checkout(root, env, identity, scratch_parent=scratch_parent,
                                   container_visible=True) as (build_checkout, build_env):
            with local.frozen_checkout(checkout, offline, identity) as (runtime_checkout, runtime_env):
                check_candidate(checkout, offline, build_checkout, build_env, runtime_checkout, runtime_env,
                                tested, base, head)
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
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        sys.exit(f"Local release checks failed: {error}")


if __name__ == "__main__":
    main()
