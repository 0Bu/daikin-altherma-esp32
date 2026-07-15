#!/usr/bin/env bash
# Shared logic for the PR-merge gate: require-project-review.sh. Sourced, never run directly.
#
# THERE IS NO FILE MARKER. The pass-state of a review lives as a TICKED, SHA-STAMPED
# checkbox in the pull request's body, e.g.:
#     - [x] `/project-review` clean — merge gate @ a1b2c3d4e5f6
# The gate reads that checkbox from the PR and allows the merge only while the box is checked
# AND the stamped commit still matches the commit the merge targets. Any new commit re-stales it
# (sha mismatch), forcing a fresh review before the next merge.
#
# Reading a PR needs GitHub access: `gh` (local terminal) or, failing that, a REST call with
# ${GH_TOKEN:-$GITHUB_TOKEN} (web/remote). If neither is available the gate fails CLOSED with
# guidance — it never silently allows an unverified merge.
#
# All functions are pure/reusable; the gate script sets GATE_PROJ then calls them.

# gate_checkbox_status <content> <key>
#   Prints exactly one of:  "checked <sha>" | "checked" | "unchecked" | "absent"
#   A match is a markdown task-list item ("- [ ]" / "- [x]", any bullet) whose text contains
#   <key> (e.g. "project-review"). <sha> is the hex token (7..40) after an "@" on that line, if
#   present. <content> is the PR body.
gate_checkbox_status() {
  local content="$1" key="$2" line
  # Match a markdown task-list item ("- [ ]" / "- [x]", any bullet) that is the REAL gate line:
  # it must mention <key> AND the word "gate" (the canonical line reads "… merge gate @ <sha>").
  # Requiring "gate" as well as the bare key stops an unrelated prose checkbox that merely names
  # the skill + a HEAD sha from satisfying the gate.
  line="$(printf '%s\n' "$content" \
      | grep -iE '[-*][[:space:]]+\[[ xX]\]' \
      | grep -iF -- "$key" \
      | grep -iE 'gate' | head -n1)"
  [ -n "$line" ] || { printf 'absent\n'; return 0; }
  if printf '%s' "$line" | grep -qE '\[[xX]\]'; then
    local sha
    sha="$(printf '%s' "$line" | grep -oiE '@[[:space:]]*[0-9a-f]{7,40}' | head -n1 \
         | grep -oiE '[0-9a-f]{7,40}' | head -n1)"
    [ -n "$sha" ] && printf 'checked %s\n' "$sha" || printf 'checked\n'
  else
    printf 'unchecked\n'
  fi
}

# gate_sha_matches <a> <b>  -> 0 if one is a (>=7 char) case-insensitive prefix of the other.
gate_sha_matches() {
  local a b
  a="$(printf '%s' "$1" | tr 'A-F' 'a-f')"
  b="$(printf '%s' "$2" | tr 'A-F' 'a-f')"
  [ "${#a}" -ge 7 ] && [ "${#b}" -ge 7 ] || return 1
  case "$a" in "$b"*) return 0 ;; esac
  case "$b" in "$a"*) return 0 ;; esac
  return 1
}

# gate_head_sha  -> local HEAD (short 12), empty if not a git repo.
gate_head_sha() { git -C "${GATE_PROJ:-$PWD}" rev-parse --short=12 HEAD 2>/dev/null; }

# gate_branch  -> current branch name, empty if detached/not a repo.
gate_branch() { git -C "${GATE_PROJ:-$PWD}" rev-parse --abbrev-ref HEAD 2>/dev/null; }

# gate_repo_slug  -> owner/repo, from gh else the origin remote URL. Empty if undeterminable.
gate_repo_slug() {
  local s
  s="${GATE_REPO_SLUG:-}"
  [ -z "$s" ] && command -v gh >/dev/null 2>&1 && s="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)"
  [ -z "$s" ] && s="$(git -C "${GATE_PROJ:-$PWD}" remote get-url origin 2>/dev/null \
        | sed -E 's#^git@github\.com:##; s#^https://github\.com/##; s#\.git$##')"
  printf '%s' "$s"
}

