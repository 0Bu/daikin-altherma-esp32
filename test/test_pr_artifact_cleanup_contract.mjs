// Merged-PR artifact cleanup is a storage and trust-boundary contract:
//
//  * an OPEN PR keeps the only downloadable copy of its image + matching ELF;
//  * only GitHub's positive `merged` verdict may make that copy disappear early;
//  * fork PRs still need a write-capable token, but no untrusted PR code may execute;
//  * all artifact pages must be captured before deletion, or page shifting skips entries;
//  * PR 72 must never match PR 720.
//
// These are properties of the workflow source, so the firmware host suite cannot prove them.
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(
  new URL("../.github/workflows/cleanup-pr-artifacts.yml", import.meta.url), "utf8");

assert.match(workflow, /pull_request_target:\s*\n\s*types:\s*\[closed\]/,
  "cleanup must run from the trusted default-branch workflow when a PR closes");
assert.match(workflow, /permissions:\s*\n\s*actions:\s*write/,
  "artifact deletion needs an explicit actions:write token");
assert.match(workflow, /if:\s*github\.event\.pull_request\.merged == true/,
  "closing without merging must never delete the PR artifact");
assert.doesNotMatch(workflow, /actions\/checkout|pull_request\.head|head\.sha/,
  "the privileged pull_request_target job must never fetch or execute untrusted PR code");

assert.match(workflow,
  /gh api --paginate --slurp "repos\/\$GH_REPO\/actions\/artifacts\?per_page=100"/,
  "the complete artifact snapshot must be fetched before deletion so pagination cannot shift");
assert.match(workflow,
  /jq -r[\s\S]*?> "\$artifact_list"\s*\n\s*mapfile -t artifacts < "\$artifact_list"/,
  "API and jq failures must propagate before the frozen artifact list is loaded");
assert.doesNotMatch(workflow, /mapfile[^\n]*< <\(/,
  "process substitution would hide a failed API or jq producer behind mapfile's success");
assert.match(workflow,
  /test\("\(\?i\)\(\?:\^\|-\)pr-\?" \+ \$pr_number \+ "\(\?:-\|\$\)"\)/,
  "artifact names must match the exact, numerically bounded PR identity");
assert.match(workflow,
  /gh api --method DELETE "repos\/\$GH_REPO\/actions\/artifacts\/\$artifact_id"/,
  "only the artifact IDs selected from the exact PR-name match may be deleted");

// Mirror the deliberately simple workflow regex over representative real naming generations.
const belongsTo = (name, pr) => new RegExp(`(?:^|-)pr-?${pr}(?:-|$)`, "i").test(name);
assert.equal(belongsTo("daikin-altherma-esp32-1.0.0-PR-72", 72), true);
assert.equal(belongsTo("daikin-altherma-esp32-pr72-1.0.0", 72), true);
assert.equal(belongsTo("daikin-altherma-esp32-1.0.0-PR-720", 72), false);
assert.equal(belongsTo("daikin-altherma-esp32-1.0.0-PR-7", 72), false);
assert.equal(belongsTo("daikin-altherma-esp32-1.0.0-dev.72", 72), false);

console.log("PR artifact cleanup: merged-only, trusted, paginated and exact-number bounded");
