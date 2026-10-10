# Agent migration and operation runbook

Project policy, skills, focused reviewers and enforcement definitions use the canonical layout
below. Native Codex registration is generated from these sources and checked separately from live
activation. Transitional files used during the canary have been retired; Git history preserves the
migration record and the last known-good pre-cutover state.

## Canonical layout

| Concern | Canonical source |
|---|---|
| Always-loaded project policy | `AGENTS.md` |
| Reusable workflows | `.agents/skills/<name>/` |
| Focused reviewers | `.agents/agents/*.toml` |
| Project-hook registration | `.agents/hooks.json` |
| Runner-neutral hook and merge policy | `tools/agent-hooks/` |
| Shared MCP client configuration | `.mcp.json` |
| Generated native Codex registration | `.codex/config.toml`, `.codex/hooks.json`, `.codex/agents/*.toml` |

There is one maintained definition for each policy, skill, reviewer and gate. Native adapters are
deterministic generated output; edit their canonical inputs and regenerate them. They only register
the canonical reviewers, map the lifecycle schema and dispatch to the runner-neutral core. Never
maintain a second runner-specific policy or workflow. `.mcp.json` remains the shared MCP source as
documented in [`MCP.md`](MCP.md).

This layout covers repository-scoped workflows only. Maintainer-specific plant, LAN, observability,
private-inventory, or Mac workflows are installed in the user's global skill directory and are not
part of the repository inventory. Do not copy them into `.agents/skills/`; the exact inventory check
fails closed on both missing and extra project skills.

## Operating rules

- Invoke project skills as `$skill-name`; discovery is rooted at `.agents/skills/`.
- Review, audit, and triage requests are read-only. A review may recommend a patch, but it must not
  edit files or mutate GitHub, hardware, deployments, evidence, or live systems unless the user
  explicitly requested that action.
- Focused reviewers under `.agents/agents/` declare a read-only sandbox and no model pin. Their
  native registrations must be current, and the actual spawned mode must be checked before relying
  on sandbox isolation. The root owns integration, mutation and final verification. Every review
  reports its base/head SHAs, committed range and intended staged/unstaged/untracked scope.
- Project concurrency is capped at three concurrent subagent threads, plus the primary/root thread.
  Assign disjoint paths and serialize writes, hardware access, GitHub mutation, and shared build
  directories.
- Context7 is the only repository-configured MCP; `.mcp.json` is its source and the generated Codex
  config registers it natively. Personal MCP defaults are separate. GitHub and device use remain
  explicit, task-scoped actions; listing configuration is not permission to contact a live system.
- Merge policy comes from the runner-neutral aggregate gate under `tools/agent-hooks/`; it is the
  single policy definition.
- The supported local merge form is exactly this synchronous, repository-bound REST CAS action:

  ```bash
  scripts/gh-with-git-credentials.sh api --hostname github.com --method PUT \
    repos/0Bu/daikin-altherma-esp32/pulls/<numeric-pr>/merge \
    -f sha=<full-40-hex-head-sha> -f merge_method=squash
  ```

  The endpoint binds repository and PR, `sha` is GitHub's atomic expected-head lease, and
  `merge_method=squash` preserves linear history. The aggregate gate compares that lease with the
  reviewed PR head before allowing the command. `gh pr merge` is blocked because it can activate
  auto-merge or a merge queue instead of completing synchronously. Every other REST merge or
  mutation route or shape, GraphQL mutations, and all MCP merge, auto-merge, or queue-activation
  tools are also blocked; static read-only REST GET/HEAD requests and read-only GraphQL queries
  remain allowed, and no MCP tool is allowlisted as an equivalent merge path. The wrapper resolves
  the configured `github.com` Git credential in-process and exports it only to `gh`; an unlinked
  private FIFO bridges the clean child environment, and an isolated Git shim strips the token from
  any Git descendant. The token is never printed, persisted, written to a regular file, or placed in
  argv. A readable regular `--body-file` is opened exactly once through no-follow directory
  descriptors, verified with
  `fstat`, and converted to bounded literal UTF-8 text before credential lookup. It must be a
  single-link file owned by the current user, must not be group/world writable, and must not use a
  credential-, secret-, or private-key path. The wrapper accepts `--body-file` only as a physical,
  absolute, non-symlinked path and rejects relative paths: for example,
  `/private/tmp/review-body.md` on macOS. On Linux, `/tmp/review-body.md` is valid only when
  `(cd /tmp && pwd -P)` still resolves to `/tmp`. Other local-file inputs and process pseudo-files
  are rejected. The wrapper itself reclassifies every API request and `pr merge` invocation before
  credential lookup: only GET/HEAD, static read-only GraphQL queries, and the exact CAS merge above
  may proceed. The merge reruns the aggregate evidence gate even when an opaque helper invoked the
  wrapper. A literal `gh` executable is never accepted as the local merge transport.
