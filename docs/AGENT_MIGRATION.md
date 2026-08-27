# Agent migration and operation runbook

Phase 7 of the migration is complete. Project policy, skills, focused reviewers, configuration, and
enforcement now use the canonical layout below. Transitional files used during the canary have been
retired; Git history preserves the migration record and the last known-good pre-cutover state.

## Canonical layout

| Concern | Canonical source |
|---|---|
| Always-loaded project policy | `AGENTS.md` |
| Reusable workflows | `.agents/skills/<name>/` |
| Focused reviewers | `.codex/agents/*.toml` |
| Agent settings | `.codex/config.toml` |
| Project-hook registration | `.codex/hooks.json` |
| Runner-neutral hook and merge policy | `tools/agent-hooks/` |
| Shared MCP client configuration | `.mcp.json` |

There is one maintained definition for each policy, skill, reviewer, and gate. Agent integrations
must consume those canonical sources or dispatch to the runner-neutral hook core; do not add
runner-specific policy or workflow copies. `.mcp.json` remains a shared client descriptor as
documented in [`MCP.md`](MCP.md), not a second project-policy source.

This layout covers repository-scoped workflows only. Maintainer-specific plant, LAN, observability,
private-inventory, or Mac workflows are installed in the user's global skill directory and are not
part of the repository inventory. Do not copy them into `.agents/skills/`; the exact inventory check
fails closed on both missing and extra project skills.

## Operating rules

- Invoke project skills as `$skill-name`; discovery is rooted at `.agents/skills/`.
- Review, audit, and triage requests are read-only. A review may recommend a patch, but it must not
  edit files or mutate GitHub, hardware, deployments, evidence, or live systems unless the user
  explicitly requested that action.
- Focused reviewers under `.codex/agents/` run with a read-only sandbox and no model pin. The root
  agent retains integration, mutation, and final-verification ownership.
- Project concurrency is capped at three concurrent subagent threads, plus the primary/root thread.
  Assign disjoint paths and serialize writes, hardware access, GitHub mutation, and shared build
  directories.
- Context7 is the only project MCP configured globally. GitHub and device capabilities are not
  granted by `.codex/config.toml`; they remain explicit, task-scoped actions.
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
  not equivalent; production staging without `--execute` still mutates the bench. The separate
  `--release-hil --confirm-release-hil release-hil --execute` shape belongs only to the isolated
  self-hosted release workflow and is deliberately not admitted as an ordinary agent command.
- Heap-sensitive changed-file paths make the SHA-stamped `$heap-safety-review` PR record mandatory.
  That record comes from the independent read-only `heap_safety_reviewer`; project and domain
  reviews remain independently required on every local/manual merge and every PR outside the narrow
  CI-attested Renovate Action-pin-line class.
- Diagnosis/evidence paths and owner-visible help/status paths independently require current-head
  `$diagnostic-evidence-review` and `$user-docs-review` records; their applicability is part of the
  same fail-closed changed-file policy rather than an optional template convention.

Upstream behavior is pinned to the official Codex documentation for
[`AGENTS.md`](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[skills](https://learn.chatgpt.com/docs/build-skills),
[subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), and
[project hooks](https://developers.openai.com/codex/hooks). Recheck those contracts when upgrading
the project Codex baseline.

## Configuration checks

Run these checks after changing agent instructions, skills, reviewers, configuration, or hooks:

1. Confirm `AGENTS.md` stays below the project target of 24 KiB.
2. Run `scripts/run-agent-instructions-budget.sh`; its repository-native validator checks the exact
   reviewed repository skill inventory, `name`/`description` frontmatter, directory-name identity,
   and non-empty bodies. When the Skill Creator runtime and PyYAML are available, also run its
   `quick_validate.py` as an upstream compatibility check; do not install an unpinned dependency
   merely to duplicate the binding repository gate.
3. Parse `.codex/config.toml` and all three `.codex/agents/*.toml` files. Reviewer TOMLs must keep
   `sandbox_mode = "read-only"` and contain no `model` key.
4. Parse `.codex/hooks.json` and require every registered lifecycle event to dispatch to the
   runner-neutral core under `tools/agent-hooks/`.
5. Run `scripts/run-agent-instructions-budget.sh`, `tools/agent-config/selftest.sh`, and
   `tools/agent-hooks/selftest.sh`, then the repository gate set relevant to the changed surface.
6. Start a fresh Codex task from the repository root and open `/hooks`. Review each command,
   matcher, timeout, and source loaded from `.codex/hooks.json`; trust only the exact definition hash
   shown for that reviewed hook. A hook-definition change produces a new hash, so after every such
   change start another fresh task, repeat `/hooks`, and review and trust the new exact hash. Never
   bypass hook trust permanently or carry an approval forward to a different hash.
7. Push the exact reviewed head through a pull request and require the remote `gates` check and every
   applicable build check to finish green. A local run, an older CI run, or a review stamp for an
   earlier head does not complete the cutover acceptance.

## Phase 7 cutover and rollback

The cutover is complete when the canonical configuration passes locally and in exact-head CI, the
reviewed repository skill inventory is discoverable, all three focused reviewers remain read-only,
the project hooks are reviewed at their current hashes, and no required workflow depends on a
retired adapter. The final
local check uses a fresh Codex task and `/hooks`; an older trusted hash is not evidence for a changed
hook.

Existing clones may retain ignored local files below `.claude/` after the tracked tree is removed.
The canonical configuration gate intentionally rejects even an untracked `.claude` path. Inspect
such remnants first, then move or remove only the confirmed local compatibility files before
rerunning the gate; never delete a broad or unresolved path.

Removing transitional agent files does not authorize firmware builds, flashing, OTA updates, device
mutation, or hardware claims. Those remain separate, explicitly authorized workflows.

Rollback is a normal reviewed revert or follow-up pull request that restores the last known-good
pre-cutover state from Git history. Do not rewrite history or selectively reconstruct policy from
retired copies. A rollback must rerun the configuration, hook, policy, and exact-head CI gates.
