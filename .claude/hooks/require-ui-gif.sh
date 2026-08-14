#!/usr/bin/env bash
# PreToolUse gate: refuse a PR *merge* that leaves the README's dashboard recording unjudged, until
# /ui-gif has been run against the commit being merged.
#
# WHY A FIFTH GATE. Its siblings each ask whether something is TRUE right now: require-domain-review
# whether a published value is physically right, require-schematic-review whether the drawing puts
# it on the correct pipe, require-ui-use-case-review whether the buttons still work. All of them
# read the live tree. docs/media/dashboard.gif is the one artefact none of them can reach, because
# it is not the tree — it is a PICTURE of the tree, taken once. It keeps rendering perfectly long
# after the thing it recorded changed, so every gate in this repo stays green while the first thing
# a new reader sees in the README is last month's dashboard. A screenshot cannot fail a test; it can
# only be out of date, and it looks exactly as good either way.
#
# WHY THE MECHANICAL AUDIT IS NOT ENOUGH. scripts/run-ui-gif-audit.sh runs as a CI `gates` step, and
# check_ui_gif.mjs refuses to hand out a stamp over an unchanged recording. Both together prove
# exactly one thing: the GIF was made from these sources. They cannot see whether it is a GOOD
# picture — whether all nine operating scenes are still true, whether standby still shows held X10A
# values disappearing rather than posing as current (the firmware's central claim about itself),
# whether the invented numbers are still physically coherent, whether the crop still frames the
# card. A recording can be perfectly current and quietly advertise the opposite of what this project
# does. Only a person looking at the finished GIF can close that.
#
# RELEVANCE IS THE FINGERPRINT, NOT A PATH LIST — and that is the one place this gate departs from
# its siblings. They can name their subject in a regex; this one cannot. The dashboard drawing does
# not live in files of its own: the schematic figure, the settings modal, the history chart and the
# value list share main/www/index.html, main/www/style.css and main/www/js/. Any regex over those is
# wrong in one of two directions, and the harmless-looking direction is not harmless — a filter that
# fires on every main/www/ edit demands a re-record (Chrome + ffmpeg, ~10 min) for a settings-modal
# fix that cannot move a single pixel of the recording, and a gate that asks for work nobody needs
# is a gate people learn to tick without doing. The fingerprint in tools/uigif/check_ui_gif.mjs is
# the only thing that knows the difference, because it reads the #schem figure, the .sc-* rules and
# the six painting functions rather than the files containing them. So ask IT.
#
# Two outcomes, and the second is why "is the audit clean" cannot be the whole test:
#   1. THE AUDIT IS NOT CLEAN — the recording in the README is not of this UI (or the checker could
#      no longer take the fingerprint at all, which is not a pass). This is a HARD BLOCK, and
#      deliberately NOT routed through gate_enforce: a review record is human evidence that somebody
#      judged a recording, and no such evidence can outrank the mechanical fact that the recording
#      on disk is not of these sources. Routing it through gate_enforce is what this hook did first,
#      and a ticked box stamped with the current head then returned 0 over a red audit — the exact
#      override this gate exists to refuse. The defence of that version was that CI fails on the
#      same commit anyway, which makes a hook that promises to fail closed depend on a branch
#      ruleset for the promise. The remedy is not a stamp; it is scripts/record-dashboard-gif.sh.
#   2. THE AUDIT IS CLEAN BUT THIS PR CHANGED THE RECORDING — docs/media/dashboard.gif or its stamp.
#      A PR that re-recorded is green BY CONSTRUCTION, so a staleness test alone would wave through
#      exactly the PR carrying a new recording nobody has looked at. That is the judgement half's
#      whole subject, so it is named by path here: those two files, nothing else.
# Everything else merges without this gate — a settings edit, a chart fix, a docs PR.
#
# What the absence of this gate cost is on the record: with the recording's currency nobody's merge
# condition, #462 swapped the schematic's circuits and the README went stale the same day, against a
# stamp written hours earlier — and no gate anywhere could say so.
#
# Same two merge paths and the same record mechanism as its siblings, but only in outcome 2: run
# /ui-gif, then tick + SHA-stamp its box in the PR body:
#     - [x] `/ui-gif` clean — merge gate @ <short-sha>
# Allowed only while checked AND stamped with the PR head, so any later commit forces a fresh look.
# The shared flow is pr-gate-lib.sh -> gate_enforce; this script decides the outcome and names the
# gate. Outcome 1 never reaches gate_enforce, which is the whole point of the split.
#
# Exit codes: 0 = allow, 2 = block (stderr is fed back to Claude).

proj="${CLAUDE_PROJECT_DIR:-$PWD}"
GATE_PROJ="$proj"

# Classify BEFORE doing any work. gate_enforce returns 0 for anything that is not a gated merge, but
# it is called from a PreToolUse hook on EVERY Bash tool call, and the audit below spawns node — a
# second of latency on every shell command in the session is not a price this gate gets to charge.
# A loose superset of gate_enforce's own matching is the right shape: a false positive costs one
# audit run and then returns 0 anyway, a false negative would silently un-gate a merge.
input="$(cat 2>/dev/null)"
case "$input" in
  *merge_pull_request*|*"pr merge"*) ;;
  *) exit 0 ;;
esac

# shellcheck source=/dev/null
. "$proj/.claude/hooks/pr-gate-lib.sh" 2>/dev/null || exit 0   # lib missing -> don't block

# The cheap classifier above is deliberately loose. Confirm that this is an actual merge before a
# red audit can block it; a shell command which merely quotes "gh pr merge" must remain ordinary.
tool="$(printf '%s' "$input" | jq -r '.tool_name // ""' 2>/dev/null)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)"
is_merge=false
case "$tool" in
  mcp__github__merge_pull_request|mcp__codex_apps__github_merge_pull_request) is_merge=true ;;
  Bash)
    norm="$(printf '%s' "$cmd" | sed -E 's/^[[:space:]]+//; s/^cd[[:space:]]+[^;&|]+(&&|;)[[:space:]]*//')"
    printf '%s' "$norm" | grep -Eq '^gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)' && is_merge=true
    ;;
esac
[ "$is_merge" = true ] || exit 0

# A review stamp is HUMAN evidence that a current recording was judged; it can never override the
# mechanical fact that the recording is stale or cannot be fingerprinted. The former implementation
# made the stale case unconditional in gate_enforce(), but a ticked current-SHA box then returned 0
# even while this audit was red. That relied on branch protection which this repository does not
# currently have, contradicting the hook's own fail-closed promise.
if ! audit_out="$("$proj/scripts/run-ui-gif-audit.sh" 2>&1)"; then
  printf '%s\n' "$audit_out" >&2
  {
    echo
    echo "BLOCKED: the README dashboard recording is stale or could not be verified."
    echo
    echo "Run /ui-gif to re-record, re-stamp and inspect it. A ticked PR checkbox cannot override"
    echo "a mechanical source/GIF mismatch; once the audit is clean, the new recording still needs"
    echo "the SHA-stamped /ui-gif review recorded in the PR body."
  } >&2
  exit 2
fi

# The recording is mechanically current. Human review is needed only when this PR carries a new
# GIF/stamp; an unrelated edit which cannot move a recorded pixel remains ungated.
gate_enforce "ui-gif" "/ui-gif" "recording review" \
  '^(docs/media/dashboard\.gif$|tools/uigif/gif_stamp\.txt$)' <<<"$input"
exit $?