- An explicitly authorized PR is published only after its branch is pushed, with the wrapper's
  exact noninteractive shape:

  ```bash
  scripts/gh-with-git-credentials.sh \
    --repo github.com/0Bu/daikin-altherma-esp32 \
    pr create --head agent/<branch> --base main \
    --title '<title>' --body-file <absolute-physical-temp-path>/<reviewed-regular-file>
  ```

  The wrapper requires this exact argument order, a clean checked-out head, and a live
  `github.com` branch SHA equal to local `HEAD`; it converts the body before credential lookup and
  enforces the body-path contract above. Internally it creates a draft, verifies the created PR's
  head, marks it ready, and verifies the published head again. Any post-create lookup, ready, or
  head mismatch reports the PR URL and attempts to close the affected PR; if cleanup fails, the
  error explicitly requires manual cleanup. The caller cannot request commit-fill, template,
  draft, editor, browser, implicit-head, fork, or push variants.
- Every actual local merge reruns `scripts/run-ui-gif-audit.sh`. A stale or unverifiable recording is
  a hard mechanical block that no checked review record can override. The SHA-stamped `$ui-gif`
  review is additionally required only when the PR changes `docs/media/dashboard.gif` or
  `tools/uigif/gif_stamp.txt`.
- PR checkbox parsing proves an exact, applicable record stamped for the current head; it does not
  authenticate the PR-body editor. Maintainer review and GitHub merge authorization remain the actor
  trust boundary.
- Authoritative CI has one record-free platform-automerge exception. It binds current PR metadata
  to complete immutable GitHub commit-file pages for the exact one-commit head. The data-only
  protected-base `pr-policy.yml` workflow, which never loads PR code, accepts only a same-repository
  Renovate branch whose sole edit is the
  like-for-like 40-hex Renovate runner replacement in `.github/workflows/renovate.yaml`, with only
  the validated trailing version comment allowed to move with the digest.
  Missing/unreadable files or a partial three-file authoritative context hard-fail; malformed or
  ineligible complete input rejects the exception and follows the ordinary review records. Local
  CAS merges never receive this exception.
- GitHub evaluates a `pull_request_target` workflow from the default branch. Introducing or renaming
  this boundary therefore requires a two-stage reviewed migration: first land the data-only policy
  workflow under a temporary unique check name while the existing required check remains available,
  then require that check before switching the ordinary PR workflow/ruleset to the final `gates` +
  `build` pair. Never bridge that bootstrap by executing PR code under `pull_request_target` or by
  weakening the ruleset.
- Project hooks are lexical, defense-in-depth guardrails for ordinary tool payloads. They do not
  replace `AGENTS.md`, the sandbox, repository permissions, branch protection, or maintainer review,
  and cannot prove the intent of arbitrarily generated interpreter code or dynamically computed
  commands and paths. Treat an unrecognized or blocked form as a request to use a simpler,
  statically inspectable command; never treat hook silence as authorization.
- The hook blocks direct `/ota/update` writes, including interpreter, alternate HTTP-client and
  quote-split forms. It admits two direct, unchained canonical `scripts/production-ota-gate.py`
  shapes with the official dev manifest and exact artifact/source/current-version lease. Ordinary
  bench delivery requires `--confirm-bench bench --install-bench`, owns one un-retried write only to
  the private-inventory `bench`, and returns before production. Production promotion separately
  requires `--confirm-production production --execute`, owns its bench-first staging and one
  production write, then observes the canary read-only. Copying, wrapping, chaining or a raw POST is
  not equivalent; production staging without `--execute` still mutates the bench. The standalone
  lab-HIL shape is deliberately not admitted as an ordinary agent command and is not invoked by the
  release workflow.
