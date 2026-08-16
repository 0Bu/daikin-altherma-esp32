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
- The supported local merge form is exactly the repository-bound CLI action
  `scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 pr merge <numeric-pr> --match-head-commit
  <full-40-hex-head-sha> --squash`. The aggregate gate compares that atomic
  expected-head lease with the reviewed PR head before allowing the command. Direct REST, GraphQL,
  and all MCP merge, auto-merge, or queue-activation tools are intentionally blocked; no MCP tool is
  allowlisted as an equivalent path. The wrapper resolves the configured `github.com` Git
  credential in-process and exports it only to `gh`; it never prints, writes, persists, or places the
  token in argv. A literal equivalent `gh` command remains supported for already-authenticated CI
  and trusted automation, and is subject to the same parser and gate.
- Every actual local merge reruns `scripts/run-ui-gif-audit.sh`. A stale or unverifiable recording is
  a hard mechanical block that no checked review record can override. The SHA-stamped `$ui-gif`
  review is additionally required only when the PR changes `docs/media/dashboard.gif` or
  `tools/uigif/gif_stamp.txt`.
- PR checkbox parsing proves an exact, applicable record stamped for the current head; it does not
  authenticate the PR-body editor. Maintainer review and GitHub merge authorization remain the actor
  trust boundary.
- Project hooks are lexical, defense-in-depth guardrails for ordinary tool payloads. They do not
  replace `AGENTS.md`, the sandbox, repository permissions, branch protection, or maintainer review,
  and cannot prove the intent of arbitrarily generated interpreter code or dynamically computed
  commands and paths. Treat an unrecognized or blocked form as a request to use a simpler,
  statically inspectable command; never treat hook silence as authorization.

Upstream behavior is pinned to the official Codex documentation for
[`AGENTS.md`](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[skills](https://learn.chatgpt.com/docs/build-skills),
[subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), and
[project hooks](https://developers.openai.com/codex/hooks). Recheck those contracts when upgrading
the project Codex baseline.

## Configuration checks

Run these checks after changing agent instructions, skills, reviewers, configuration, or hooks:

1. Confirm `AGENTS.md` stays below the project target of 24 KiB.
2. Run `scripts/run-agent-instructions-budget.sh`; its repository-native validator checks all 16
   skill directories, exact `name`/`description` frontmatter, directory-name identity, and non-empty
   bodies. When the Skill Creator runtime and PyYAML are available, also run its
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

The cutover is complete when the canonical configuration passes locally and in exact-head CI, all
16 skills are discoverable, all three focused reviewers remain read-only, the project hooks are
reviewed at their current hashes, and no required workflow depends on a retired adapter. The final
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
