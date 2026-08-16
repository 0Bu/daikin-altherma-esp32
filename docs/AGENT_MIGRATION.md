# Agent migration runbook

This repository runs a dual-read migration from the legacy `.claude/` layout to runner-neutral
project instructions, skills, reviewers, and gates. `.claude/` remains a compatibility surface
during the canary; it is not the canonical source and must not be deleted by routine work.

## Canonical layout

| Concern | Canonical source | Legacy compatibility |
|---|---|---|
| Always-loaded project policy | `AGENTS.md` | `.claude/CLAUDE.md` |
| Reusable workflows | `.agents/skills/<name>/` | `.claude/skills/<name>/` |
| Focused reviewers | `.codex/agents/*.toml` | `.claude/agents/*.md` |
| Agent and MCP settings | `.codex/config.toml` | `.claude/settings.json`, `.mcp.json` |
| Runner-neutral policy hooks | `tools/agent-hooks/` | `.claude/hooks/` adapters |
| Exact file mapping | `.codex/migration-manifest.json` | none |

The manifest is authoritative for completeness. `canonical` means the legacy file has a direct
canonical representation; `adapter` means the legacy file stays as a compatibility entry point to
runner-neutral policy; `deprecated` is reserved for a deliberately retired legacy-only behavior.
All 38 tracked legacy files appear exactly once and every non-deprecated target must exist. A
deterministic SHA-256 over their paths and raw bytes makes unreviewed compatibility-source drift fail
the migration gate even when the mapping itself did not change. The `UserPromptSubmit` crash-triage
context and `Stop` logic-test hook are canonical runner-neutral lifecycle hooks; both Codex and the
retained Claude adapters dispatch to the same core.

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
- Merge policy comes from the runner-neutral aggregate gate under `tools/agent-hooks/`. Legacy
  `.claude/hooks/require-*.sh` files are compatibility adapters, not a second policy definition.
- The supported merge form is exactly the repository-bound CLI action
  `gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge <numeric-pr> --match-head-commit
  <full-40-hex-head-sha> --squash`. The aggregate gate compares that atomic
  expected-head lease with the reviewed PR head before allowing the command. Direct REST, GraphQL,
  and all MCP merge, auto-merge, or queue-activation tools are intentionally blocked; no MCP tool is
  allowlisted as an equivalent path.
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

## Canary checks

Run these checks after changing either side of the migration:

1. Confirm `AGENTS.md` stays below the 32 KiB loader ceiling and preferably below the project target
   of 24 KiB.
2. Run the Skill Creator `quick_validate.py` script once for each of the 16 directories under
   `.agents/skills/`. Canonical frontmatter contains only `name` and `description`; the name is
   lowercase hyphen-case and equals the directory name.
3. Parse `.codex/config.toml` and all three `.codex/agents/*.toml` files. Reviewer TOMLs must keep
   `sandbox_mode = "read-only"` and contain no `model` key.
4. Parse `.codex/migration-manifest.json`; compare its sources exactly with
   the 38 paths from `git ls-files .claude`, reject duplicates, reject unknown status values, and
   require every target of `canonical` and `adapter` entries to exist. Recompute the documented
   legacy-tree fingerprint and reject a mismatch until the compatibility-source change was reviewed.
5. Compare the three copied `agents/openai.yaml` files byte-for-byte with their legacy sources.
6. Run the runner-neutral hook/config parity gate and its self-test, then the repository gate set
   relevant to the changed surface.
7. Require `git diff --exit-code -- .claude` during canonical migration work. A changed legacy file
   is a separate compatibility update and needs explicit review.
8. Start a fresh Codex task from the repository root and open `/hooks`. Review each command,
   matcher, timeout, and source loaded from `.codex/hooks.json`; trust only the exact definition hash
   shown for that reviewed hook. A hook-definition change produces a new hash, so after every such
   change start another fresh task, repeat `/hooks`, and review and trust the new exact hash. Never
   bypass hook trust permanently or carry an approval forward to a different hash.
9. Push the exact reviewed head through a pull request and require the remote `gates` check and every
   applicable build check to finish green. A local run, an older CI run, or a review stamp for an
   earlier head does not complete the cutover acceptance.

## Phase 7 cutover and rollback

Keep both discovery paths enabled through a canary that exercises read-only review, an authorized
implementation, and conditional PR gates. Compare gate decisions and evidence, not prose identity:
`AGENTS.md` intentionally points to deep documentation instead of reproducing the oversized legacy
file. A hardware workflow remains a separately authorized acceptance path; Phase 7 does not grant or
imply permission to flash, OTA-update, or mutate a device.

Cutover is complete only after remote CI validates the manifest and runner-neutral gates on the
exact PR head, all 16 skills are discoverable, all three reviewers stay read-only, and no required
workflow depends on a Claude-only tool name. The final local check must use a fresh Codex task and
`/hooks`, with every active project hook reviewed and trusted at its current exact definition hash;
an older trusted hash is not evidence for a changed hook. Until then, rollback means disabling the
new project configuration and returning to the retained `.claude/` compatibility surface; it does
not require deleting canonical files or rewriting history. Retire legacy files only in a later,
separately reviewed change after the canary window.