- Heap-sensitive changed-file paths make the SHA-stamped `$heap-safety-review` PR record mandatory.
  That record comes from the independent read-only `heap_safety_reviewer`; project and domain
  reviews remain independently required on every local/manual merge and every PR outside the narrow
  CI-attested Renovate Action-pin-line class.
- Diagnosis/evidence paths and owner-visible help/status paths independently require current-head
  `$diagnostic-evidence-review` and `$user-docs-review` records; their applicability is part of the
  same fail-closed changed-file policy rather than an optional template convention.

Upstream behavior is aligned with the open agentic specification for
[`AGENTS.md`](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[skills](https://learn.chatgpt.com/docs/build-skills),
[subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), and
[project hooks](https://developers.openai.com/codex/hooks). Recheck those contracts when upgrading
agent configurations or hook harnesses.

## Configuration checks

### Native Codex setup and evidence

The generated `.codex/` files register Context7, cap concurrency at three spawned agents, translate
the canonical lifecycle schema into Codex hook groups, and expose the three canonical reviewer
TOMLs. They do not pin a model, grant hardware access or change personal configuration.

```bash
scripts/setup-codex.sh
scripts/run-agent-instructions-budget.sh
scripts/check-codex-setup.sh
scripts/check-codex-setup.sh --runtime
```

Run setup again after changing a canonical MCP, hook or reviewer input. Generation refuses to
silently replace unrelated local adapter contents; inspect conflicts rather than discarding them.
The source gate checks exact generated parity and reports repository-only `AGENTS.md` chains,
including scoped instructions. It keeps the root 24-KiB limit and a separate 32-KiB repository-chain
limit. These byte counts do not observe global instructions, the native `project_doc_max_bytes`
setting or configured instruction fallback filenames; they do not prove the full native context fits.
Scoped `AGENTS.md` files count even when untracked or ignored. `AGENTS.override.md` is forbidden, including
ignored files, because it would replace the canonical instructions in Codex's discovery order.

The setup check separates canonical validity, native registration and live evidence. Its runtime
mode makes bounded read-only `config/read` and `hooks/list` app-server requests. It checks the
effective Context7 pin and enabled status, subagent limit and enabled status, current-worktree config
origin, and native hook discovery and trust without starting a model turn, connecting to device MCPs or
printing credentials. These inventory requests prove discovery, not actual hook execution.
`--runtime --require-runtime` exits non-zero while fresh-task acceptance evidence remains pending;
the default check reports this limit without claiming full runtime acceptance.

Start Codex CLI in the project and use `/hooks` to inspect the exact generated definitions.
First require discovery of all four project handlers: an active project config layer with only
user hooks is a discovery failure, not evidence that the project hooks merely need trust. In the
validated native client (Codex CLI `0.162.0-alpha.17.2`), linked worktrees load project hook definitions
from the primary checkout's `.codex/`, while their current-worktree `.codex/config.toml` can be active
independently. The Doctor resolves that primary checkout through Git metadata and compares its
`.codex/hooks.json` with the current worktree's generated adapter. It reports missing, unsafe,
unreadable or differing adapters and foreign native hook sources. A differing adapter may be stale
or belong to another configuration; the Doctor does not infer its ownership from its contents or
print those contents. Setup writes only
the current checkout: it never copies adapters into the primary checkout or changes its configuration.
Before accepting native hooks, arrange a reviewed matching adapter in that checkout or use a primary
checkout with the generated setup, then rerun discovery. Recheck this client behavior after upgrades;
copying hooks into personal config or bypassing trust does not validate the project setup.
Non-managed hooks are skipped until their current hashes are trusted; setup never grants trust or
bypasses that review. After discovery and review, verify a harmless allowed operation and a blocked synthetic
operation, including a nested code-mode tool call. Confirm the matching PreToolUse and PostToolUse
events, and that a blocked call has no side effect. Do not use a real secret, device request or
destructive action as a negative control. Spawn each focused reviewer and record the requested
base/head range and actual permission mode. In the validated client, the native role loader does
not accept `sandbox_mode` or permission policy overrides from role TOMLs: all three roles inherited
`workspace-write` from a writable parent. The canonical `sandbox_mode = "read-only"` declaration
records intent; it does not constrain that parent or prove the child's effective sandbox. Use an
explicitly read-only parent session and verify the actual child permission mode. A smoke test under
that parent proves only that invocation. Report skipped hooks, missing events or unobserved sandbox
or approval-policy evidence as pending.

The focused native review entry point creates that separate parent without changing configuration:

```bash
scripts/run-codex-review.sh doc_drift_checker <full-base-sha> <full-head-sha> AGENTS.md docs \
  --intent 'Describe the intended scoped changes and their resulting behavior'
```

Choose `doc_drift_checker`, `heap_safety_reviewer` or `x10a_decode_reviewer`. The entry point requires
the current `HEAD` to equal the requested full head SHA, a non-empty bounded plain-text `--intent`
description and existing relative path scopes
without traversal, symlinks, credential directories, key files or raw memory artifacts. It reads
bounded effective configuration metadata before starting a review and fails closed when metadata
is unavailable or subagent tools are disabled. It disables every observed MCP name, web search, app
tools and plugin tools for that invocation, sets `--ephemeral --sandbox read-only`, and requests
approval policy `never`
both through the CLI option and an explicit configuration override. It grants no trust or bypass.
The parent must spawn only the selected actual role with `fork_context=false`, wait for its response
and close it when the toolset supports closing. Otherwise it must verify completion and report
the lifecycle limit. The task separates the scoped committed range from staged, unstaged and intended
untracked changes and prohibits file-changing tests, builds, GitHub operations and live-system
contact. The launcher does not pin a model or persist settings. Its argument tests prove requested
configuration; only a native run with actual permission and approval-policy evidence proves the
effective restrictions for that run.
Report `approval_policy` separately from `approvals_reviewer`: `auto_review` names the reviewer,
not the policy. An unexposed actual approval policy remains unobserved.
The process exit status alone does not prove that the selected reviewer completed its work. A usable
review record must identify the actual named role, verified read-only mode, exact base/head and scope,
local changes included, findings and completed review. Check that evidence independently before
recording a review; the launcher never checks PR boxes or creates an acceptance stamp.

The formatter records a correlated pre-edit state only for eligible project source files and
computes formatting in memory. It emits a bounded suggestion, never writes a source file. Existing
user changes, missing correlation or concurrent changes cause it to skip the suggestion. Apply
formatting through the ordinary edit workflow under explicit file ownership, then run the normal
format gate; a post-edit hook is not permission to reformat another author's changes.

### Canonical checks

Run these checks after changing agent instructions, skills, reviewers, configuration, or hooks:

1. Confirm `AGENTS.md` stays below the project target of 24 KiB.
2. Run `scripts/run-agent-instructions-budget.sh`; its repository-native validator checks the exact
   reviewed repository skill inventory, `name`/`description` frontmatter, directory-name identity,
   and non-empty bodies. When the Skill Creator runtime and PyYAML are available, also run its
   `quick_validate.py` as an upstream compatibility check; do not install an unpinned dependency
   merely to duplicate the binding repository gate.
3. Parse `.mcp.json` and all three `.agents/agents/*.toml` files. Reviewer TOMLs must keep
   `sandbox_mode = "read-only"` and contain no `model` key.
4. Parse `.agents/hooks.json` and require its lifecycle definitions to dispatch to the runner-neutral
   core under `tools/agent-hooks/`. Verify generated adapter parity as a separate registration check;
   valid source files alone do not prove native discovery, hook trust or execution.
5. Run `scripts/run-agent-instructions-budget.sh`, `tools/agent-config/selftest.sh`, and
   `scripts/run-skill-audit.sh`, `tools/skill_audit/selftest.sh`,
   `scripts/agent-python.sh tools/agent-hooks/test_push_gate.py`, and `tools/agent-hooks/selftest.sh`, then the
   repository gate set relevant to the changed surface.
6. Push the exact reviewed head through a pull request and require the remote `gates` check and every
   applicable build check to finish green. A local run, an older CI run, or a review stamp for an
   earlier head does not complete the cutover acceptance.

The native Git push hook lives in `.githooks/pre-push` and dispatches to
`tools/agent-hooks/require-pr-gates.sh`. Activate it per clone with
`git config --local core.hooksPath .githooks`; project lifecycle hook registration alone does not
install a Git hook. The native hook receives Git's actual ref updates, binds them to the destination
repository and branch, and checks review records against the commit being sent. Prepare the
`$skill-audit` and `$pr-hygiene-review` stamps in an open PR's body before pushing that commit.
The checked-out `HEAD` must be that commit and the worktree must be clean for its local audit.
An unsuccessful PR lookup must block; it is not evidence that no PR exists. This local push check
does not replace the protected-base merge policy or the required CI checks.

## Phase 7 cutover and rollback

Acceptance has three separate outcomes: canonical sources pass locally and in exact-head CI;
native registration is current and discoverable; live execution has been observed. The last requires
all three reviewers in the expected mode, hooks reviewed at their current hashes, and positive and
negative dispatch controls in a fresh task. Old hook trust is not evidence for a changed definition.
No required workflow may depend on a retired adapter. Report any unavailable runtime evidence as
pending rather than marking the entire setup complete from a source-only gate.

Existing clones may retain ignored local files below `.claude/` after the tracked tree is removed.
The canonical configuration gate intentionally rejects even an untracked `.claude` path. Inspect
such remnants first, then move or remove only the confirmed local compatibility files before
rerunning the gate; never delete a broad or unresolved path.

Removing transitional agent files does not authorize firmware builds, flashing, OTA updates, device
mutation, or hardware claims. Those remain separate, explicitly authorized workflows.

Rollback is a normal reviewed revert or follow-up pull request that restores the last known-good
pre-cutover state from Git history. Do not rewrite history or selectively reconstruct policy from
retired copies. A rollback must rerun the configuration, hook, policy, and exact-head CI gates.

## Delivery details

Ordinary official dev delivery to an OTA-capable inventory bench uses the direct, unchained
`scripts/production-ota-gate.py --confirm-bench bench --install-bench` shape described by the
delivery skills, with all artifact/source/current-version lease arguments. It binds the exact
signed artifact, owns one un-retried POST only to the bench, survives rollback probation and stress,
and cannot contact production. This is artifact delivery; an explicitly requested pre-merge USB
test of an exact local head is a separate acceptance path.

Production promotion is a distinct `--confirm-production production --execute` transaction. Bench
staging and stress precede the production POST, then read-only canary and retained-X10A checks.
Staging without `--execute` still mutates the bench and needs its authorized delivery scope. The
gate accepts only the current official dev manifest. Direct `/ota/update`, including a channel
switch with `downgrade=1`, is never an agent alternative. A production image that passed probation
is corrected through a reviewed fix or revert and the same bench-first roll-forward chain; an image
that failed probation is reverted by the bootloader. Preserve failed-gate evidence and obtain
fresh authorization for a blocked complete rerun rather than retrying a write.

Signed, NVS-preserving USB writes to inventory roles are limited to bootstrap, recovery and the
explicit bench exact-head pre-merge test. Production takes USB only for bootstrap or recovery.
The repository flash plan skips NVS and coredump; a differing partition table, erasure or evidence
clearing needs separate explicit authorization. Full commands and artifact, signature, identity,
probation, heap, stack and changed-behavior checks remain in the delivery skills and
[SECURITY.md](SECURITY.md).

A manual `workflow_dispatch` with `release: true` authorizes publication, skips the mechanical PR
suite, performs one signed firmware build, publishes the release feed and creates the exact-source
tag and GitHub Release. It contacts no board and requires no self-hosted runner, private inventory,
environment approval or hardware evidence. Test-board and production-board acceptance are separate
authorized chains. A standalone `$deploy-test` fix does not grant commit or publication permission;
prepare the scoped correction and host evidence, then repeat the clean-head bench test only after
its commit is authorized. The inherited `$deploy-prod` chain already includes its fix commits.
