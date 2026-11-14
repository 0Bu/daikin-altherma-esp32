#!/usr/bin/env python3
"""Resolve completed PR checks for the identical tree and comparison range on main."""

import io
from datetime import datetime
import os
import re
import subprocess
import sys
import zipfile

from dev_publication import REPOSITORY, SHA, WORKFLOW, Unproven, gh_api, git, positive

CHECKOUT = "3d3c42e5aac5ba805825da76410c181273ba90b1"
CHECKOUT_STEPS = {"mechanical_gates": "Check out tested source", "build": f"Run actions/checkout@{CHECKOUT}"}
MECHANICAL = {
    "host": "Run host-side logic tests with coverage",
    "sanitizer": "Run sanitizer-backed hostile-input properties",
    "runtime": "Run runtime and transport integration harness",
    "browser": "Run rendered browser and accessibility gate",
    "contracts": "Test firmware source-boundary contracts",
    "ota": "Verify the OTA contracts still have teeth",
    "release_tests": "Test CI trust boundaries and release contracts",
    "coredump": "Exercise the pinned coredump decoder with synthetic evidence",
}


def sha(value):
    return isinstance(value, str) and SHA.fullmatch(value) is not None


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def passed_steps(job):
    if job.get("status") != "completed" or job.get("conclusion") != "success":
        raise Unproven("required PR job did not succeed")
    steps = job["steps"]
    names = [step["name"] for step in steps]
    if len(names) != len(set(names)):
        raise Unproven("ambiguous PR job steps")
    return {step["name"] for step in steps
            if step.get("status") == "completed" and step.get("conclusion") == "success"}


def checked_out_merge(archive, name, job, pr):
    logs = [row for row in archive.infolist() if re.fullmatch(rf"[0-9]+_{name}\.txt", row.filename)]
    systems = [row for row in archive.infolist() if row.filename == f"{name}/system.txt"]
    if (len(logs) != 1 or len(systems) != 1 or logs[0].file_size > 2_000_000
            or systems[0].file_size > 8192):
        raise Unproven("missing or oversized PR runner log")
    system = archive.read(systems[0]).decode().splitlines()
    definition = f" Job defined at: {REPOSITORY}/{WORKFLOW}@refs/pull/{pr}/merge"
    runner = job["runner_name"]
    if (not any(line.endswith(definition) for line in system)
            or not re.fullmatch(r"GitHub Actions [0-9]+", runner)
            or not any(line.endswith(f" start running on the hosted runner: {runner}") for line in system)):
        raise Unproven("unrecognized PR workflow or runner")
    step = next(step for step in job["steps"] if step["name"] == CHECKOUT_STEPS[name])
    first, last = instant(step["started_at"]), instant(step["completed_at"])
    with archive.open(logs[0]) as source:
        prefix = source.read(64 * 1024).decode("utf-8-sig", errors="replace")
    lines = prefix.splitlines()
    groups = [i for i, line in enumerate(lines)
              if line.endswith(f" ##[group]Run actions/checkout@{CHECKOUT}")
              and first <= instant(line.partition(" ")[0]).replace(microsecond=0) <= last]
    if len(groups) != 1:
        raise Unproven("missing or ambiguous runner checkout block")
    start = groups[0]
    end = next(i for i in range(start + 1, len(lines) - 1)
               if lines[i].endswith(" [command]/usr/bin/git log -1 --format=%H"))
    timestamp, _, tested = lines[end + 1].partition(" ")
    ref = f"refs/remotes/pull/{pr}/merge"
    fetch = (" [command]/usr/bin/git -c protocol.version=2 fetch --no-tags --prune --no-recurse-submodules "
             f"origin +refs/heads/*:refs/remotes/origin/* +refs/tags/*:refs/tags/* +{tested}:{ref}")
    checkout = " [command]/usr/bin/git checkout --progress --force " + ref
    if (not sha(tested) or not any(line.endswith(fetch) for line in lines[start:end])
            or not any(line.endswith(checkout) for line in lines[start:end])
            or not first <= instant(lines[start].partition(" ")[0]) <= instant(timestamp)
            or instant(timestamp).replace(microsecond=0) > last):
        raise Unproven("runner log did not bind the actual PR checkout")
    return tested


