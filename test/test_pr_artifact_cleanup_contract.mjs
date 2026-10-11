// Execute the privileged workflow's actual Bash and jq against offline GitHub API fixtures.
// No checkout, PR code, artifact archive, network request or real credential enters this harness.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workflow = fs.readFileSync(
  new URL("../.github/workflows/cleanup-pr-artifacts.yml", import.meta.url), "utf8");
const repository = { id: 11, full_name: "fixture/firmware" };
const headSha = "a".repeat(40);
const clone = (value) => structuredClone(value);

function shellOf(source) {
  const tail = source.split("      - name: Delete artifacts belonging to the merged PR\n")[1];
  assert.ok(tail, "the tested cleanup step must exist");
  const run = tail.split("        run: |\n")[1];
  assert.ok(run, "the cleanup must remain inline in the trusted default-branch workflow");
  const lines = [];
  for (const line of run.split("\n")) {
    if (line && !line.startsWith("          ")) break;
    lines.push(line.startsWith("          ") ? line.slice(10) : line);
  }
  return lines.join("\n");
}

function fixture({ fork = false, eventName = "workflow_run", associations = true } = {}) {
  const headRepository = fork ? { id: 22, full_name: "fixture-fork/firmware" } : repository;
  const pr = { number: 72, state: "closed", merged: true,
    base: { repo: clone(repository), ref: "main" },
    head: { repo: clone(headRepository), sha: headSha } };
  const association = { number: 72, base: { repo: clone(repository) },
    head: { repo: clone(headRepository), sha: headSha } };
  const run = { id: 77, workflow_id: 88, name: "build", path: ".github/workflows/build.yml",
    event: "pull_request", status: "completed", head_sha: headSha,
    repository: clone(repository), head_repository: clone(headRepository),
    pull_requests: associations ? [association] : [] };
  return { eventName, event: { repository: clone(repository), workflow_run: clone(run),
    pull_request: clone(pr) }, run, pr, associatedPages: [[clone(pr)]], commitPages: [[{ sha: headSha }]],
    artifactPages: [[{ id: 101, name: "daikin-altherma-esp32-1.0.0-PR-72" },
      { id: 102, name: "daikin-altherma-esp32-1.0.0-PR-720" }],
    [{ id: 103, name: "daikin-altherma-esp32-pr72-1.0.0" },
      { id: 104, name: "daikin-altherma-esp32-1.0.0-dev.72" }]],
    failEndpoint: "", failDeleteId: null, partialResponse: false };
}

function advancedAssociation({ fork = false, apiAdvanced = true, eventAdvanced = true } = {}) {
  const model = fixture({ fork });
  // Observed API shape: run 38155527858 kept its old source while PR #185's embedded head advanced.
  const oldSource = "4f1e044431eab75aff9795b990ba73aa1ebf7312";
  const currentHead = "a544279366578ba13beb0161abb4a67f71be0e3f";
  model.run.head_sha = model.event.workflow_run.head_sha = oldSource;
  model.run.pull_requests[0].head.sha = apiAdvanced ? currentHead : oldSource;
  model.event.workflow_run.pull_requests[0].head.sha = eventAdvanced ? currentHead : oldSource;
  model.pr.head.sha = currentHead;
  model.commitPages = [[], [{ sha: oldSource }]];
  return model;
}