# gate_fetch_pr <selector>
#   Reads an EXISTING PR (selector: a PR number/URL, or empty for the current branch). On success
#   prints the head sha on line 1, then the PR body.
#   THREE-STATE exit — callers MUST tell these apart:
#     0  read OK (head+body printed)
#     1  confirmed NO open PR for this branch  (we HAD working access and the query came back empty)
#     2  could NOT read GitHub  (no gh AND no usable token, or the gh/API call errored/transient)
#   Collapsing 1 and 2 into "allow" is a FAIL-OPEN: a merge would slip through unverified whenever
#   GitHub is momentarily unreadable. The merge gate blocks on BOTH 1 and 2 (fail closed).
gate_fetch_pr() {
  local sel="$1" json rc tok slug num owner branch list cnt
  if command -v gh >/dev/null 2>&1; then
    if [ -n "$sel" ]; then
      json="$(gh pr view "$sel" --json body,headRefOid 2>/dev/null)"; rc=$?
      if [ "$rc" -eq 0 ] && [ -n "$json" ]; then
        printf '%s\n' "$(printf '%s' "$json" | jq -r '.headRefOid // ""')"
        printf '%s'   "$(printf '%s' "$json" | jq -r '.body // ""')"
        return 0
      fi
      return 2   # explicit selector but view failed -> treat as unreadable (merge gate blocks on 1|2)
    fi
    branch="$(gate_branch)"; [ -n "$branch" ] || return 2
    # `gh pr list` distinguishes "none" (exit 0, []) from "error" (non-zero) — unlike `gh pr view`.
    list="$(gh pr list --head "$branch" --state open --json number,body,headRefOid 2>/dev/null)"; rc=$?
    { [ "$rc" -eq 0 ] && [ -n "$list" ]; } || return 2
    cnt="$(printf '%s' "$list" | jq 'length' 2>/dev/null)"; [ -n "$cnt" ] || return 2
    [ "$cnt" = "0" ] && return 1
    printf '%s\n' "$(printf '%s' "$list" | jq -r '.[0].headRefOid // ""')"
    printf '%s'   "$(printf '%s' "$list" | jq -r '.[0].body // ""')"
    return 0
  fi
  # Token/REST fallback (web/remote, no gh). Needs a token + curl + jq + the repo slug.
  tok="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  { [ -n "$tok" ] && command -v curl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; } || return 2
  slug="$(gate_repo_slug)"; [ -n "$slug" ] || return 2
  if printf '%s' "$sel" | grep -qE '^[0-9]+$'; then
    json="$(curl -fsSL -H "Authorization: Bearer $tok" -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/$slug/pulls/$sel" 2>/dev/null)" || return 2
    [ -n "$json" ] || return 2
  else
    branch="$(gate_branch)"; owner="${slug%%/*}"
    list="$(curl -fsSL -H "Authorization: Bearer $tok" -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/$slug/pulls?head=$owner:$branch&state=open" 2>/dev/null)" || return 2
    cnt="$(printf '%s' "$list" | jq 'length' 2>/dev/null)"; [ -n "$cnt" ] || return 2
    [ "$cnt" = "0" ] && return 1
    json="$(printf '%s' "$list" | jq -c '.[0]' 2>/dev/null)"
  fi
  [ -n "$json" ] || return 2
  printf '%s\n' "$(printf '%s' "$json" | jq -r '.head.sha // .headRefOid // ""')"
  printf '%s'   "$(printf '%s' "$json" | jq -r '.body // ""')"
  return 0
}

