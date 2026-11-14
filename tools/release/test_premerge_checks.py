#!/usr/bin/env python3
"""Exercise the exact-tree CI reuse path with bounded offline GitHub fixtures."""

import io
import unittest
from unittest.mock import patch
import zipfile

import premerge_checks as checks


class PremergeChecksTest(unittest.TestCase):
    base, target, head, tree, tested = (ch * 40 for ch in "abcde")

    def setUp(self):
        self.run = {
            "id": 13, "run_attempt": 2, "head_sha": self.head, "event": "pull_request",
            "status": "completed", "conclusion": "success", "path": checks.WORKFLOW,
            "repository": {"full_name": checks.REPOSITORY},
            "head_repository": {"full_name": checks.REPOSITORY}, "head_branch": "agent/fixture",
            "pull_requests": [], "updated_at": "2026-01-01T00:00:09Z",
        }
        self.pr = {
            "number": 52, "merge_commit_sha": self.target, "state": "closed",
            "merged_at": "2026-01-01T00:00:10Z",
            "base": {"ref": "main", "repo": {"full_name": checks.REPOSITORY}},
            "head": {"sha": self.head, "ref": "agent/fixture", "repo": {"full_name": checks.REPOSITORY}},
        }
        self.commit = {"sha": self.tested, "tree": {"sha": self.tree},
                       "parents": [{"sha": self.base}, {"sha": self.head}]}
        self.mechanical = self.job("mechanical_gates", [
            checks.CHECKOUT_STEPS["mechanical_gates"],
            "Bind tested merge tree to the reviewed head", *checks.MECHANICAL.values(),
        ])
        self.build = self.job("build", [
            checks.CHECKOUT_STEPS["build"], "Bind compiled merge tree to the reviewed head",
            "Compile firmware without flashable artifacts",
            "Enforce non-flashable PR artifact boundary",
        ])
        self.prs, self.runs, self.jobs = [self.pr], [self.run], [self.mechanical, self.build]
        self.git_outputs = {
            ("rev-list", "--parents", "-n", "1", self.target): f"{self.target} {self.base}\n",
            ("rev-parse", "--verify", f"{self.target}^{{tree}}"): self.tree,
            ("show", f"{self.base}:{checks.WORKFLOW}"): "workflow contents",
            ("show", f"{self.target}:{checks.WORKFLOW}"): "workflow contents",
            ("show", f"{self.head}:{checks.WORKFLOW}"): "workflow contents",
            ("fetch", "--no-tags", "--no-write-fetch-head", "origin", self.head): "",
            ("merge-base", "--is-ancestor", self.base, self.head): "",
        }
        substitute = patch.object(checks, "git", side_effect=lambda *args, **_: self.git_outputs[args].encode())
        self.addCleanup(substitute.stop)
        substitute.start()
        self.archive_pr = 52
        self.compile_checkout = self.tested
        self.hosted = True

    def job(self, name, names):
        return dict(name=name, id=1, run_id=13, run_attempt=2, head_sha=self.head,
                    runner_name="GitHub Actions 1", status="completed", conclusion="success", steps=[
            dict(name=step, status="completed", conclusion="success", started_at="2026-01-01T00:00:00Z",
                 completed_at="2026-01-01T00:00:01Z") for step in names])

    def archive(self):
        archive = io.BytesIO()
        pr = self.archive_pr
        ref = f"refs/remotes/pull/{pr}/merge"
        with zipfile.ZipFile(archive, "w") as zipped:
            for name, tested in [("mechanical_gates", self.tested), ("build", self.compile_checkout)]:
                zipped.writestr(f"{name}/system.txt",
                    f"2026-01-01T00:00:00Z Job defined at: {checks.REPOSITORY}/{checks.WORKFLOW}@refs/pull/{pr}/merge\n"
                    + ("2026-01-01T00:00:00Z Job is about to start running on the hosted runner: GitHub Actions 1\n"
                       if self.hosted else "runner is unverified\n"))
                log = [
                    f"##[group]Run actions/checkout@{checks.CHECKOUT}",
                    "[command]/usr/bin/git -c protocol.version=2 fetch --no-tags --prune --no-recurse-submodules "
                    f"origin +refs/heads/*:refs/remotes/origin/* +refs/tags/*:refs/tags/* +{tested}:{ref}",
                    f"[command]/usr/bin/git checkout --progress --force {ref}",
                    "[command]/usr/bin/git log -1 --format=%H",
                    tested,
                ]
                zipped.writestr(f"1_{name}.txt", "".join(f"2026-01-01T00:00:01.492Z {line}\n" for line in log))
        return archive.getvalue()

    def api(self, endpoint, *, binary=False):
        repo = f"repos/{checks.REPOSITORY}"
        match endpoint:
            case path if path == f"{repo}/commits/{self.target}/pulls?per_page=10":
                return self.prs
            case path if path == f"{repo}/actions/workflows/build.yml/runs?event=pull_request&head_sha={self.head}&per_page=10":
                return {"workflow_runs": self.runs}
            case path if path == f"{repo}/actions/runs/13/attempts/2/jobs?per_page=100":
                return {"jobs": self.jobs}
            case path if path == f"{repo}/actions/runs/13/attempts/2/logs" and binary:
                return self.archive()
            case path if path == f"{repo}/git/commits/{self.tested}":
                return self.commit
            case _:
                self.fail(f"unexpected GitHub API request: {endpoint}")

    def resolve(self):
        return checks.resolve(self.base, self.target, self.api)

    def test_exact_success(self):
        self.assertEqual(set(self.resolve()), set(checks.MECHANICAL) | {"cjson"})

    def test_skipped_checks_keep_the_fallback(self):
        for step in self.mechanical["steps"] + self.build["steps"]:
            if step["name"] in {checks.MECHANICAL["coredump"], "Compile firmware without flashable artifacts"}:
                step["conclusion"] = "skipped"
        self.assertEqual(set(self.resolve()), set(checks.MECHANICAL) - {"coredump"})

    def test_completed_run_and_tree_metadata_are_required(self):
        cases = [
            (self.pr, "merge_commit_sha", self.tested),
            (self.run, "conclusion", "cancelled"),
            (self.run, "event", "push"),
            (self.run, "path", ".github/workflows/fake.yml"),
            (self.run, "repository", {"full_name": "other/repo"}),
            (self.run, "head_branch", "other-branch"),
            (self.run, "updated_at", "2026-01-01T00:00:11Z"),
            (self.commit, "parents", [{"sha": self.head}, {"sha": self.base}]),
            (self.commit, "tree", {"sha": self.tested}),
            (self.build, "conclusion", "failure"),
        ]
        for row, field, wrong in cases:
            original = row[field]
            with self.subTest(field=field, wrong=wrong):
                row[field] = wrong
                try:
                    with self.assertRaises(checks.Unproven):
                        self.resolve()
                finally:
                    row[field] = original

    def test_latest_failure_disallows_older_green_run(self):
        self.runs.insert(0, {**self.run, "conclusion": "failure"})
        with self.assertRaises(checks.Unproven):
            self.resolve()

    def test_archive_workflow_and_push_range_are_checked(self):
        for field, wrong in [("archive_pr", 53), ("compile_checkout", self.target), ("hosted", False)]:
            with self.subTest(field=field):
                original = getattr(self, field)
                setattr(self, field, wrong)
                with self.assertRaises(checks.Unproven):
                    self.resolve()
                setattr(self, field, original)
        for key in [("show", f"{self.target}:{checks.WORKFLOW}"),
                    ("show", f"{self.head}:{checks.WORKFLOW}"),
                    ("rev-list", "--parents", "-n", "1", self.target)]:
            with self.subTest(git_command=key):
                old = self.git_outputs[key]
                self.git_outputs[key] = "different"
                try:
                    with self.assertRaises(checks.Unproven):
                        self.resolve()
                finally:
                    self.git_outputs[key] = old


if __name__ == "__main__":
    unittest.main()