// Stub only transport. The workflow's real jq performs all identity and shape validation.
const ghStub = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const model = JSON.parse(fs.readFileSync(process.env.CLEANUP_FIXTURE, "utf8"));
const args = process.argv.slice(2);
if (args[0] !== "api") throw Error("unexpected gh command");
const endpoint = args.at(-1);
const deleting = args.includes("DELETE");
model.calls ??= [];
model.calls.push({ endpoint, deleting, args });
const persist = () => fs.writeFileSync(process.env.CLEANUP_FIXTURE, JSON.stringify(model));
let payload;
if (deleting) {
  const match = endpoint.match(/^repos\/fixture\/firmware\/actions\/artifacts\/(\d+)$/);
  if (!match) throw Error("unexpected mutation endpoint: " + endpoint);
  const id = Number(match[1]);
  if (model.failDeleteId === id) { persist(); process.exit(7); }
  if (!model.artifactPages.flat().some((artifact) => artifact?.id === id)) { persist(); process.exit(8); }
  model.deleted ??= [];
  model.deleted.push(id);
  model.artifactPages = model.artifactPages.map((page) => page.filter((artifact) => artifact.id !== id));
  persist(); process.exit(0);
} else if (endpoint === "repos/fixture/firmware/actions/runs/77") {
  payload = model.run;
} else if (endpoint.match(/^repos\/fixture\/firmware\/pulls\/\d+$/)) {
  payload = model.pr;
} else if (endpoint === "repos/fixture/firmware/commits/" + model.run.head_sha + "/pulls?per_page=100") {
  payload = args.includes("--paginate") ? model.associatedPages : model.associatedPages.slice(0, 1);
} else if (endpoint === "repos/fixture/firmware/pulls/72/commits?per_page=100") {
  payload = args.includes("--paginate") ? model.commitPages : model.commitPages.slice(0, 1);
} else if (endpoint === "repos/fixture/firmware/actions/artifacts?per_page=100") {
  const pages = args.includes("--paginate") ? model.artifactPages : model.artifactPages.slice(0, 1);
  model.snapshotIds = pages.flat().filter(Boolean).map((artifact) => artifact.id);
  payload = pages.map((artifacts) => ({ artifacts }));
} else {
  persist(); throw Error("unexpected read endpoint: " + endpoint);
}
persist();
process.stdout.write(model.partialResponse && model.failEndpoint === endpoint ? "[" : JSON.stringify(payload));
process.exit(model.failEndpoint === endpoint ? 7 : 0);
`;

function execute(source, model) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-pr-cleanup-"));
  try {
    const bin = path.join(temporary, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "gh"), ghStub, { mode: 0o755 });
    const modelPath = path.join(temporary, "fixture.json");
    const eventPath = path.join(temporary, "event.json");
    fs.writeFileSync(modelPath, JSON.stringify(model));
    fs.writeFileSync(eventPath, JSON.stringify(model.event));
    const summary = path.join(temporary, "summary.md");
    const result = spawnSync("bash", ["--noprofile", "--norc", "-c", shellOf(source)], {
      encoding: "utf8", timeout: 15_000,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        BASH_ENV: "", NODE_OPTIONS: "", GH_TOKEN: "offline-fixture", GH_REPO: repository.full_name,
        EVENT_NAME: model.eventName, GITHUB_EVENT_PATH: eventPath,
        GITHUB_STEP_SUMMARY: summary, CLEANUP_FIXTURE: modelPath },
    });
    assert.ifError(result.error);
    return { ...result, model: JSON.parse(fs.readFileSync(modelPath, "utf8")),
      summary: fs.existsSync(summary) ? fs.readFileSync(summary, "utf8") : "" };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function expectDeleted(source, model, ids = [101, 103]) {
  const result = execute(source, model);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.model.deleted ?? [], ids);
  if (ids.length) {
    const calls = result.model.calls;
    const firstDelete = calls.findIndex((call) => call.deleting);
    const snapshot = calls.findIndex((call) => call.endpoint.endsWith("/actions/artifacts?per_page=100"));
    assert.ok(snapshot >= 0 && snapshot < firstDelete, "freeze every page before the first mutation");
    assert.ok(calls[snapshot].args.includes("--paginate"));
    assert.ok(calls[snapshot].args.includes("--slurp"));
    assert.match(result.summary, new RegExp(`Deleted \\*\\*${ids.length}\\*\\* artifact`));
  }
  return result;
}

function expectRejected(source, model) {
  const result = execute(source, model);
  assert.notEqual(result.status, 0, "unproven API evidence must fail closed");
  assert.deepEqual(result.model.deleted ?? [], [], "no destructive side effect before validation");
  assert.equal(result.summary, "", "failed evidence must not report successful cleanup");
}

function verify(source) {
  assert.match(source, /pull_request_target:\s*\n\s*types:\s*\[closed\]/);
  assert.match(source, /workflow_run:\s*\n\s*workflows:\s*\[build\]\s*\n\s*types:\s*\[completed\]/);
  assert.match(source, /actions:\s*write/);
  assert.match(source, /pull-requests:\s*read/);
  assert.match(source, /github\.event\.pull_request\.merged == true/);
  assert.match(source, /github\.event\.workflow_run\.event == 'pull_request'/);
  assert.match(source, /queue:\s*max/);
  assert.match(source, /cancel-in-progress:\s*false/);
  assert.doesNotMatch(source, /actions\/checkout|gh run download|\/zip|source .*\.sh|eval /,
    "privileged cleanup must never fetch or execute PR-controlled code or artifacts");

  for (const eventName of ["pull_request_target", "workflow_run"]) {
    expectDeleted(source, fixture({ eventName }));
    expectDeleted(source, fixture({ fork: true, eventName }));
  }
  // Close snapshot precedes the uncancelled build's late upload; completion catches that upload.
  const closed = fixture({ eventName: "pull_request_target" });
  closed.artifactPages = [[{ id: 105, name: "firmware-PR-72" }]];
  const beforeCompletion = expectDeleted(source, closed, [105]);
  const completed = fixture();
  completed.artifactPages = beforeCompletion.model.artifactPages;
  completed.artifactPages.push([{ id: 106, name: "firmware-PR-72" }]);
  expectDeleted(source, completed, [106]);

  for (const fork of [false, true]) expectDeleted(source, fixture({ fork, associations: false }));
  const paginatedFallback = fixture({ fork: true, associations: false });
  paginatedFallback.associatedPages = [[], [clone(paginatedFallback.pr)]];
  expectDeleted(source, paginatedFallback);
  // An older run's proven association remains valid when the merged PR's final head has advanced.
  const oldRun = fixture();
  oldRun.pr.head.sha = "b".repeat(40);
  expectDeleted(source, oldRun);
  for (const fork of [false, true]) {
    for (const [apiAdvanced, eventAdvanced] of [[true, true], [true, false], [false, true]]) {
      const advanced = advancedAssociation({ fork, apiAdvanced, eventAdvanced });
      const result = expectDeleted(source, advanced);
      assert.ok(result.model.calls.some((call) => call.endpoint.endsWith("/pulls/72/commits?per_page=100")),
        "an advanced API or event association must prove the old run SHA through PR commit membership");
    }
  }
  const oldForkFallback = fixture({ fork: true, associations: false });
  oldForkFallback.pr.head.sha = oldForkFallback.associatedPages[0][0].head.sha = "b".repeat(40);
  oldForkFallback.commitPages = [[], [{ sha: headSha }]];
  expectDeleted(source, oldForkFallback);
  const noArtifacts = fixture();
  noArtifacts.artifactPages = [[], []];
  expectDeleted(source, noArtifacts, []);
  for (const verdict of [{ state: "open", merged: false }, { state: "closed", merged: false }]) {
    const preserved = fixture();
    Object.assign(preserved.pr, verdict);
    const result = expectDeleted(source, preserved, []);
    assert.ok(!result.model.calls.some((call) => call.endpoint.includes("/actions/artifacts")),
      "open or unmerged PRs must not even list artifacts for deletion");
  }

  const negatives = [
    ["unsupported event", (f) => { f.eventName = "push"; }],
    ["repository mismatch", (f) => { f.event.repository.full_name = "other/firmware"; }],
    ["numeric run injection", (f) => { f.event.workflow_run.id = "77/../../artifacts"; }],
    ["run identity mismatch", (f) => { f.run.id = 78; }],
    ["wrong run repository", (f) => { f.run.repository.id = 12; }],
    ["wrong workflow", (f) => { f.run.path = ".github/workflows/attacker.yml"; }],
    ["non-PR run", (f) => { f.run.event = f.event.workflow_run.event = "push"; }],
    ["unfinished run", (f) => { f.run.status = f.event.workflow_run.status = "in_progress"; }],
    ["malformed run SHA", (f) => { f.run.head_sha = f.event.workflow_run.head_sha = "a".repeat(39); }],
    ["fractional workflow ID", (f) => { f.run.workflow_id = f.event.workflow_run.workflow_id = 1.5; }],
    ["fractional head repository", (f) => { f.run.head_repository.id = 1.5; }],
    ["ambiguous run PRs", (f) => { f.run.pull_requests.push(clone(f.run.pull_requests[0])); }],
    ["ambiguous event PRs", (f) => { f.event.workflow_run.pull_requests.push(clone(f.run.pull_requests[0])); }],
    ["wrong association repo", (f) => { f.run.pull_requests[0].base.repo.id = 12; }],
    ["malformed API association head", (f) => { f.run.pull_requests[0].head.sha = "invalid"; }],
    ["malformed event association head", (f) => { f.event.workflow_run.pull_requests[0].head.sha = "invalid"; }],
    ["wrong event association", (f) => { f.event.workflow_run.pull_requests[0].number = 73; }],
    ["wrong current PR", (f) => { f.pr.number = 73; }],
    ["wrong current PR repository", (f) => { f.pr.base.repo.id = 12; }],
    ["wrong current fork", (f) => { f.pr.head.repo.id = 23; }],
    ["nonboolean merged", (f) => { f.pr.merged = "true"; }],
    ["no associated PR", (f) => { f.run.pull_requests = f.event.workflow_run.pull_requests = []; f.associatedPages = [[]]; }],
    ["ambiguous fallback", (f) => {
      f.run.pull_requests = f.event.workflow_run.pull_requests = [];
      const duplicate = clone(f.pr); duplicate.number = 73;
      f.associatedPages = [[clone(f.pr)], [duplicate]];
    }],
    ["wrong fallback SHA", (f) => {
      f.run.pull_requests = f.event.workflow_run.pull_requests = [];
      f.run.head_sha = f.event.workflow_run.head_sha = "b".repeat(40);
    }],
    ["wrong fallback base", (f) => {
      f.run.pull_requests = f.event.workflow_run.pull_requests = [];
      f.associatedPages[0][0].base.repo.full_name = "other/firmware";
    }],
    ["wrong fallback fork", (f) => {
      f.run.pull_requests = f.event.workflow_run.pull_requests = [];
      f.associatedPages[0][0].head.repo.id = 23;
    }],
    ["late malformed artifact ID", (f) => { f.artifactPages[1][0].id = "103/../../runs"; }],
    ["artifact shape failure", (f) => { f.artifactPages[1] = null; }],
    ["run API failure", (f) => { f.failEndpoint = "repos/fixture/firmware/actions/runs/77"; }],
    ["PR API failure", (f) => { f.failEndpoint = "repos/fixture/firmware/pulls/72"; }],
    ["artifact API failure", (f) => { f.failEndpoint = "repos/fixture/firmware/actions/artifacts?per_page=100"; }],
    ["partial artifact API failure", (f) => {
      f.failEndpoint = "repos/fixture/firmware/actions/artifacts?per_page=100"; f.partialResponse = true;
    }],
    ["fallback API failure", (f) => {
      f.run.pull_requests = f.event.workflow_run.pull_requests = [];
      f.failEndpoint = `repos/fixture/firmware/commits/${headSha}/pulls?per_page=100`;
    }],
    ["PR membership API failure", (f) => {
      f.run.pull_requests = f.event.workflow_run.pull_requests = [];
      f.failEndpoint = "repos/fixture/firmware/pulls/72/commits?per_page=100";
    }],
    ["absent PR membership", (f) => {
      f.run.pull_requests = f.event.workflow_run.pull_requests = [];
      f.commitPages = [[], []];
    }],
  ];
  for (const [name, damage] of negatives) {
    const model = fixture();
    damage(model);
    try { expectRejected(source, model); } catch (error) {
      error.message = `${name}: ${error.message}`;
      throw error;
    }
  }
  for (const fork of [false, true]) {
    const unrelated = advancedAssociation({ fork });
    unrelated.commitPages = [[{ sha: unrelated.pr.head.sha }]];
    expectRejected(source, unrelated);
    const absent = advancedAssociation({ fork });
    absent.commitPages = [[], []];
    expectRejected(source, absent);
    const unavailable = advancedAssociation({ fork });
    unavailable.failEndpoint = "repos/fixture/firmware/pulls/72/commits?per_page=100";
    expectRejected(source, unavailable);
  }
  const deleteFailure = fixture();
  deleteFailure.failDeleteId = 103;
  const failed = execute(source, deleteFailure);
  assert.notEqual(failed.status, 0);
  assert.deepEqual(failed.model.deleted, [101], "API failure stops the remaining deletion sequence");
  assert.equal(failed.summary, "", "partial cleanup never reports completion");
}

verify(workflow);
const mutations = [
  ["lost completion trigger", (s) => s.replace("  workflow_run:\n", "  lost_completion:\n"),
    (s) => assert.match(s, /workflow_run:\s*\n\s*workflows:\s*\[build\]/)],
  ["PR numeric boundary removed", (s) => s.replace(' + "(?:-|$)"', ' + ""'),
    (s) => expectDeleted(s, fixture())],
  ["advanced association skips old-SHA membership", (s) => s.replace('| any(. != $sha)', '| false'), (s) => {
    const f = advancedAssociation();
    f.commitPages = [[{ sha: f.pr.head.sha }]];
    expectRejected(s, f);
  }],
  ["unfinished build accepted", (s) => s.replace('and .status == "completed"', "and true"), (s) => {
    const f = fixture(); f.run.status = f.event.workflow_run.status = "in_progress";
    expectRejected(s, f);
  }],
  ["ambiguous fallback accepted", (s) => s.replace("if length == 1 then", "if length >= 1 then"), (s) => {
    const f = fixture({ associations: false });
    const duplicate = clone(f.pr); duplicate.number = 73;
    f.associatedPages = [[clone(f.pr)], [duplicate]];
    expectRejected(s, f);
  }],
  ["artifact pagination dropped", (s) => s.replace(
    'gh api --paginate --slurp "repos/$GH_REPO/actions/artifacts?per_page=100"',
    'gh api --slurp "repos/$GH_REPO/actions/artifacts?per_page=100"'), (s) => expectDeleted(s, fixture())],
  ["artifact API failure hidden", (s) => s.replace(
    '> "$scratch/artifact-pages.json"\n', '> "$scratch/artifact-pages.json" || true\n'), (s) => {
    const f = fixture(); f.failEndpoint = "repos/fixture/firmware/actions/artifacts?per_page=100";
    expectRejected(s, f);
  }],
  ["unmerged PR deletion", (s) => s.replace(
    "if ! jq -e '.state == \"closed\" and .merged == true'", "if jq -e 'false'"), (s) => {
    const f = fixture(); f.pr.state = "open"; f.pr.merged = false;
    expectDeleted(s, f, []);
  }],
  ["unrelated fallback SHA accepted", (s) => s.replace(
    '| [ .[][] | select(.sha == $sha) ] | length == 1', '| length >= 0'), (s) => {
    const f = fixture({ associations: false });
    f.run.head_sha = f.event.workflow_run.head_sha = "b".repeat(40);
    expectRejected(s, f);
  }],
  ["old-SHA membership pagination dropped", (s) => s.replace(
    'gh api --paginate --slurp \\\n              "repos/$GH_REPO/pulls/$PR_NUMBER/commits?per_page=100"',
    'gh api --slurp \\\n              "repos/$GH_REPO/pulls/$PR_NUMBER/commits?per_page=100"'),
  (s) => expectDeleted(s, advancedAssociation())],
];
for (const [name, mutate, check] of mutations) {
  const damaged = mutate(workflow);
  assert.notEqual(damaged, workflow, `${name}: mutation must alter production input`);
  assert.throws(() => check(damaged), { name: "AssertionError" }, `${name}: contract must reject regression`);
}
console.log("PR artifact cleanup: executed trusted close/completion, late upload, advanced associations, old-SHA membership, fork fallback, pagination, API failures and 10 mutation controls");
