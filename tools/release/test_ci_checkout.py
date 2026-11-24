#!/usr/bin/env python3
"""Offline partial-clone regressions; optionally prove the witness in a read-only Linux image."""
from __future__ import annotations

import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid

import local_checks


PROJECT = Path(__file__).resolve().parents[2]


class CheckoutTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="daikin-ci-checkout-")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name).resolve()
        self.origin = self.directory / "origin"
        self.origin.mkdir()
        self.env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull,
                    "GIT_CONFIG_SYSTEM": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
                    "GIT_CONFIG_COUNT": "0", "BASH_ENV": ""}
        # Exercise fetches against our file:// fixture even inside the offline release snapshot.
        self.env.pop("GIT_NO_LAZY_FETCH", None)
        self.git(self.origin, "init", "-q", "--template=")
        self.git(self.origin, "config", "user.name", "Fixture")
        self.git(self.origin, "config", "user.email", "fixture@example.invalid")
        self.git(self.origin, "config", "commit.gpgsign", "false")
        self.git(self.origin, "config", "core.hooksPath", str(self.directory / "no-hooks"))
        self.git(self.origin, "config", "uploadpack.allowFilter", "true")
        self.git(self.origin, "branch", "-M", "main")
        self.write("main/http_config.cpp", b"original configuration source\n")
        self.write("main/http_deadline.cpp", b"original deadline source\n")
        # This deleted binary must remain absent even after hydrating the historical source.
        self.write("historical-firmware.bin", bytes(range(256)) * 1024)
        self.commit()
        self.witness_commit = self.git(self.origin, "rev-parse", "HEAD").decode().strip()
        self.witness_blob = self.git(self.origin, "rev-parse", "HEAD:main/http_config.cpp").decode().strip()
        self.deadline_blob = self.git(self.origin, "rev-parse", "HEAD:main/http_deadline.cpp").decode().strip()
        self.binary_blob = self.git(self.origin, "rev-parse", "HEAD:historical-firmware.bin").decode().strip()
        self.git(self.origin, "tag", "-a", "v1.2.3", "-m", "fixture release")
        (self.origin / "historical-firmware.bin").unlink()
        self.write("main/http_config.cpp", b"current configuration source\n")
        self.write("main/http_deadline.cpp", b"current deadline source\n")
        for name in ("scripts/prepare-ci-history.py", "scripts/next-version.sh"):
            destination = self.origin / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(PROJECT / name, destination)
        # Preserve the actual consumer expression and substitute only its fixture history pin.
        deadline = (PROJECT / "test/test_http_deadline_runtime.mjs").read_text()
        deadline, count = re.subn(r'const originalCommit = "[0-9a-f]{40}"',
                                  f'const originalCommit = "{self.witness_commit}"', deadline)
        self.assertEqual(count, 1)
        self.write("test/test_http_deadline_runtime.mjs", deadline.encode())
        self.write("version.txt", b"1.0.0\n")
        self.commit()

    def write(self, name, content):
        path = self.origin / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def git(self, repository, *arguments, check=True, env=None):
        result = subprocess.run(["git", "-c", "core.fsmonitor=false", "-C", str(repository),
                                 *arguments], env=env or self.env, capture_output=True, timeout=30)
        if check:
            self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
            return result.stdout
        return result

    def commit(self):
        self.git(self.origin, "add", "-A")
        self.git(self.origin, "commit", "-qm", "fixture: checkout input")

    def clone(self, name, *options):
        clone = self.directory / name
        # file:// is intentional: Git bypasses partial-clone filtering for a local-path clone.
        self.git(self.directory, "clone", "-q", *options, self.origin.as_uri(), str(clone))
        return clone

    def actions_checkout(self, name):
        # Match the pinned checkout action's init + full-history fetch + exact checkout sequence,
        # rather than assuming git clone configures the same promisor/lazy-fetch behavior.
        checkout = self.directory / name
        checkout.mkdir()
        self.git(checkout, "init", "-q", "--template=")
        self.git(checkout, "remote", "add", "origin", self.origin.as_uri())
        self.git(checkout, "-c", "protocol.version=2", "fetch", "--no-tags", "--prune",
                 "--no-recurse-submodules", "--filter=blob:none", "origin",
                 "+refs/heads/*:refs/remotes/origin/*", "+refs/tags/*:refs/tags/*")
        self.git(checkout, "checkout", "--detach", "origin/main")
        self.assertEqual(self.git(checkout, "config", "remote.origin.promisor").strip(), b"true")
        return checkout

    def missing(self, clone):
        output = self.git(clone, "rev-list", "--objects", "--all", "--missing=print").decode()
        return {line[1:] for line in output.splitlines() if line.startswith("?")}

    def prepare(self, clone, *arguments):
        return subprocess.run([sys.executable, str(clone / "scripts/prepare-ci-history.py"), *arguments],
                              cwd=clone, env=self.env, capture_output=True, text=True, timeout=30)

    def test_offline_release_checkout_fetches_merge_tree_and_comparison_blobs(self):
        base = self.git(self.origin, "rev-parse", "HEAD").decode().strip()
        path = "main/format.cpp"
        self.write(path, b"first archived formatter source\n")
        self.commit()
        old_source = self.git(self.origin, "rev-parse", f"HEAD:{path}").decode().strip()
        release_base = self.git(self.origin, "rev-parse", "HEAD").decode().strip()
        self.write(path, b"newly inherited formatter source\n")
        self.commit()
        partial = self.clone("release-partial", "--filter=blob:none", "--no-checkout")
        self.git(partial, "checkout", "--detach", base)
        tested = self.git(partial, "rev-parse", "origin/main").decode().strip()
        tree = self.git(partial, "rev-parse", f"{tested}^{{tree}}").decode().strip()
        new_source = self.git(partial, "rev-parse", f"{tested}:{path}").decode().strip()
        self.assertTrue({old_source, new_source, self.witness_blob, self.deadline_blob, self.binary_blob}
                        <= self.missing(partial))
        local_checks.hydrate_release_trees(partial, self.env, tree, release_base)
        self.assertFalse({old_source, new_source} & self.missing(partial))
        # The caller's runtime-test file can differ from the candidate version.
        (partial / "test/test_http_deadline_runtime.mjs").write_text("different witness binding\n")
        run = self.prepare(partial, "--source-tree", tree)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn(self.witness_commit, run.stdout)
        self.assertTrue({self.witness_blob, self.binary_blob} <= self.missing(partial))
        with local_checks.frozen_checkout(partial, self.env, (tested, tree, release_base),
                                          container_visible=True) as (checkout, offline):
            self.assertEqual((checkout / path).read_bytes(), b"newly inherited formatter source\n")
            self.assertEqual(self.git(checkout, "show", f"HEAD^1:{path}", env=offline),
                             b"first archived formatter source\n")
            self.assertEqual(self.git(checkout, "show", f"{self.witness_commit}:main/http_deadline.cpp",
                                      env=offline), b"original deadline source\n")

    def test_filtered_history_retains_versions_and_hydrates_only_source(self):
        full = self.clone("full")
        partial = self.actions_checkout("partial")
        self.assertEqual(self.git(partial, "config", "remote.origin.partialclonefilter").strip(), b"blob:none")
        self.assertEqual(self.git(partial, "rev-parse", "--is-shallow-repository").strip(), b"false")
        for arguments in (("rev-parse", "HEAD"), ("tag", "--list"),
                          ("rev-list", "--count", "v1.2.3..HEAD"),
                          ("rev-parse", "v1.2.3^{commit}")):
            self.assertEqual(self.git(partial, *arguments), self.git(full, *arguments))
        self.git(partial, "merge-base", "--is-ancestor", self.witness_commit, "HEAD")
        for clone in (full, partial):
            run = subprocess.run(["bash", "scripts/next-version.sh", "--dev"], cwd=clone,
                                 env=self.env, capture_output=True, timeout=10)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(run.stdout.strip(), b"1.2.4-dev.1")
        for name in self.git(full, "ls-files", "-z").decode().split("\0"):
            if name:
                self.assertEqual((partial / name).read_bytes(), (full / name).read_bytes())
        self.assertTrue({self.witness_blob, self.deadline_blob, self.binary_blob} <= self.missing(partial))
        run = self.prepare(partial)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("hydrated " + self.witness_commit + ":main/http_deadline.cpp", run.stdout)
        self.assertNotIn(self.deadline_blob, self.missing(partial))
        self.assertTrue({self.witness_blob, self.binary_blob} <= self.missing(partial))
        # No reachable remote, no lazy fetching: reads must use the already hydrated object.
        self.git(partial, "remote", "set-url", "origin", (self.directory / "unavailable").as_uri())
        offline = {**self.env, "GIT_NO_LAZY_FETCH": "1", "GIT_TERMINAL_PROMPT": "0"}
        self.assertEqual(self.git(partial, "show", self.witness_commit + ":main/http_deadline.cpp",
                                  env=offline), b"original deadline source\n")
        self.assertNotEqual(self.git(partial, "cat-file", "-e", self.binary_blob,
                                     check=False, env=offline).returncode, 0)
        image = os.environ.get("DAIKIN_CI_CHECKOUT_DOCKER_IMAGE")
        if image:
            self.assertRegex(image, r"^[A-Za-z0-9][A-Za-z0-9./:@_-]*$")
            # Send a synthetic checkout as build context: a remote Docker daemon need not share
            # the host's temporary directories. No project worktree or credential files enter it.
            context = self.directory / "readonly-proof"
            shutil.copytree(partial, context / "repository")
            (context / "Dockerfile").write_text(
                f"FROM {image}\nUSER root\nCOPY repository /repository\n"
                "RUN chmod -R a+rX /repository\n"
                f"LABEL io.daikin-altherma-esp32.checkout-fixture={uuid.uuid4().hex}\n")
            build = subprocess.run(["docker", "build", "--quiet", "--network", "none",
                                    "--pull=false", str(context)],
                                   capture_output=True, text=True, timeout=120)
            self.assertEqual(build.returncode, 0, build.stderr)
            proof_image = build.stdout.strip()
            self.assertRegex(proof_image, r"^sha256:[0-9a-f]{64}$")
            try:
                read = subprocess.run([
                    "docker", "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
                    "--security-opt", "no-new-privileges", "--user", "65534:65534",
                    "--env", "GIT_NO_LAZY_FETCH=1", "--entrypoint", "git", proof_image,
                    "-c", "safe.directory=/repository", "-C", "/repository", "show",
                    self.witness_commit + ":main/http_deadline.cpp",
                ], capture_output=True, timeout=30)
                self.assertEqual(read.returncode, 0, read.stderr.decode(errors="replace"))
                self.assertEqual(read.stdout, b"original deadline source\n")
            finally:
                cleanup = subprocess.run(["docker", "image", "rm", proof_image],
                                         capture_output=True, timeout=30)
                self.assertEqual(cleanup.returncode, 0, cleanup.stderr.decode(errors="replace"))
            print("CI checkout: hydrated witness read in network-disabled, read-only Linux container")

    def test_missing_witness_and_changed_consumer_fail_closed(self):
        clone = self.clone("partial", "--filter=blob:none")
        self.git(clone, "remote", "set-url", "origin", (self.directory / "unavailable").as_uri())
        self.assertNotEqual(self.prepare(clone).returncode, 0)
        runner = clone / "test/test_http_deadline_runtime.mjs"
        runner.write_text(runner.read_text().replace(":main/http_deadline.cpp", ":main/other.cpp"))
        run = self.prepare(clone)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("historical read changed", run.stderr)

    def test_shallow_checkout_is_refused(self):
        clone = self.clone("shallow", "--depth=1")
        run = self.prepare(clone)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("shallow checkout refused", run.stderr)


if __name__ == "__main__":
    unittest.main()