def resolve(before, target, api=gh_api):
    if not sha(before) or not sha(target) or before == "0" * 40:
        raise Unproven("missing push comparison")
    if git("rev-list", "--parents", "-n", "1", target, limit=256).decode().split() != [target, before]:
        raise Unproven("push does not contain a single squash merge")
    tree = git("rev-parse", "--verify", f"{target}^{{tree}}", limit=128).decode("ascii").strip()
    workflow = git("show", f"{before}:{WORKFLOW}")
    if workflow != git("show", f"{target}:{WORKFLOW}"):
        raise Unproven("checks use a changed workflow")

    repo = f"repos/{REPOSITORY}"
    prs = api(f"{repo}/commits/{target}/pulls?per_page=10")
    landed = [pr for pr in prs if pr.get("merge_commit_sha") == target
              and pr.get("state") == "closed" and pr.get("merged_at")
              and pr.get("base", {}).get("ref") == "main"
              and pr.get("base", {}).get("repo", {}).get("full_name") == REPOSITORY]
    if len(landed) != 1 or not positive(landed[0].get("number")):
        raise Unproven("no unique merged PR for this commit")
    pr = landed[0]
    head, branch = pr["head"]["sha"], pr["head"]["ref"]
    if not sha(head) or not branch or pr["head"]["repo"]["full_name"] != REPOSITORY:
        raise Unproven("invalid or foreign PR head")
    # Read the PR head as data to check its workflow bytes. Never execute its source here.
    git("fetch", "--no-tags", "--no-write-fetch-head", "origin", head, limit=8192)
    git("merge-base", "--is-ancestor", before, head)
    if workflow != git("show", f"{head}:{WORKFLOW}"):
        raise Unproven("PR head has a different workflow")

    actions = f"{repo}/actions"
    runs = api(f"{actions}/workflows/build.yml/runs?event=pull_request&head_sha={head}&per_page=10")["workflow_runs"]
    # GitHub may clear a run's pull_requests array after merge. Match the same-repository branch,
    # then bind the PR number and exact synthetic merge SHA using its GitHub-hosted checkout log.
    matches = [run for run in runs if run.get("head_sha") == head and run.get("head_branch") == branch
               and run.get("head_repository", {}).get("full_name") == REPOSITORY]
    if not matches:
        raise Unproven("no GitHub workflow bound to this head and branch")
    run = matches[0]
    run_id, attempt = run.get("id"), run.get("run_attempt")
    if (not positive(run_id) or not positive(attempt) or run.get("event") != "pull_request"
            or run.get("repository", {}).get("full_name") != REPOSITORY
            or run.get("path", "").split("@")[0] != WORKFLOW
            or run.get("status") != "completed" or run.get("conclusion") != "success"
            or instant(run["updated_at"]) > instant(pr["merged_at"])):
        raise Unproven("latest bound PR workflow did not succeed before merge")
    jobs = api(f"{actions}/runs/{run_id}/attempts/{attempt}/jobs?per_page=100")["jobs"]
    required_jobs, passed = {}, {}
    for name in ("mechanical_gates", "build"):
        known = [job for job in jobs if job.get("name") == name and job.get("run_id") == run_id
                 and job.get("run_attempt") == attempt and job.get("head_sha") == head]
        if len(known) != 1 or not positive(known[0].get("id")):
            raise Unproven("missing or ambiguous required PR job")
        required_jobs[name] = known[0]
        passed[name] = passed_steps(known[0])
    mechanical, build = passed["mechanical_gates"], passed["build"]
    if not {CHECKOUT_STEPS["mechanical_gates"], "Bind tested merge tree to the reviewed head"} <= mechanical:
        raise Unproven("PR workflow did not bind its checkout")
    compile_proved = {CHECKOUT_STEPS["build"], "Bind compiled merge tree to the reviewed head",
                      "Compile firmware without flashable artifacts", "Enforce non-flashable PR artifact boundary"} <= build
    archive = api(f"{actions}/runs/{run_id}/attempts/{attempt}/logs", binary=True)
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        tested = checked_out_merge(zipped, "mechanical_gates", required_jobs["mechanical_gates"], pr["number"])
        if compile_proved and checked_out_merge(zipped, "build", required_jobs["build"], pr["number"]) != tested:
            raise Unproven("compile job ran on a different merge commit")
    commit = api(f"{repo}/git/commits/{tested}")
    if (commit.get("sha") != tested or commit["tree"]["sha"] != tree
            or [parent["sha"] for parent in commit["parents"]] != [before, head]):
        raise Unproven("tested merge object has a different tree or parents")

    # Browser routing has the same before/tree on both events. Conditional mutation steps are
    # reusable only when GitHub records that they ran successfully.
    checks = {key for key, name in MECHANICAL.items() if name in mechanical}
    if compile_proved:
        checks.add("cjson")
    print(f"Using completed checks {', '.join(sorted(checks))} for Git tree {tree} "
          f"from PR #{pr['number']} run {run_id}/{attempt}",
          file=sys.stderr)
    return sorted(checks)


def main():
    try:
        if len(sys.argv) != 4 or sys.argv[1] != "resolve":
            raise Unproven("usage: premerge_checks.py resolve BEFORE TARGET")
        if os.environ.get("GITHUB_RUN_ATTEMPT", "1") != "1":
            raise Unproven("full rerun keeps the normal recovery checks")
        print(" " + " ".join(resolve(*sys.argv[2:])) + " ")
    except (ValueError, TypeError, KeyError, AttributeError, OSError, StopIteration, zipfile.BadZipFile,
            subprocess.TimeoutExpired) as error:
        print(f"Pre-merge check evidence unavailable ({type(error).__name__}); run the checks normally",
              file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