# gate_pr_changed_files <selector>
#   Prints the PR's changed file paths (repo-relative), one per line, on stdout. Same dual-mode
#   (gh / token+REST) and THREE-STATE exit as gate_fetch_pr:
#     0  read OK (paths on stdout, possibly empty)
#     1  confirmed NO open PR for this branch
#     2  could NOT read GitHub (no access / errored)
#   Used by a CONDITIONAL gate (gate_enforce's relevance filter): a caller that can't read the file
#   list (rc 2) fails CLOSED — it requires the record rather than guessing the PR is irrelevant.
gate_pr_changed_files() {
  local sel="$1" rc branch slug tok num json list cnt owner
  if command -v gh >/dev/null 2>&1; then
    if [ -n "$sel" ]; then
      gh pr diff "$sel" --name-only 2>/dev/null; rc=$?
      [ "$rc" -eq 0 ] && return 0 || return 2
    fi
    branch="$(gate_branch)"; [ -n "$branch" ] || return 2
    num="$(gh pr list --head "$branch" --state open --json number -q '.[0].number' 2>/dev/null)"; rc=$?
    [ "$rc" -eq 0 ] || return 2
    [ -n "$num" ] || return 1
    gh pr diff "$num" --name-only 2>/dev/null; rc=$?
    [ "$rc" -eq 0 ] && return 0 || return 2
  fi
  # Token/REST fallback (web/remote, no gh).
  tok="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  { [ -n "$tok" ] && command -v curl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; } || return 2
  slug="$(gate_repo_slug)"; [ -n "$slug" ] || return 2
  num="$sel"
  if ! printf '%s' "$num" | grep -qE '^[0-9]+$'; then
    branch="$(gate_branch)"; owner="${slug%%/*}"
    list="$(curl -fsSL -H "Authorization: Bearer $tok" -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/$slug/pulls?head=$owner:$branch&state=open" 2>/dev/null)" || return 2
    cnt="$(printf '%s' "$list" | jq 'length' 2>/dev/null)"; [ -n "$cnt" ] || return 2
    [ "$cnt" = "0" ] && return 1
    num="$(printf '%s' "$list" | jq -r '.[0].number' 2>/dev/null)"
  fi
  [ -n "$num" ] || return 2
  # PRs here are small; one page of 100 changed files is ample (no pagination).
  json="$(curl -fsSL -H "Authorization: Bearer $tok" -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/$slug/pulls/$num/files?per_page=100" 2>/dev/null)" || return 2
  printf '%s' "$json" | jq -r '.[].filename' 2>/dev/null
  return 0
}

# gate_enforce <key> <skill> <noun> [relevance_regex]
#   The whole PreToolUse merge-gate flow, parameterized so several gates share it. Reads the
#   PreToolUse JSON from stdin, and:
#     • allows (return 0) anything that is not a gated PR merge (`gh pr merge` / the GitHub MCP
#       merge tool) — plain commits, `gh pr create`, etc. are never gated;
#     • if <relevance_regex> is non-empty, applies ONLY to PRs that change ≥1 file matching it
#       (else return 0) — an unreadable file list fails CLOSED (requires the record);
#     • otherwise requires a ticked, SHA-stamped "<key> … gate @ <sha>" checkbox in the PR body
#       whose stamp still matches the PR head, printing actionable guidance + return 2 if not.
#   <skill> is the slash-command to run (e.g. /project-review); <noun> names the record in prose.
#   Fetching the PR fails CLOSED (return 2) on any non-clean read — a merge never proceeds unverified.
gate_enforce() {
  local key="$1" skill="$2" noun="$3" relevance="${4:-}"
  local input tool cmd action selector norm

  input="$(cat 2>/dev/null)"
  tool="$(printf '%s' "$input" | jq -r '.tool_name // ""' 2>/dev/null)"
  cmd="$(printf '%s'  "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)"

  action=""; selector=""
  case "$tool" in
    mcp__github__merge_pull_request)
      action="merge_pull_request (GitHub MCP)"
      selector="$(printf '%s' "$input" | jq -r '.tool_input.pullNumber // .tool_input.pull_number // ""' 2>/dev/null)"
      ;;
    Bash)
      norm="$(printf '%s' "$cmd" | sed -E 's/^[[:space:]]+//; s/^cd[[:space:]]+[^;&|]+(&&|;)[[:space:]]*//')"
      if printf '%s' "$norm" | grep -Eq '^gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)'; then
        action="gh pr merge"
        selector="$(printf '%s' "$norm" \
                    | sed -nE 's/^gh[[:space:]]+pr[[:space:]]+merge[[:space:]]*//p' | head -n1 \
                    | tr ' ' '\n' | grep -m1 -E '^([0-9]+|https?://[^ ]+)$' || true)"
      fi
      ;;
  esac
  [ -n "$action" ] || return 0

  # Fetch the target PR (head sha + body). Fail CLOSED on anything but a clean read.
  local pr fetch_rc head_sha body
  pr="$(gate_fetch_pr "$selector")"; fetch_rc=$?
  if [ "$fetch_rc" -ne 0 ]; then
    {
      if [ "$fetch_rc" -eq 1 ]; then
        echo "BLOCKED: \`$action\` — no open pull request found for ${selector:-the current branch}."
        echo
        echo "The $skill gate reads a ticked, SHA-stamped checkbox from the PR body; there is no PR to read."
      else
        echo "BLOCKED: \`$action\` — could not read the pull request to verify the $skill gate."
        echo
        echo "This gate reads a ticked, SHA-stamped checkbox from the PR body. Reading it needs GitHub"
        echo "access — \`gh\` (local) or \${GH_TOKEN}/\${GITHUB_TOKEN} (web/remote). Neither worked here."
        echo
        echo "Either run this from a session with \`gh\` authenticated, export a token, or merge via the"
        echo "GitHub UI after confirming the $skill box is ticked (hooks don't gate the web UI)."
      fi
    } >&2
    return 2
  fi
  head_sha="$(printf '%s' "$pr" | head -n1)"
  body="$(printf '%s' "$pr" | tail -n +2)"

  # Conditional gate: apply only when the PR touches relevant files. An unreadable file list
  # fails CLOSED (require the record) — never silently skip the gate on uncertainty.
  if [ -n "$relevance" ]; then
    local files frc
    files="$(gate_pr_changed_files "$selector")"; frc=$?
    if [ "$frc" -eq 0 ] && ! printf '%s\n' "$files" | grep -Eq "$relevance"; then
      return 0   # nothing feature-relevant changed -> this gate does not apply to this PR
    fi
  fi

  local status box_state box_sha
  status="$(gate_checkbox_status "$body" "$key")"
  box_state="${status%% *}"; box_sha=""
  [ "$box_state" = "checked" ] && box_sha="$(printf '%s' "$status" | awk '{print $2}')"

  if [ "$box_state" = "checked" ] && gate_sha_matches "$box_sha" "$head_sha"; then
    return 0   # ticked and stamped with the PR's head commit -> current -> allow
  fi

  {
    echo "BLOCKED: \`$action\` requires a current $noun recorded in the PR."
    echo
    case "$box_state" in
      absent)    echo "The PR body has no \`$skill\` checkbox — it has not been recorded." ;;
      unchecked) echo "The \`$skill\` checkbox in the PR body is present but unticked." ;;
      checked)
        if [ -z "$box_sha" ]; then
          echo "The \`$skill\` box is ticked but carries no \`@ <sha>\` stamp — cannot prove it"
          echo "covered the commit being merged."
        else
          echo "The \`$skill\` box is stamped @ $box_sha but the PR head is ${head_sha:-unknown} —"
          echo "it is stale (commits landed since it ran)."
        fi ;;
    esac
    echo
    echo "Do this before merging the PR:"
    echo "  1. Run the skill:                       $skill"
    echo "  2. Once it passes, tick + stamp the PR checkbox with the head commit"
    echo "     (\`git rev-parse --short=12 HEAD\`), e.g.:"
    echo "         - [x] \`$skill\` clean — merge gate @ ${head_sha:-<sha>}"
    echo "     (edit the PR body: \`gh pr edit <pr> --body-file <file>\`, or the GitHub MCP update tool.)"
    echo "  3. Re-run the $action command."
    echo
    echo "The stamp is valid only while it matches the PR head, so any later commit forces a fresh run."
  } >&2
  return 2
}
